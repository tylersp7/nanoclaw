import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from './config.js';
import { logger } from './logger.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ExportFilters {
  outcome?: 'success' | 'error' | 'incomplete';
  topics?: string[];
  minMessages?: number;
  maxMessages?: number;
  dateFrom?: string; // ISO date string
  dateTo?: string;
  groupFolder?: string;
  hasToolUse?: boolean;
}

export interface TrajectoryMetadata {
  archived_at: string;
  session_id?: string;
  message_count: number;
  has_tool_use: boolean;
  has_errors: boolean;
  topics: string[];
  outcome: string;
  duration_estimate: string;
}

export interface TrajectoryEntry {
  metadata: TrajectoryMetadata;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  source: {
    groupFolder: string;
    filename: string;
  };
}

export interface ShareGPTEntry {
  conversations: Array<{ from: 'human' | 'gpt'; value: string }>;
  metadata: TrajectoryMetadata;
  source: string;
}

export interface TrajectoryStats {
  total: number;
  byOutcome: Record<string, number>;
  byTopic: Record<string, number>;
  dateRange: { earliest: string; latest: string } | null;
  avgMessages: number;
  totalMessages: number;
  withToolUse: number;
  withErrors: number;
}

// ── Frontmatter Parser ─────────────────────────────────────────────────────

/**
 * Parse YAML frontmatter between `---` markers. Simple key-value parsing
 * without a YAML library — handles strings, booleans, numbers, and
 * bracket-delimited arrays.
 */
export function parseFrontmatter(
  content: string,
): { metadata: Record<string, unknown>; body: string } | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) return null;

  const secondDash = trimmed.indexOf('---', 3);
  if (secondDash === -1) return null;

  const yamlBlock = trimmed.slice(3, secondDash).trim();
  const body = trimmed.slice(secondDash + 3).trim();

  // Bail out if the "yaml block" is empty — this handles old archives that
  // use `---` as a simple section separator (e.g. `# Conversation\n\nArchived: ...\n\n---`).
  if (!yamlBlock || !yamlBlock.includes(':')) return null;

  const metadata: Record<string, unknown> = {};

  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();

    if (!key) continue;

    metadata[key] = parseYamlValue(rawValue);
  }

  return { metadata, body };
}

function parseYamlValue(raw: string): unknown {
  // Quoted string
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }

  // Boolean
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  // Bracket array: ["a", "b"]
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => {
      const t = item.trim();
      if (
        (t.startsWith('"') && t.endsWith('"')) ||
        (t.startsWith("'") && t.endsWith("'"))
      ) {
        return t.slice(1, -1);
      }
      return parseYamlValue(t);
    });
  }

  // Number
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return Number(raw);
  }

  // Plain string
  return raw;
}

// ── Message Parser ──────────────────────────────────────────────────────────

/**
 * Parse conversation messages from the markdown body.
 * Recognises `**User**:`, `**Assistant**:`, and named assistant markers
 * like `**Andy**:`.
 */
export function parseMessages(
  body: string,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  // Split on bold role markers at the start of a line.
  // Capture the role name and everything after until the next marker.
  const markerRegex = /^\*\*(\w+)\*\*:\s*/gm;
  const markers: Array<{ role: string; index: number; matchLen: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = markerRegex.exec(body)) !== null) {
    markers.push({
      role: match[1],
      index: match.index,
      matchLen: match[0].length,
    });
  }

  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index + markers[i].matchLen;
    const end = i + 1 < markers.length ? markers[i + 1].index : body.length;
    const content = body.slice(start, end).trim();

    const roleName = markers[i].role.toLowerCase();
    const role: 'user' | 'assistant' =
      roleName === 'user' ? 'user' : 'assistant';

    if (content) {
      messages.push({ role, content });
    }
  }

  return messages;
}

// ── Metadata Helpers ────────────────────────────────────────────────────────

function toMetadata(raw: Record<string, unknown>): TrajectoryMetadata {
  return {
    archived_at: String(raw.archived_at ?? ''),
    session_id: raw.session_id ? String(raw.session_id) : undefined,
    message_count:
      typeof raw.message_count === 'number' ? raw.message_count : 0,
    has_tool_use: raw.has_tool_use === true,
    has_errors: raw.has_errors === true,
    topics: Array.isArray(raw.topics) ? raw.topics.map(String) : [],
    outcome: String(raw.outcome ?? 'unknown'),
    duration_estimate: String(raw.duration_estimate ?? 'unknown'),
  };
}

/**
 * Build synthetic metadata for archives that lack YAML frontmatter.
 * Extracts what we can from the filename and content.
 */
function syntheticMetadata(
  filename: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  content: string,
): TrajectoryMetadata {
  // Try to extract date from filename: 2026-02-12-conversation-0229.md
  const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  const archivedMatch = content.match(/Archived:\s*(.+)/);
  const archivedAt = archivedMatch
    ? archivedMatch[1].trim()
    : dateMatch
      ? dateMatch[1]
      : '';

  return {
    archived_at: archivedAt,
    session_id: undefined,
    message_count: messages.length,
    has_tool_use: false,
    has_errors: false,
    topics: [],
    outcome: 'unknown',
    duration_estimate: 'unknown',
  };
}

// ── Filter Logic ────────────────────────────────────────────────────────────

