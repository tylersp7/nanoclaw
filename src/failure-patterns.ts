import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';
import { hooks } from './lifecycle-hooks.js';
import { logger } from './logger.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface FailurePattern {
  category: string;
  count: number;
  lastSeen: string; // ISO date
  examples: string[]; // max 2 short excerpts
  recoveryHint: string;
}

// ── Error Categories ───────────────────────────────────────────────────────

const ERROR_CATEGORIES: Array<{ category: string; pattern: RegExp }> = [
  { category: 'timeout', pattern: /timeout|timed out|ETIMEDOUT/i },
  {
    category: 'auth',
    pattern: /unauthorized|403|401|auth.*fail|credential|permission denied/i,
  },
  {
    category: 'rate_limit',
    pattern: /rate.?limit|429|too many requests|throttl/i,
  },
  { category: 'not_found', pattern: /not found|404|ENOENT|no such file/i },
  {
    category: 'network',
    pattern: /ECONNREFUSED|ECONNRESET|network|DNS|socket/i,
  },
  {
    category: 'syntax',
    pattern: /syntax error|unexpected token|parse error/i,
  },
  {
    category: 'container',
    pattern: /container.*fail|mount.*error|OCI|runtime/i,
  },
  { category: 'api', pattern: /API.*error|response.*error|status.*5\d\d/i },
];

const RECOVERY_HINTS: Record<string, string> = {
  timeout: 'Break into smaller steps or increase timeout',
  auth: 'Check credentials in .env and credential proxy config',
  rate_limit: 'Add delays between API calls or reduce batch size',
  not_found: 'Verify file paths and resource existence before use',
  network: 'Check DNS settings (--dns 8.8.8.8) and connectivity',
  syntax: 'Validate input format before processing',
  container: 'Check container build cache and mount paths',
  api: 'Add retry logic with exponential backoff',
  unknown: 'Review conversation for specific error details',
};

const MAX_OUTPUT_BYTES = 3072; // 3KB cap
const MAX_PATTERNS = 10;
const MAX_EXAMPLES = 2;
const EXCERPT_LENGTH = 100;
const SCAN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

// ── Frontmatter Parser ─────────────────────────────────────────────────────

/**
 * Parse YAML frontmatter between `---` markers. Simple regex-based parsing
 * without external YAML library — same pattern as trajectory-export.ts.
 */
function parseFrontmatter(
  content: string,
): { metadata: Record<string, unknown>; body: string } | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) return null;

  const secondDash = trimmed.indexOf('---', 3);
  if (secondDash === -1) return null;

  const yamlBlock = trimmed.slice(3, secondDash).trim();
  const body = trimmed.slice(secondDash + 3).trim();

  if (!yamlBlock || !yamlBlock.includes(':')) return null;

  const metadata: Record<string, unknown> = {};

  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();

    if (!key) continue;

    // Simple value parsing: booleans and strings
    if (rawValue === 'true') metadata[key] = true;
    else if (rawValue === 'false') metadata[key] = false;
    else metadata[key] = rawValue;
  }

  return { metadata, body };
}

// ── Error Detection ────────────────────────────────────────────────────────

/**
 * Check whether a conversation file indicates errors via YAML frontmatter.
 */
function hasErrorIndicators(metadata: Record<string, unknown>): boolean {
  return metadata.outcome === 'error' || metadata.has_errors === true;
}

/**
 * Categorise error content and return matching categories with example excerpts.
 */
function categoriseErrors(
  content: string,
): Array<{ category: string; excerpt: string }> {
  const results: Array<{ category: string; excerpt: string }> = [];
  const lines = content.split('\n');

  for (const { category, pattern } of ERROR_CATEGORIES) {
    for (const line of lines) {
      if (pattern.test(line)) {
        const excerpt = line.trim().slice(0, EXCERPT_LENGTH);
        results.push({ category, excerpt });
        break; // one match per category per file is enough
      }
    }
  }

  // If we detected errors from frontmatter but no specific category matched
  if (results.length === 0) {
    // Find any line with generic error keywords for the excerpt
    const errorLine = lines.find((l) => /error|fail|exception/i.test(l));
    const excerpt = errorLine
      ? errorLine.trim().slice(0, EXCERPT_LENGTH)
      : 'Error detected in conversation metadata';
    results.push({ category: 'unknown', excerpt });
  }

  return results;
}

// ── Date Extraction ────────────────────────────────────────────────────────

/**
 * Extract date from frontmatter archived_at or filename pattern.
 */
function extractDate(
  metadata: Record<string, unknown>,
  filename: string,
): string {
  if (metadata.archived_at && typeof metadata.archived_at === 'string') {
    return metadata.archived_at.slice(0, 10);
  }
  const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  return dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10);
}

