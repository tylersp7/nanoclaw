/**
 * NanoClaw Agent Runner
 * Runs inside a container, receives config via stdin, outputs result to stdout
 *
 * Input protocol:
 *   Stdin: Full ContainerInput JSON (read until EOF, like before)
 *   IPC:   Follow-up messages written as JSON files to /workspace/ipc/input/
 *          Files: {type:"message", text:"..."}.json — polled and consumed
 *          Sentinel: /workspace/ipc/input/_close — signals session end
 *
 * Stdout protocol:
 *   Each result is wrapped in OUTPUT_START_MARKER / OUTPUT_END_MARKER pairs.
 *   Multiple results may be emitted (one per agent teams result).
 *   Final marker after loop ends signals completion.
 */

import fs from 'fs';
import path from 'path';
import { query, HookCallback, PreCompactHookInput } from '@anthropic-ai/claude-agent-sdk';
import { fileURLToPath } from 'url';

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface SessionEntry {
  sessionId: string;
  fullPath: string;
  summary: string;
  firstPrompt: string;
}

interface SessionsIndex {
  entries: SessionEntry[];
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

interface SDKUserMessage {
  type: 'user';
  message: { role: 'user'; content: string | ContentBlock[] };
  parent_tool_use_id: null;
  session_id: string;
}

const IPC_INPUT_DIR = '/workspace/ipc/input';
const IPC_INPUT_CLOSE_SENTINEL = path.join(IPC_INPUT_DIR, '_close');
const IPC_INPUT_INTERRUPT_SENTINEL = path.join(IPC_INPUT_DIR, '_interrupt');
const IPC_POLL_MS = 500;

/**
 * Push-based async iterable for streaming user messages to the SDK.
 * Keeps the iterable alive until end() is called, preventing isSingleUserTurn.
 */
class MessageStream {
  private queue: SDKUserMessage[] = [];
  private waiting: (() => void) | null = null;
  private done = false;

  push(text: string): void {
    this.queue.push({
      type: 'user',
      message: { role: 'user', content: buildMultimodalContent(text) },
      parent_tool_use_id: null,
      session_id: '',
    });
    this.waiting?.();
  }

  end(): void {
    this.done = true;
    this.waiting?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.done) return;
      await new Promise<void>(r => { this.waiting = r; });
      this.waiting = null;
    }
  }
}

/**
 * Scan prompt for media="..." attributes, read files, and build multimodal content blocks.
 * Falls back to plain string if no media found or all reads fail.
 */