function matchesFilters(
  entry: TrajectoryEntry,
  filters: ExportFilters,
): boolean {
  const { metadata, messages } = entry;

  if (filters.outcome && metadata.outcome !== filters.outcome) return false;

  if (
    filters.hasToolUse !== undefined &&
    metadata.has_tool_use !== filters.hasToolUse
  )
    return false;

  if (filters.topics && filters.topics.length > 0) {
    const has = filters.topics.some((t) =>
      metadata.topics.map((mt) => mt.toLowerCase()).includes(t.toLowerCase()),
    );
    if (!has) return false;
  }

  const msgCount = messages.length || metadata.message_count;
  if (filters.minMessages && msgCount < filters.minMessages) return false;
  if (filters.maxMessages && msgCount > filters.maxMessages) return false;

  if (filters.dateFrom || filters.dateTo) {
    const archDate = metadata.archived_at;
    if (archDate) {
      // Normalise to YYYY-MM-DD for comparison
      const dateStr = archDate.slice(0, 10);
      if (filters.dateFrom && dateStr < filters.dateFrom) return false;
      if (filters.dateTo && dateStr > filters.dateTo) return false;
    }
  }

  return true;
}

// ── Scanner ─────────────────────────────────────────────────────────────────

/**
 * Scan conversation archives across group folders and return parsed
 * trajectory entries that match the provided filters.
 */
export function scanTrajectories(filters?: ExportFilters): TrajectoryEntry[] {
  const entries: TrajectoryEntry[] = [];

  let groupFolders: string[];
  if (filters?.groupFolder) {
    groupFolders = [filters.groupFolder];
  } else {
    try {
      groupFolders = fs.readdirSync(GROUPS_DIR).filter((name) => {
        const full = path.join(GROUPS_DIR, name);
        return fs.statSync(full).isDirectory() && name !== 'global';
      });
    } catch {
      logger.warn({ dir: GROUPS_DIR }, 'Cannot read groups directory');
      return [];
    }
  }

  for (const folder of groupFolders) {
    const convDir = path.join(GROUPS_DIR, folder, 'conversations');
    if (!fs.existsSync(convDir)) continue;

    let files: string[];
    try {
      files = fs.readdirSync(convDir).filter((f) => f.endsWith('.md'));
    } catch {
      logger.warn({ dir: convDir }, 'Cannot read conversations directory');
      continue;
    }

    for (const file of files) {
      const filePath = path.join(convDir, file);
      let content: string;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        logger.warn({ file: filePath }, 'Cannot read conversation file');
        continue;
      }

      const parsed = parseFrontmatter(content);
      let metadata: TrajectoryMetadata;
      let body: string;

      if (parsed) {
        metadata = toMetadata(parsed.metadata);
        body = parsed.body;
      } else {
        // No frontmatter — parse the body as-is and synthesize metadata
        body = content;
        const msgs = parseMessages(body);
        metadata = syntheticMetadata(file, msgs, content);
      }

      const messages = parseMessages(body);

      // Update message_count from actual parse if frontmatter was missing it
      if (metadata.message_count === 0 && messages.length > 0) {
        metadata.message_count = messages.length;
      }

      const entry: TrajectoryEntry = {
        metadata,
        messages,
        source: { groupFolder: folder, filename: file },
      };

      if (!filters || matchesFilters(entry, filters)) {
        entries.push(entry);
      }
    }
  }

  // Sort by archived_at descending (newest first)
  entries.sort((a, b) =>
    b.metadata.archived_at.localeCompare(a.metadata.archived_at),
  );

  return entries;
}

// ── Export: ShareGPT ────────────────────────────────────────────────────────

export function exportToShareGPT(entries: TrajectoryEntry[]): ShareGPTEntry[] {
  return entries.map((entry) => ({
    conversations: entry.messages.map((m) => ({
      from: m.role === 'user' ? ('human' as const) : ('gpt' as const),
      value: m.content,
    })),
    metadata: entry.metadata,
    source: `${entry.source.groupFolder}/${entry.source.filename}`,
  }));
}

// ── Export: JSONL Writers ───────────────────────────────────────────────────

/**
 * Write trajectory entries as plain JSONL (one JSON object per line).
 * Returns the number of entries written.
 */
export function exportToJSONL(
  entries: TrajectoryEntry[],
  outputPath: string,
): number {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const lines = entries.map((e) => JSON.stringify(e));
  fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf-8');
  return entries.length;
}

/**
 * Write ShareGPT-formatted entries as JSONL.
 * Returns the number of entries written.
 */
export function exportToShareGPTJSONL(
  entries: TrajectoryEntry[],
  outputPath: string,
): number {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sharegpt = exportToShareGPT(entries);
  const lines = sharegpt.map((e) => JSON.stringify(e));
  fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf-8');
  return sharegpt.length;
}

// ── Stats ───────────────────────────────────────────────────────────────────

export function getTrajectoryStats(
  entries: TrajectoryEntry[],
): TrajectoryStats {
  const byOutcome: Record<string, number> = {};
  const byTopic: Record<string, number> = {};
  let totalMessages = 0;
  let withToolUse = 0;
  let withErrors = 0;
  let earliest = '';
  let latest = '';

  for (const entry of entries) {
    const { metadata, messages } = entry;

    // Outcome counts
    const outcome = metadata.outcome || 'unknown';
    byOutcome[outcome] = (byOutcome[outcome] || 0) + 1;

    // Topic counts
    for (const topic of metadata.topics) {
      byTopic[topic] = (byTopic[topic] || 0) + 1;
    }

    // Message totals
    totalMessages += messages.length || metadata.message_count;

    if (metadata.has_tool_use) withToolUse++;
    if (metadata.has_errors) withErrors++;

    // Date range
    const d = metadata.archived_at;
    if (d) {
      if (!earliest || d < earliest) earliest = d;
      if (!latest || d > latest) latest = d;
    }
  }

  return {
    total: entries.length,
    byOutcome,
    byTopic,
    dateRange: earliest && latest ? { earliest, latest } : null,
    avgMessages:
      entries.length > 0 ? Math.round(totalMessages / entries.length) : 0,
    totalMessages,
    withToolUse,
    withErrors,
  };
}