// ── Scanner ────────────────────────────────────────────────────────────────

/**
 * Scan one group's conversation archives for failure patterns and write
 * a failure-patterns.md summary file.
 */
export function scanGroupFailurePatterns(groupFolder: string): void {
  const convDir = path.join(GROUPS_DIR, groupFolder, 'conversations');
  if (!fs.existsSync(convDir)) return;

  let files: string[];
  try {
    files = fs.readdirSync(convDir).filter((f) => f.endsWith('.md'));
  } catch {
    logger.warn(
      { dir: convDir },
      'failure-patterns: cannot read conversations directory',
    );
    return;
  }

  // Accumulate patterns keyed by category
  const patternMap = new Map<
    string,
    { count: number; lastSeen: string; examples: string[] }
  >();

  for (const file of files) {
    const filePath = path.join(convDir, file);
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const parsed = parseFrontmatter(content);
    if (!parsed) continue;

    if (!hasErrorIndicators(parsed.metadata)) continue;

    const date = extractDate(parsed.metadata, file);
    const categories = categoriseErrors(parsed.body);

    for (const { category, excerpt } of categories) {
      const existing = patternMap.get(category);
      if (existing) {
        existing.count++;
        if (date > existing.lastSeen) {
          existing.lastSeen = date;
        }
        if (existing.examples.length < MAX_EXAMPLES) {
          existing.examples.push(excerpt);
        }
      } else {
        patternMap.set(category, {
          count: 1,
          lastSeen: date,
          examples: [excerpt],
        });
      }
    }
  }

  if (patternMap.size === 0) return;

  // Build sorted FailurePattern array (top N by frequency)
  const patterns: FailurePattern[] = [...patternMap.entries()]
    .map(([category, data]) => ({
      category,
      count: data.count,
      lastSeen: data.lastSeen,
      examples: data.examples,
      recoveryHint: RECOVERY_HINTS[category] || RECOVERY_HINTS.unknown,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_PATTERNS);

  // Render markdown
  const now = new Date().toISOString();
  let md = `# Failure Patterns\n_Auto-generated. Last updated: ${now}_\n`;

  for (const p of patterns) {
    const section = [
      `\n## ${p.category} (${p.count} occurrences, last: ${p.lastSeen})`,
      `Recovery: ${p.recoveryHint}`,
      'Examples:',
      ...p.examples.map((ex) => `- ${ex}`),
    ].join('\n');

    // Enforce 3KB cap
    if (Buffer.byteLength(md + section, 'utf-8') > MAX_OUTPUT_BYTES) break;
    md += section + '\n';
  }

  // Write output
  const outputPath = path.join(GROUPS_DIR, groupFolder, 'failure-patterns.md');
  try {
    fs.writeFileSync(outputPath, md, 'utf-8');
    logger.info(
      { groupFolder, patternCount: patterns.length },
      'failure-patterns: wrote summary',
    );
  } catch (err) {
    logger.error(
      { groupFolder, err },
      'failure-patterns: failed to write summary',
    );
  }
}

// ── Scan All Groups ────────────────────────────────────────────────────────

function scanAllGroups(): void {
  let groupFolders: string[];
  try {
    groupFolders = fs.readdirSync(GROUPS_DIR).filter((name) => {
      const full = path.join(GROUPS_DIR, name);
      return fs.statSync(full).isDirectory() && name !== 'global';
    });
  } catch {
    logger.warn(
      { dir: GROUPS_DIR },
      'failure-patterns: cannot read groups directory',
    );
    return;
  }

  for (const folder of groupFolders) {
    scanGroupFailurePatterns(folder);
  }
}

// ── Startup ────────────────────────────────────────────────────────────────

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Register on the `learning:indexed` lifecycle hook and set a 12h background
 * interval to keep failure-patterns.md files up to date.
 */
export function startFailurePatternScanner(): void {
  // React to new conversation archives being indexed
  hooks.on('learning:indexed', (event) => {
    try {
      scanGroupFailurePatterns(event.groupFolder);
    } catch (err) {
      logger.warn(
        { err, groupFolder: event.groupFolder },
        'failure-patterns: hook error',
      );
    }
  });

  // Run an initial scan
  scanAllGroups();

  // Periodic full scan every 12 hours
  intervalHandle = setInterval(() => {
    scanAllGroups();
  }, SCAN_INTERVAL_MS);

  // Allow process to exit without waiting for this timer
  if (
    intervalHandle &&
    typeof intervalHandle === 'object' &&
    'unref' in intervalHandle
  ) {
    intervalHandle.unref();
  }

  logger.info(
    'failure-patterns: scanner started (12h interval + learning:indexed hook)',
  );
}