function buildMultimodalContent(prompt: string): string | ContentBlock[] {
  const mediaRegex = /media="([^"]+)"/g;
  const matches = [...prompt.matchAll(mediaRegex)];
  if (matches.length === 0) return prompt;

  const blocks: ContentBlock[] = [{ type: 'text', text: prompt }];
  let added = 0;

  for (const match of matches) {
    const relativePath = match[1];
    const fullPath = path.join('/workspace/group', relativePath);
    try {
      const data = fs.readFileSync(fullPath);
      const ext = path.extname(relativePath).slice(1).toLowerCase();
      const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif', webp: 'image/webp',
      };
      const mediaType = mimeMap[ext] || 'image/jpeg';
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: data.toString('base64') },
      });
      added++;
      log(`Added image block: ${relativePath} (${data.length} bytes)`);
    } catch (err) {
      log(`Failed to read media file ${fullPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return added > 0 ? blocks : prompt;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

function getSessionSummary(sessionId: string, transcriptPath: string): string | null {
  const projectDir = path.dirname(transcriptPath);
  const indexPath = path.join(projectDir, 'sessions-index.json');

  if (!fs.existsSync(indexPath)) {
    log(`Sessions index not found at ${indexPath}`);
    return null;
  }

  try {
    const index: SessionsIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const entry = index.entries.find(e => e.sessionId === sessionId);
    if (entry?.summary) {
      return entry.summary;
    }
  } catch (err) {
    log(`Failed to read sessions index: ${err instanceof Error ? err.message : String(err)}`);
  }

  return null;
}

/**
 * Archive the full transcript to conversations/ before compaction.
 */
function createPreCompactHook(assistantName?: string): HookCallback {
  return async (input, _toolUseId, _context) => {
    const preCompact = input as PreCompactHookInput;
    const transcriptPath = preCompact.transcript_path;
    const sessionId = preCompact.session_id;

    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      log('No transcript found for archiving');
      return {};
    }

    try {
      const content = fs.readFileSync(transcriptPath, 'utf-8');
      const { messages, metadata } = parseTranscript(content);

      if (messages.length === 0) {
        log('No messages to archive');
        return {};
      }

      const summary = getSessionSummary(sessionId, transcriptPath);
      const name = summary ? sanitizeFilename(summary) : generateFallbackName();

      const conversationsDir = '/workspace/group/conversations';
      fs.mkdirSync(conversationsDir, { recursive: true });

      const date = new Date().toISOString().split('T')[0];
      const filename = `${date}-${name}.md`;
      const filePath = path.join(conversationsDir, filename);

      const markdown = formatTranscriptMarkdown(messages, metadata, summary, assistantName, sessionId);
      fs.writeFileSync(filePath, markdown);

      log(`Archived conversation to ${filePath}`);

      // Generate and write structured summary
      try {
        const summariesDir = path.join(conversationsDir, 'summaries');
        fs.mkdirSync(summariesDir, { recursive: true });

        const convSummary = generateConversationSummary(messages, metadata, summary);
        const summaryMarkdown = formatSummaryMarkdown(convSummary);
        const summaryFilename = `${date}-${name}.summary.md`;
        const summaryPath = path.join(summariesDir, summaryFilename);
        fs.writeFileSync(summaryPath, summaryMarkdown);

        log(`Wrote conversation summary to ${summaryPath}`);

        // Maintain rolling session context for cross-compaction continuity
        try {
          const contextPath = '/workspace/group/session-context.md';

          let existingContext = '';
          if (fs.existsSync(contextPath)) {
            existingContext = fs.readFileSync(contextPath, 'utf-8');
          }

          const newEntry = formatContextEntry(convSummary, metadata);
          const updatedContext = mergeContextEntries(existingContext, newEntry, 5);
          fs.writeFileSync(contextPath, updatedContext);

          log(`Updated session-context.md (${updatedContext.length} chars)`);
        } catch (contextErr) {
          log(`Failed to update session context: ${contextErr instanceof Error ? contextErr.message : String(contextErr)}`);
        }
      } catch (summaryErr) {
        log(`Failed to write summary: ${summaryErr instanceof Error ? summaryErr.message : String(summaryErr)}`);
      }
    } catch (err) {
      log(`Failed to archive transcript: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {};
  };
}

