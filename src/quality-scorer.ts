/**
 * Conversation Quality Scorer
 * Scores archived conversations on completion, efficiency, tool success,
 * user satisfaction, and resolution. Writes quality_score / quality_label
 * into YAML frontmatter and generates rolling quality-trends reports.
 */
import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';
import { hooks } from './lifecycle-hooks.js';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QualitySignals {
  completion: number;
  efficiency: number;
  toolSuccess: number;
  userSatisfaction: number;
  resolution: number;
}

export interface QualityResult {
  score: number;
  label: string;
  signals: QualitySignals;
}

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

const WEIGHTS = {
  completion: 0.2,
  efficiency: 0.15,
  toolSuccess: 0.2,
  userSatisfaction: 0.25,
  resolution: 0.2,
} as const;

// ---------------------------------------------------------------------------
// Frontmatter helpers
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return {};
  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    meta[key] = val;
  }
  return meta;
}

function insertFrontmatterFields(
  content: string,
  fields: Record<string, string | number>,
): string {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return content; // no frontmatter — nothing to modify

  const closingIdx = content.indexOf('\n---', 4); // skip opening ---
  if (closingIdx === -1) return content;

  const newLines = Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  return (
    content.slice(0, closingIdx) + '\n' + newLines + content.slice(closingIdx)
  );
}

// ---------------------------------------------------------------------------
// Signal scoring functions
// ---------------------------------------------------------------------------

function scoreCompletion(metadata: Record<string, string>): number {
  const outcome = (metadata.outcome || '').toLowerCase();
  if (outcome === 'success') return 1.0;
  if (outcome === 'incomplete') return 0.5;
  if (outcome === 'error') return 0.2;
  return 0.7; // default / unknown
}

function scoreEfficiency(metadata: Record<string, string>): number {
  const count = parseInt(metadata.message_count || '0', 10);
  if (count <= 0) return 0.7; // unknown
  if (count <= 10) return 1.0;
  if (count <= 20) return 0.8;
  if (count <= 40) return 0.6;
  if (count <= 80) return 0.4;
  return 0.2;
}

function scoreToolSuccess(
  content: string,
  metadata: Record<string, string>,
): number {
  if (metadata.has_tool_use === 'false') return 0.7;

  const successPatterns =
    /Tool result:|✓|\bsucceeded\b|\bsuccess\b|\bcompleted\b/gi;
  const failPatterns = /Error:|\bfailed\b|✗/gi;

  const successCount = (content.match(successPatterns) || []).length;
  const failCount = (content.match(failPatterns) || []).length;
  const total = successCount + failCount;

  if (total === 0) return 0.7; // no tool indicators found
  return successCount / total;
}

function scoreUserSatisfaction(content: string): number {
  // Extract user message lines only
  const userLines = extractUserMessages(content);
  const userText = userLines.join('\n');

  const positiveRe =
    /\b(thanks|thank you|perfect|great|awesome|excellent|nice|good job|works|exactly)\b/gi;
  const negativeRe =
    /\b(wrong|incorrect|no that's not|try again|not what I|doesn't work|broken|still broken|fix this)\b/gi;

  const positiveCount = (userText.match(positiveRe) || []).length;
  const negativeCount = (userText.match(negativeRe) || []).length;

  // Negatives weighted 2x — one complaint matters more than one thanks
  const raw = (positiveCount - negativeCount * 2 + 5) / 10;
  return Math.max(0, Math.min(1, raw));
}