function sanitizeFilename(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function generateFallbackName(): string {
  const time = new Date();
  return `conversation-${time.getHours().toString().padStart(2, '0')}${time.getMinutes().toString().padStart(2, '0')}`;
}

interface ConversationSummary {
  title: string;
  date: string;
  keyFacts: string[];
  decisions: string[];
  actionItems: string[];
  toolsUsed: string[];
  errorsSummary: string | null;
}

interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface TranscriptMetadata {
  messageCount: number;
  hasToolUse: boolean;
  hasErrors: boolean;
  topics: string[];
  outcome: 'success' | 'error' | 'incomplete';
  durationEstimate: 'short' | 'medium' | 'long';
}

interface ParsedTranscript {
  messages: ParsedMessage[];
  metadata: TranscriptMetadata;
}

/** Map tool names to human-readable topic labels. */
const TOOL_TOPIC_MAP: Record<string, string> = {
  Bash: 'cli',
  Read: 'files',
  Write: 'files',
  Edit: 'files',
  Glob: 'files',
  Grep: 'search',
  WebSearch: 'research',
  WebFetch: 'research',
  Task: 'orchestration',
  TeamCreate: 'orchestration',
  SendMessage: 'orchestration',
  NotebookEdit: 'notebook',
};

function parseTranscript(content: string): ParsedTranscript {
  const messages: ParsedMessage[] = [];
  let hasToolUse = false;
  let hasErrors = false;
  const topicCounts = new Map<string, number>();
  let lastEntryHadError = false;

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'user' && entry.message?.content) {
        const text = typeof entry.message.content === 'string'
          ? entry.message.content
          : entry.message.content.map((c: { text?: string }) => c.text || '').join('');
        if (text) messages.push({ role: 'user', content: text });
      } else if (entry.type === 'assistant' && entry.message?.content) {
        const blocks = entry.message.content;
        const textParts = blocks
          .filter((c: { type: string }) => c.type === 'text')
          .map((c: { text: string }) => c.text);
        const text = textParts.join('');
        if (text) messages.push({ role: 'assistant', content: text });

        // Detect tool use and extract topics
        for (const block of blocks) {
          if (block.type === 'tool_use') {
            hasToolUse = true;
            const toolName: string = block.name || '';

            // Check direct map first
            const directTopic = TOOL_TOPIC_MAP[toolName];
            if (directTopic) {
              topicCounts.set(directTopic, (topicCounts.get(directTopic) || 0) + 1);
            } else if (toolName.startsWith('mcp__nanoclaw')) {
              topicCounts.set('ipc', (topicCounts.get('ipc') || 0) + 1);
            } else if (toolName.startsWith('mcp__gmail')) {
              topicCounts.set('email', (topicCounts.get('email') || 0) + 1);
            } else if (toolName.startsWith('mcp__parallel')) {
              topicCounts.set('research', (topicCounts.get('research') || 0) + 1);
            }
          }

          // Detect errors in text content
          if (block.type === 'text' && typeof block.text === 'string') {
            if (/\bError:|Failed to |error occurred/i.test(block.text)) {
              hasErrors = true;
            }
          }

          // Detect errors in tool results
          if (block.type === 'tool_result' && block.is_error) {
            hasErrors = true;
          }
        }

        // Track whether the last assistant entry had error signals
        lastEntryHadError = blocks.some(
          (b: { type: string; text?: string; is_error?: boolean }) =>
            (b.type === 'text' && typeof b.text === 'string' && /\bError:|Failed to |error occurred/i.test(b.text)) ||
            (b.type === 'tool_result' && b.is_error)
        );
      }
    } catch {
    }
  }

  // Build sorted topics (top 5 by frequency)
  const topics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic]) => topic);

  // Determine outcome
  let outcome: TranscriptMetadata['outcome'] = 'incomplete';
  if (messages.length > 0) {
    if (lastEntryHadError || (hasErrors && messages[messages.length - 1]?.role === 'assistant')) {
      // Check if the very last assistant message contains error signals
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
      if (lastAssistant && /\bError:|Failed to |error occurred/i.test(lastAssistant.content)) {
        outcome = 'error';
      } else {
        outcome = 'success';
      }
    } else if (messages[messages.length - 1]?.role === 'assistant') {
      outcome = 'success';
    }
  }

  // Duration estimate based on message count
  const msgCount = messages.length;
  const durationEstimate: TranscriptMetadata['durationEstimate'] =
    msgCount < 5 ? 'short' : msgCount <= 20 ? 'medium' : 'long';

  return {
    messages,
    metadata: {
      messageCount: msgCount,
      hasToolUse,
      hasErrors,
      topics,
      outcome,
      durationEstimate,
    },
  };
}

function generateConversationSummary(
  messages: ParsedMessage[],
  metadata: TranscriptMetadata,
  title?: string | null,
): ConversationSummary {
  const date = new Date().toISOString().split('T')[0];

  // Extract key facts from the last few assistant messages (conclusions live at the end)
  const keyFacts: string[] = [];
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  const tailMessages = assistantMessages.slice(-5);
  const factPatterns = [
    /(?:completed|created|updated|deleted|installed|configured|deployed|fixed|resolved|generated|wrote|built|added|removed|migrated|refactored)\s+(.{10,80})/gi,
    /(?:successfully|done|finished|ready)\s*[:\-]?\s*(.{10,80})/gi,
    /(?:the result|output|summary)[:\s]+(.{10,80})/gi,
  ];
  for (const msg of tailMessages) {
    for (const pattern of factPatterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(msg.content);
      if (match) {
        const fact = match[0].trim().replace(/\s+/g, ' ');
        if (fact.length <= 120 && !keyFacts.some(f => f === fact)) {
          keyFacts.push(fact);
        }
      }
    }
    if (keyFacts.length >= 5) break;
  }

  // Extract decisions
  const decisions: string[] = [];
  const decisionPatterns = [
    /(?:decided to|chose to|will use|going with|opted for|switching to|using)\s+(.{10,80})/gi,
    /(?:let's|we'll|I'll)\s+(.{10,80})/gi,
  ];
  for (const msg of assistantMessages) {
    for (const pattern of decisionPatterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(msg.content);
      if (match) {
        const decision = match[0].trim().replace(/\s+/g, ' ');
        if (decision.length <= 120 && !decisions.some(d => d === decision)) {
          decisions.push(decision);
        }
      }
    }
    if (decisions.length >= 5) break;
  }

  // Extract action items from the last few messages
  const actionItems: string[] = [];
  const actionPatterns = [
    /(?:TODO|FIXME)[:\s]+(.{10,80})/gi,
    /(?:follow up|next step|need to|should|needs to|remember to|don't forget to)\s+(.{10,80})/gi,
  ];
  const lastMessages = messages.slice(-6);
  for (const msg of lastMessages) {
    for (const pattern of actionPatterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(msg.content);
      if (match) {
        const item = (match[2] || match[1] || match[0]).trim().replace(/\s+/g, ' ');
        if (item.length <= 120 && !actionItems.some(a => a === item)) {
          actionItems.push(item);
        }
      }
    }
    if (actionItems.length >= 5) break;
  }

  // Tools used — already available as human-readable topics from metadata
  const toolsUsed = [...metadata.topics];

  // Errors summary
  let errorsSummary: string | null = null;
  if (metadata.hasErrors) {
    for (const msg of messages) {
      if (msg.role === 'assistant') {
        const errorMatch = msg.content.match(/(?:Error:|Failed to |error occurred)[^\n]{0,100}/i);
        if (errorMatch) {
          errorsSummary = errorMatch[0].trim();
          break;
        }
      }
    }
    if (!errorsSummary) {
      errorsSummary = 'Errors detected during conversation';
    }
  }

  return {
    title: title || 'Conversation',
    date,
    keyFacts: keyFacts.slice(0, 5),
    decisions: decisions.slice(0, 5),
    actionItems: actionItems.slice(0, 5),
    toolsUsed,
    errorsSummary,
  };
}

function formatSummaryMarkdown(summary: ConversationSummary): string {
  const lines: string[] = [];

  lines.push(`# Summary: ${summary.title}`);
  lines.push(`Date: ${summary.date}`);
  lines.push('');

  lines.push('## Key Facts');
  if (summary.keyFacts.length > 0) {
    for (const fact of summary.keyFacts) {
      lines.push(`- ${fact}`);
    }
  } else {
    lines.push('- No notable facts extracted');
  }
  lines.push('');

  lines.push('## Decisions');
  if (summary.decisions.length > 0) {
    for (const decision of summary.decisions) {
      lines.push(`- ${decision}`);
    }
  } else {
    lines.push('- No decisions recorded');
  }
  lines.push('');

  lines.push('## Action Items');
  if (summary.actionItems.length > 0) {
    for (const item of summary.actionItems) {
      lines.push(`- [ ] ${item}`);
    }
  } else {
    lines.push('- None');
  }
  lines.push('');

  lines.push('## Tools Used');
  lines.push(summary.toolsUsed.length > 0 ? summary.toolsUsed.join(', ') : 'None');
  lines.push('');

  lines.push('## Errors');
  lines.push(summary.errorsSummary || 'None');
  lines.push('');

  return lines.join('\n');
}

/**
 * Format a single session context entry from a conversation summary.
 */
function formatContextEntry(summary: ConversationSummary, metadata: TranscriptMetadata): string {
  const lines: string[] = [];

  lines.push(`## Session: ${summary.date} — ${summary.title}`);
  lines.push(`Outcome: ${metadata.outcome} | Messages: ${metadata.messageCount} | Topics: ${metadata.topics.join(', ') || 'general'}`);
  lines.push('');

  if (summary.keyFacts.length > 0) {
    lines.push('**Key Facts:**');
    for (const fact of summary.keyFacts) {
      lines.push(`- ${fact}`);
    }
    lines.push('');
  }

  if (summary.decisions.length > 0) {
    lines.push('**Decisions:**');
    for (const decision of summary.decisions) {
      lines.push(`- ${decision}`);
    }
    lines.push('');
  }

  if (summary.actionItems.length > 0) {
    lines.push('**Action Items:**');
    for (const item of summary.actionItems) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  // Trim trailing blank lines and cap total length
  let result = lines.join('\n').trimEnd();
  if (result.length > 500) {
    result = result.slice(0, 497) + '...';
  }
  return result;
}

/**
 * Merge a new context entry into the existing session-context.md content.
 * Keeps only the last `maxEntries` entries.
 */
function mergeContextEntries(existing: string, newEntry: string, maxEntries: number): string {
  const HEADER = `# Session Context\n\nRolling context from recent conversations. Auto-updated on compaction.`;

  // Parse existing entries by splitting on --- separators
  const entries: string[] = [];
  if (existing.trim()) {
    const parts = existing.split(/\n---\n/);
    for (const part of parts) {
      const trimmed = part.trim();
      // Skip the header block, keep only actual session entries
      if (trimmed.startsWith('## Session:')) {
        entries.push(trimmed);
      }
    }
  }

  entries.push(newEntry);

  // Keep only the last maxEntries
  const kept = entries.slice(-maxEntries);

  return HEADER + '\n\n---\n\n' + kept.join('\n\n---\n\n') + '\n';
}

/**
 * Load the most recent conversation summaries from the summaries directory.
 * Returns an array of summary file contents, newest first.
 */
function loadRecentSummaries(conversationsDir: string, limit = 10): string[] {
  const summariesDir = path.join(conversationsDir, 'summaries');
  if (!fs.existsSync(summariesDir)) {
    return [];
  }

  try {
    const files = fs.readdirSync(summariesDir)
      .filter(f => f.endsWith('.summary.md'))
      .sort()
      .reverse()
      .slice(0, limit);

    return files.map(f => {
      try {
        return fs.readFileSync(path.join(summariesDir, f), 'utf-8');
      } catch {
        return '';
      }
    }).filter(content => content.length > 0);
  } catch {
    return [];
  }
}

function formatTranscriptMarkdown(
  messages: ParsedMessage[],
  metadata: TranscriptMetadata,
  title?: string | null,
  assistantName?: string,
  sessionId?: string,
): string {
  const now = new Date();
  const formatDateTime = (d: Date) => d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  const lines: string[] = [];

  // YAML frontmatter
  lines.push('---');
  lines.push(`archived_at: "${now.toISOString()}"`);
  if (sessionId) {
    lines.push(`session_id: "${sessionId}"`);
  }
  lines.push(`message_count: ${metadata.messageCount}`);
  lines.push(`has_tool_use: ${metadata.hasToolUse}`);
  lines.push(`has_errors: ${metadata.hasErrors}`);
  lines.push(`topics: [${metadata.topics.map(t => `"${t}"`).join(', ')}]`);
  lines.push(`outcome: "${metadata.outcome}"`);
  lines.push(`duration_estimate: "${metadata.durationEstimate}"`);
  lines.push('---');
  lines.push('');

  lines.push(`# ${title || 'Conversation'}`);
  lines.push('');
  lines.push(`Archived: ${formatDateTime(now)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    const sender = msg.role === 'user' ? 'User' : (assistantName || 'Assistant');
    const content = msg.content.length > 2000
      ? msg.content.slice(0, 2000) + '...'
      : msg.content;
    lines.push(`**${sender}**: ${content}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Check for _close sentinel.
 */
function shouldClose(): boolean {
  if (fs.existsSync(IPC_INPUT_CLOSE_SENTINEL)) {
    try { fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL); } catch { /* ignore */ }
    return true;
  }
  return false;
}

/**
 * Drain all pending IPC input messages.
 * Returns messages found, or empty array.
 */
function drainIpcInput(): string[] {
  try {
    fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
    const files = fs.readdirSync(IPC_INPUT_DIR)
      .filter(f => f.endsWith('.json'))
      .sort();

    const messages: string[] = [];
    for (const file of files) {
      const filePath = path.join(IPC_INPUT_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        fs.unlinkSync(filePath);
        if (data.type === 'message' && data.text) {
          messages.push(data.text);
        }
      } catch (err) {
        log(`Failed to process input file ${file}: ${err instanceof Error ? err.message : String(err)}`);
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }
    return messages;
  } catch (err) {
    log(`IPC drain error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Wait for a new IPC message or _close sentinel.
 * Returns the messages as a single string, or null if _close.
 */
function waitForIpcMessage(): Promise<string | null> {
  return new Promise((resolve) => {
    const poll = () => {
      if (shouldClose()) {
        resolve(null);
        return;
      }
      const messages = drainIpcInput();
      if (messages.length > 0) {
        resolve(messages.join('\n'));
        return;
      }
      setTimeout(poll, IPC_POLL_MS);
    };
    poll();
  });
}

/**
 * Run a single query and stream results via writeOutput.
 * Uses MessageStream (AsyncIterable) to keep isSingleUserTurn=false,
 * allowing agent teams subagents to run to completion.
 * Also pipes IPC messages into the stream during the query.
 */
async function runQuery(
  prompt: string,
  sessionId: string | undefined,
  mcpServerPath: string,
  containerInput: ContainerInput,
  sdkEnv: Record<string, string | undefined>,
  resumeAt?: string,
  injectSummaries?: boolean,
): Promise<{ newSessionId?: string; lastAssistantUuid?: string; closedDuringQuery: boolean; interruptedDuringQuery: boolean }> {
  const stream = new MessageStream();

  // Inject recent conversation summaries for context continuity (first query only)
  let contextPrefix = '';
  if (injectSummaries && !prompt.startsWith('[SCHEDULED TASK')) {
    const summaries = loadRecentSummaries('/workspace/group/conversations', 5);
    if (summaries.length > 0) {
      log(`Injecting ${summaries.length} recent session summaries as context`);
      contextPrefix = `<context type="recent-sessions">
Here are summaries of your recent conversations for context continuity:

${summaries.join('\n---\n')}
</context>

`;
    }
  }
  stream.push(contextPrefix + prompt);

  // Poll IPC for follow-up messages, _interrupt, and _close sentinels during the query
  let ipcPolling = true;
  let closedDuringQuery = false;
  let interruptedDuringQuery = false;
  const pollIpcDuringQuery = () => {
    if (!ipcPolling) return;

    // Check for interrupt signal (higher priority than _close)
    if (fs.existsSync(IPC_INPUT_INTERRUPT_SENTINEL)) {
      try { fs.unlinkSync(IPC_INPUT_INTERRUPT_SENTINEL); } catch { /* ignore */ }
      log('Interrupt signal detected, ending current query for priority message');
      closedDuringQuery = false;
      interruptedDuringQuery = true;
      stream.end();
      ipcPolling = false;
      return;
    }

    if (shouldClose()) {
      log('Close sentinel detected during query, ending stream');
      closedDuringQuery = true;
      stream.end();
      ipcPolling = false;
      return;
    }
    const messages = drainIpcInput();
    for (const text of messages) {
      log(`Piping IPC message into active query (${text.length} chars)`);
      stream.push(text);
    }
    setTimeout(pollIpcDuringQuery, IPC_POLL_MS);
  };
  setTimeout(pollIpcDuringQuery, IPC_POLL_MS);

  let newSessionId: string | undefined;
  let lastAssistantUuid: string | undefined;
  let messageCount = 0;
  let resultCount = 0;

  // Load global CLAUDE.md as additional system context (shared across all groups)
  const globalClaudeMdPath = '/workspace/global/CLAUDE.md';
  let globalClaudeMd: string | undefined;
  if (!containerInput.isMain && fs.existsSync(globalClaudeMdPath)) {
    globalClaudeMd = fs.readFileSync(globalClaudeMdPath, 'utf-8');
  }

  // Discover additional directories mounted at /workspace/extra/*
  // These are passed to the SDK so their CLAUDE.md files are loaded automatically
  const extraDirs: string[] = [];
  const extraBase = '/workspace/extra';
  if (fs.existsSync(extraBase)) {
    for (const entry of fs.readdirSync(extraBase)) {
      const fullPath = path.join(extraBase, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        extraDirs.push(fullPath);
      }
    }
  }
  if (extraDirs.length > 0) {
    log(`Additional directories: ${extraDirs.join(', ')}`);
  }

  for await (const message of query({
    prompt: stream,
    options: {
      cwd: '/workspace/group',
      additionalDirectories: extraDirs.length > 0 ? extraDirs : undefined,
      resume: sessionId,
      resumeSessionAt: resumeAt,
      systemPrompt: globalClaudeMd
        ? { type: 'preset' as const, preset: 'claude_code' as const, append: globalClaudeMd }
        : undefined,
      allowedTools: [
        'Bash',
        'Read', 'Write', 'Edit', 'Glob', 'Grep',
        'WebSearch', 'WebFetch',
        'Task', 'TaskOutput', 'TaskStop',
        'TeamCreate', 'TeamDelete', 'SendMessage',
        'TodoWrite', 'ToolSearch', 'Skill',
        'NotebookEdit',
        'mcp__nanoclaw__*',
        'mcp__gmail__*',
        'mcp__parallel-search__*',
        'mcp__parallel-task__*'
      ],
      env: sdkEnv,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: ['project', 'user'],
      mcpServers: {
        nanoclaw: {
          command: 'node',
          args: [mcpServerPath],
          env: {
            NANOCLAW_CHAT_JID: containerInput.chatJid,
            NANOCLAW_GROUP_FOLDER: containerInput.groupFolder,
            NANOCLAW_IS_MAIN: containerInput.isMain ? '1' : '0',
          },
        },
        gmail: {
          command: 'npx',
          args: ['-y', '@gongrzhe/server-gmail-autoauth-mcp'],
        },
        ...(process.env.PARALLEL_API_KEY ? {
          'parallel-search': {
            type: 'http',
            url: 'https://search-mcp.parallel.ai/mcp',
            headers: {
              'Authorization': `Bearer ${process.env.PARALLEL_API_KEY}`
            }
          },
          'parallel-task': {
            type: 'http',
            url: 'https://task-mcp.parallel.ai/mcp',
            headers: {
              'Authorization': `Bearer ${process.env.PARALLEL_API_KEY}`
            }
          },
        } : {}),
      },
      hooks: {
        PreCompact: [{ hooks: [createPreCompactHook(containerInput.assistantName)] }],
      },
    }
  })) {
    messageCount++;
    const msgType = message.type === 'system' ? `system/${(message as { subtype?: string }).subtype}` : message.type;
    log(`[msg #${messageCount}] type=${msgType}`);

    if (message.type === 'assistant' && 'uuid' in message) {
      lastAssistantUuid = (message as { uuid: string }).uuid;
    }

    if (message.type === 'system' && message.subtype === 'init') {
      newSessionId = message.session_id;
      log(`Session initialized: ${newSessionId}`);
    }

    if (message.type === 'system' && (message as { subtype?: string }).subtype === 'task_notification') {
      const tn = message as { task_id: string; status: string; summary: string };
      log(`Task notification: task=${tn.task_id} status=${tn.status} summary=${tn.summary}`);
    }

    if (message.type === 'result') {
      resultCount++;
      const textResult = 'result' in message ? (message as { result?: string }).result : null;
      log(`Result #${resultCount}: subtype=${message.subtype}${textResult ? ` text=${textResult.slice(0, 200)}` : ''}`);
      writeOutput({
        status: 'success',
        result: textResult || null,
        newSessionId
      });
    }
  }

  ipcPolling = false;
  log(`Query done. Messages: ${messageCount}, results: ${resultCount}, lastAssistantUuid: ${lastAssistantUuid || 'none'}, closedDuringQuery: ${closedDuringQuery}, interruptedDuringQuery: ${interruptedDuringQuery}`);
  return { newSessionId, lastAssistantUuid, closedDuringQuery, interruptedDuringQuery };
}

async function main(): Promise<void> {
  let containerInput: ContainerInput;

  try {
    const stdinData = await readStdin();
    containerInput = JSON.parse(stdinData);
    try { fs.unlinkSync('/tmp/input.json'); } catch { /* may not exist */ }
    log(`Received input for group: ${containerInput.groupFolder}`);
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`
    });
    process.exit(1);
  }

  // Credentials are injected by the host's credential proxy via ANTHROPIC_BASE_URL.
  // No real secrets exist in the container environment.
  const sdkEnv: Record<string, string | undefined> = { ...process.env };

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const mcpServerPath = path.join(__dirname, 'ipc-mcp-stdio.js');

  let sessionId = containerInput.sessionId;
  fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });

  // Clean up stale sentinels from previous container runs
  try { fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL); } catch { /* ignore */ }
  try { fs.unlinkSync(IPC_INPUT_INTERRUPT_SENTINEL); } catch { /* ignore */ }

  // Build initial prompt (drain any pending IPC messages too)
  let prompt = containerInput.prompt;
  if (containerInput.isScheduledTask) {
    prompt = `[SCHEDULED TASK - The following message was sent automatically and is not coming directly from the user or group.]\n\n${prompt}`;
  }
  const pending = drainIpcInput();
  if (pending.length > 0) {
    log(`Draining ${pending.length} pending IPC messages into initial prompt`);
    prompt += '\n' + pending.join('\n');
  }

  // Query loop: run query → wait for IPC message → run new query → repeat
  let resumeAt: string | undefined;
  let isFirstQuery = true;
  try {
    while (true) {
      log(`Starting query (session: ${sessionId || 'new'}, resumeAt: ${resumeAt || 'latest'})...`);

      const queryResult = await runQuery(prompt, sessionId, mcpServerPath, containerInput, sdkEnv, resumeAt, isFirstQuery);
      isFirstQuery = false;
      if (queryResult.newSessionId) {
        sessionId = queryResult.newSessionId;
      }
      if (queryResult.lastAssistantUuid) {
        resumeAt = queryResult.lastAssistantUuid;
      }

      // If _close was consumed during the query, exit immediately.
      // Don't emit a session-update marker (it would reset the host's
      // idle timer and cause a 30-min delay before the next _close).
      if (queryResult.closedDuringQuery) {
        log('Close sentinel consumed during query, exiting');
        break;
      }

      // If interrupted, drain the priority message and start a new query immediately
      if (queryResult.interruptedDuringQuery) {
        log('Query was interrupted, draining interrupt message');
        const interruptMessages = drainIpcInput();
        if (interruptMessages.length > 0) {
          prompt = interruptMessages.join('\n');
          continue; // Skip waitForIpcMessage, go straight to next query
        }
        // If no message found (race condition), fall through to normal wait
        log('No interrupt message found, falling through to normal wait');
      }

      // Emit session update so host can track it
      writeOutput({ status: 'success', result: null, newSessionId: sessionId });

      log('Query ended, waiting for next IPC message...');

      // Wait for the next message or _close sentinel
      const nextMessage = await waitForIpcMessage();
      if (nextMessage === null) {
        log('Close sentinel received, exiting');
        break;
      }

      log(`Got new message (${nextMessage.length} chars), starting new query`);
      prompt = nextMessage;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Agent error: ${errorMessage}`);
    writeOutput({
      status: 'error',
      result: null,
      newSessionId: sessionId,
      error: errorMessage
    });
    process.exit(1);
  }
}

main();