function scoreResolution(content: string): number {
  // Check last ~20% of content for resolution signals
  const tail = content.slice(Math.floor(content.length * 0.8));

  const positiveRe =
    /\b(done|completed|finished|resolved|fixed|deployed|sent|created|updated)\b/i;
  const negativeRe =
    /\b(TODO|still need|unfinished|blocked|can't|unable|gave up)\b/i;

  const hasPositive = positiveRe.test(tail);
  const hasNegative = negativeRe.test(tail);

  if (hasPositive && !hasNegative) return 1.0;
  if (hasNegative) return 0.2;
  return 0.6; // neither
}

// ---------------------------------------------------------------------------
// User message extraction
// ---------------------------------------------------------------------------

/**
 * Extract user messages from conversation markdown.
 * Handles formats:
 *   **User**: message
 *   ## User
 *   > User: message
 */
function extractUserMessages(content: string): string[] {
  const lines = content.split('\n');
  const userLines: string[] = [];
  let inUserBlock = false;

  for (const line of lines) {
    if (/^\*\*User\*\*:/.test(line)) {
      userLines.push(line.replace(/^\*\*User\*\*:\s*/, ''));
      inUserBlock = false;
    } else if (/^## User\b/.test(line)) {
      inUserBlock = true;
    } else if (/^## /.test(line)) {
      inUserBlock = false;
    } else if (inUserBlock) {
      userLines.push(line);
    } else if (/^>\s*User:\s*/.test(line)) {
      userLines.push(line.replace(/^>\s*User:\s*/, ''));
    }
  }

  return userLines;
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

export function scoreConversation(
  content: string,
  metadata: Record<string, string>,
): QualityResult {
  const signals: QualitySignals = {
    completion: scoreCompletion(metadata),
    efficiency: scoreEfficiency(metadata),
    toolSuccess: scoreToolSuccess(content, metadata),
    userSatisfaction: scoreUserSatisfaction(content),
    resolution: scoreResolution(content),
  };

  const score =
    signals.completion * WEIGHTS.completion +
    signals.efficiency * WEIGHTS.efficiency +
    signals.toolSuccess * WEIGHTS.toolSuccess +
    signals.userSatisfaction * WEIGHTS.userSatisfaction +
    signals.resolution * WEIGHTS.resolution;

  let label: string;
  if (score > 0.8) label = 'excellent';
  else if (score >= 0.6) label = 'good';
  else if (score >= 0.4) label = 'fair';
  else label = 'poor';

  return { score: Math.round(score * 100) / 100, label, signals };
}

// ---------------------------------------------------------------------------
// Backfill: score unscored conversations in a group folder
// ---------------------------------------------------------------------------

export function scoreGroupConversations(groupFolder: string): void {
  const convDir = path.join(groupFolder, 'conversations');
  if (!fs.existsSync(convDir)) return;

  const files = fs.readdirSync(convDir).filter((f) => f.endsWith('.md'));

  for (const file of files) {
    const filePath = path.join(convDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');

      // Skip if already scored
      if (/^quality_score:/m.test(content)) continue;

      // Skip files without YAML frontmatter — can't add score metadata
      if (!FRONTMATTER_RE.test(content)) continue;

      const metadata = parseFrontmatter(content);
      const result = scoreConversation(content, metadata);

      const updated = insertFrontmatterFields(content, {
        quality_score: result.score,
        quality_label: result.label,
      });

      fs.writeFileSync(filePath, updated);
      logger.debug({ file, score: result.score }, 'Scored conversation');
    } catch (err) {
      logger.warn(
        { file, err: err instanceof Error ? err.message : String(err) },
        'Failed to score conversation',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Quality trends report
// ---------------------------------------------------------------------------

interface ScoredConversation {
  file: string;
  score: number;
  label: string;
  signals: QualitySignals;
  archived: string;
}

export function generateQualityTrends(groupFolder: string): void {
  const convDir = path.join(groupFolder, 'conversations');
  if (!fs.existsSync(convDir)) return;

  const files = fs.readdirSync(convDir).filter((f) => f.endsWith('.md'));
  const scored: ScoredConversation[] = [];

  for (const file of files) {
    const filePath = path.join(convDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const metadata = parseFrontmatter(content);

      if (!metadata.quality_score) continue;

      scored.push({
        file,
        score: parseFloat(metadata.quality_score),
        label: metadata.quality_label || 'unknown',
        signals: {
          completion: 0,
          efficiency: 0,
          toolSuccess: 0,
          userSatisfaction: 0,
          resolution: 0,
        },
        archived: metadata.archived || '',
      });

      // Re-score to get signal breakdown (stored score is aggregate only)
      const result = scoreConversation(content, metadata);
      scored[scored.length - 1].signals = result.signals;
    } catch {
      // skip unreadable files
    }
  }

  if (scored.length === 0) return;

  // Filter to last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString();

  const recent = scored.filter((s) => {
    if (!s.archived) return true; // include undated
    return s.archived >= cutoff;
  });

  if (recent.length === 0) return;

  const avg = recent.reduce((sum, s) => sum + s.score, 0) / recent.length;
  const avgRounded = Math.round(avg * 100) / 100;
  const avgLabel = labelForScore(avg);

  const counts = { excellent: 0, good: 0, fair: 0, poor: 0 };
  for (const s of recent) {
    const l = s.label as keyof typeof counts;
    if (l in counts) counts[l]++;
  }

  // Signal averages
  const signalNames: (keyof QualitySignals)[] = [
    'completion',
    'efficiency',
    'toolSuccess',
    'userSatisfaction',
    'resolution',
  ];
  const signalAvgs: Record<string, number> = {};
  for (const name of signalNames) {
    signalAvgs[name] =
      Math.round(
        (recent.reduce((sum, s) => sum + s.signals[name], 0) / recent.length) *
          100,
      ) / 100;
  }

  // Lowest quality conversations (bottom 5)
  const lowest = [...recent].sort((a, b) => a.score - b.score).slice(0, 5);

  const signalDisplayNames: Record<string, string> = {
    completion: 'Completion',
    efficiency: 'Efficiency',
    toolSuccess: 'Tool Success',
    userSatisfaction: 'User Satisfaction',
    resolution: 'Resolution',
  };

  function signalComment(name: string, avg: number): string {
    if (avg >= 0.7) return '';
    const comments: Record<string, string> = {
      completion: 'Tasks ending prematurely or erroring out',
      efficiency: 'Conversations running too long',
      toolSuccess: 'Tools failing frequently',
      userSatisfaction: 'User corrections or complaints detected',
      resolution: 'Tasks not reaching completion',
    };
    return comments[name] || '';
  }

  function primaryIssue(s: ScoredConversation): string {
    let worstName = 'completion';
    let worstVal = s.signals.completion;
    for (const name of signalNames) {
      if (s.signals[name] < worstVal) {
        worstVal = s.signals[name];
        worstName = name;
      }
    }
    return `low ${signalDisplayNames[worstName] || worstName}`;
  }

  const now = new Date().toISOString().split('T')[0];
  const lines: string[] = [];

  lines.push('# Conversation Quality Trends');
  lines.push(`_Auto-generated. Last updated: ${now}_`);
  lines.push('');
  lines.push('## Current Period (30 days)');
  lines.push(`- Average quality: ${avgRounded} (${avgLabel})`);
  lines.push(`- Conversations scored: ${recent.length}`);
  lines.push(
    `- Excellent: ${counts.excellent} | Good: ${counts.good} | Fair: ${counts.fair} | Poor: ${counts.poor}`,
  );
  lines.push('');
  lines.push('## Signal Breakdown');
  lines.push('| Signal | Avg Score | Notes |');
  lines.push('|--------|-----------|-------|');
  for (const name of signalNames) {
    const display = signalDisplayNames[name] || name;
    const s = signalAvgs[name];
    const comment = signalComment(name, s);
    lines.push(`| ${display} | ${s} | ${comment} |`);
  }
  lines.push('');
  lines.push('## Lowest Quality Conversations');
  for (const s of lowest) {
    lines.push(
      `- ${s.file}: ${s.score} (${s.label}) — ${primaryIssue(s)}`,
    );
  }
  lines.push('');

  let report = lines.join('\n');

  // Cap at 2KB
  if (Buffer.byteLength(report, 'utf-8') > 2048) {
    report = report.slice(0, 2040) + '\n...\n';
  }

  const trendsPath = path.join(groupFolder, 'quality-trends.md');
  fs.writeFileSync(trendsPath, report);
  logger.info(
    { groupFolder: path.basename(groupFolder), conversations: recent.length },
    'Quality trends updated',
  );
}

function labelForScore(score: number): string {
  if (score > 0.8) return 'excellent';
  if (score >= 0.6) return 'good';
  if (score >= 0.4) return 'fair';
  return 'poor';
}

// ---------------------------------------------------------------------------
// Startup and scheduling
// ---------------------------------------------------------------------------

let trendsInterval: ReturnType<typeof setInterval> | null = null;

function scoreAllGroups(): void {
  if (!fs.existsSync(GROUPS_DIR)) return;
  const groups = fs.readdirSync(GROUPS_DIR);
  for (const group of groups) {
    const groupFolder = path.join(GROUPS_DIR, group);
    if (!fs.statSync(groupFolder).isDirectory()) continue;
    try {
      scoreGroupConversations(groupFolder);
      generateQualityTrends(groupFolder);
    } catch (err) {
      logger.warn(
        { group, err: err instanceof Error ? err.message : String(err) },
        'Quality scoring failed for group',
      );
    }
  }
}

export function startQualityScorer(): void {
  // Score newly indexed conversations when the learning system triggers
  hooks.on('learning:indexed', (data: { groupFolder?: string }) => {
    if (data.groupFolder) {
      try {
        scoreGroupConversations(data.groupFolder);
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'Quality scoring failed on learning:indexed',
        );
      }
    }
  });

  // First trends generation delayed 5 minutes after startup
  setTimeout(() => {
    scoreAllGroups();
  }, 5 * 60 * 1000);

  // Regenerate trends every 6 hours
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  trendsInterval = setInterval(() => {
    scoreAllGroups();
  }, SIX_HOURS);

  // Allow cleanup
  if (trendsInterval.unref) trendsInterval.unref();

  logger.info('Quality scorer started (trends every 6h, first run in 5m)');
}
