import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export interface SkillStats {
  skillName: string;
  timesUsed: number;
  successCount: number;
  errorCount: number;
  incompleteCount: number;
  commonTopics: string[]; // top 3 topics co-occurring with this skill
  avgMessageCount: number;
  lastUsed: string; // ISO date
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ConversationMeta {
  outcome?: string;
  topics?: string[];
  messageCount?: number;
  hasToolUse?: boolean;
  date?: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

/** Minimal YAML frontmatter parser (regex-based, no library). */
function parseFrontmatter(raw: string): ConversationMeta {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return {};

  const block = match[1];
  const meta: ConversationMeta = {};

  for (const line of block.split('\n')) {
    const [key, ...rest] = line.split(':');
    if (!key || rest.length === 0) continue;
    const k = key.trim();
    const v = rest.join(':').trim();

    if (k === 'outcome') meta.outcome = v;
    if (k === 'message_count') meta.messageCount = parseInt(v, 10) || 0;
    if (k === 'has_tool_use') meta.hasToolUse = v === 'true';
    if (k === 'date') meta.date = v;
    if (k === 'topics') {
      // topics may be inline array: [a, b, c] or a bare comma-list
      const inner = v.replace(/^\[/, '').replace(/]$/, '');
      meta.topics = inner
        .split(',')
        .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }
  }

  return meta;
}

// Map well-known tool names to their corresponding skill names.
// Core tools (schedule_task, send_message) are skipped — they belong to the
// platform, not a user-facing skill.
const TOOL_TO_SKILL: Record<string, string | null> = {
  search_conversations: 'search-conversations',
  browser: 'agent-browser',
  puppeteer: 'agent-browser',
  playwright: 'agent-browser',
  agent_browser: 'agent-browser',
  'agent-browser': 'agent-browser',
  // Core tools — skip
  schedule_task: null,
  send_message: null,
  update_task: null,
};

// ---------------------------------------------------------------------------
// Skill detection
// ---------------------------------------------------------------------------

/**
 * Scan conversation text for skill references and return deduplicated list of
 * detected skill names.
 */
export function detectSkillUsage(content: string): string[] {
  const found = new Set<string>();

  // 1. Path-based references:
  //    /workspace/.claude/skills/{name}/  or  skills/{name}/SKILL.md
  const pathRe =
    /(?:\/workspace\/\.claude\/skills\/|skills\/)([a-z0-9_-]+)(?:\/|\/SKILL\.md)/gi;
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(content)) !== null) {
    found.add(m[1]);
  }

  // 2. Tool name references (function-call style or plain mention)
  for (const [tool, skill] of Object.entries(TOOL_TO_SKILL)) {
    if (skill === null) continue; // core tool, skip
    // Match tool name as a whole word (case-insensitive)
    const toolRe = new RegExp(`\\b${tool.replace(/-/g, '[_-]')}\\b`, 'i');
    if (toolRe.test(content)) {
      found.add(skill);
    }
  }

  // 3. Explicit skill mentions: "using the X skill", "following the X guide"
  const explicitRe =
    /(?:using|with|following|via)\s+(?:the\s+)?([a-z0-9_-]+)\s+(?:skill|guide)/gi;
  while ((m = explicitRe.exec(content)) !== null) {
    found.add(m[1]);
  }

  return Array.from(found);
}

// ---------------------------------------------------------------------------
// Scan conversations for a single group
// ---------------------------------------------------------------------------

export function scanGroupSkillUsage(
  groupFolder: string,
): Map<string, SkillStats> {
  const stats = new Map<string, SkillStats>();
  const convoDir = path.join(GROUPS_DIR, groupFolder, 'conversations');

  if (!fs.existsSync(convoDir)) return stats;

  const files = fs.readdirSync(convoDir).filter((f) => f.endsWith('.md'));

  for (const file of files) {
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(convoDir, file), 'utf-8');
    } catch {
      continue;
    }

    const meta = parseFrontmatter(raw);
    const skills = detectSkillUsage(raw);

    for (const skill of skills) {
      let entry = stats.get(skill);
      if (!entry) {
        entry = {
          skillName: skill,
          timesUsed: 0,
          successCount: 0,
          errorCount: 0,
          incompleteCount: 0,
          commonTopics: [],
          avgMessageCount: 0,
          lastUsed: '',
        };
        stats.set(skill, entry);
      }

      entry.timesUsed += 1;

      if (meta.outcome === 'success') entry.successCount += 1;
      else if (meta.outcome === 'error') entry.errorCount += 1;
      else if (meta.outcome === 'incomplete') entry.incompleteCount += 1;

      // Running sum stored in avgMessageCount; we'll divide later
      entry.avgMessageCount += meta.messageCount ?? 0;

      // Track date for lastUsed
      if (meta.date && meta.date > entry.lastUsed) {
        entry.lastUsed = meta.date;
      }

      // Accumulate topics — we'll pick top 3 later
      if (meta.topics) {
        (entry as SkillStats & { _allTopics?: string[] })._allTopics =
          (entry as SkillStats & { _allTopics?: string[] })._allTopics ?? [];
        (entry as SkillStats & { _allTopics?: string[] })._allTopics!.push(
          ...meta.topics,
        );
      }
    }
  }

  // Post-process: compute averages and top topics
  for (const entry of stats.values()) {
    if (entry.timesUsed > 0) {
      entry.avgMessageCount = Math.round(entry.avgMessageCount / entry.timesUsed);
    }

    const allTopics =
      (entry as SkillStats & { _allTopics?: string[] })._allTopics ?? [];
    const topicCounts = new Map<string, number>();
    for (const t of allTopics) {
      topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
    }
    entry.commonTopics = Array.from(topicCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t]) => t);

    // Clean up transient property
    delete (entry as SkillStats & { _allTopics?: string[] })._allTopics;
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Available skills discovery
// ---------------------------------------------------------------------------

interface AvailableSkill {
  name: string;
  description: string; // first line from SKILL.md after the # header
}

function discoverAvailableSkills(): AvailableSkill[] {
  const projectRoot = path.resolve(GROUPS_DIR, '..');
  const skillsDir = path.join(projectRoot, 'container', 'skills');

  if (!fs.existsSync(skillsDir)) return [];

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const skills: AvailableSkill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillMd = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;

    let description = '';
    try {
      const content = fs.readFileSync(skillMd, 'utf-8');
      // Find first non-empty line after frontmatter and # header
      const lines = content.split('\n');
      let pastFrontmatter = false;
      let foundHeader = false;
      for (const line of lines) {
        if (line.trim() === '---') {
          pastFrontmatter = !pastFrontmatter;
          continue;
        }
        if (pastFrontmatter) continue; // inside frontmatter
        if (line.startsWith('# ') && !foundHeader) {
          foundHeader = true;
          continue;
        }
        if (foundHeader && line.trim()) {
          description = line.trim();
          break;
        }
      }
    } catch {
      // ignore read errors
    }

    skills.push({ name: entry.name, description });
  }

  return skills;
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

const MAX_REPORT_SIZE = 2048; // 2KB cap

export function generateSkillReport(groupFolder: string): void {
  const stats = scanGroupSkillUsage(groupFolder);
  const available = discoverAvailableSkills();
  const usedSkillNames = new Set(stats.keys());

  // Classify skills
  const effective: SkillStats[] = [];
  const underperforming: SkillStats[] = [];

  for (const s of stats.values()) {
    const successRate = s.timesUsed > 0 ? s.successCount / s.timesUsed : 0;
    if (successRate > 0.5 && s.timesUsed >= 2) {
      effective.push(s);
    } else if (successRate < 0.3 && s.timesUsed >= 3) {
      underperforming.push(s);
    }
  }

  // Sort effective by success rate descending
  effective.sort((a, b) => {
    const rateA = a.successCount / a.timesUsed;
    const rateB = b.successCount / b.timesUsed;
    return rateB - rateA;
  });

  underperforming.sort((a, b) => a.successCount / a.timesUsed - b.successCount / b.timesUsed);

  const unused = available.filter((a) => !usedSkillNames.has(a.name));

  // Build report
  const now = new Date().toISOString().split('T')[0];
  const lines: string[] = [
    '# Skill Effectiveness Report',
    `_Auto-generated. Last updated: ${now}_`,
    '',
  ];

  if (effective.length > 0) {
    lines.push('## Most Effective Skills');
    lines.push('| Skill | Uses | Success% | Common Topics |');
    lines.push('|-------|------|----------|---------------|');
    for (const s of effective) {
      const pct = Math.round((s.successCount / s.timesUsed) * 100);
      const topics = s.commonTopics.join(', ') || '-';
      lines.push(`| ${s.skillName} | ${s.timesUsed} | ${pct}% | ${topics} |`);
    }
    lines.push('');
  }

  if (underperforming.length > 0) {
    lines.push('## Underperforming Skills (review needed)');
    lines.push('| Skill | Uses | Success% | Note |');
    lines.push('|-------|------|----------|------|');
    for (const s of underperforming) {
      const pct = Math.round((s.successCount / s.timesUsed) * 100);
      lines.push(`| ${s.skillName} | ${s.timesUsed} | ${pct}% | Low success rate |`);
    }
    lines.push('');
  }

  if (unused.length > 0) {
    lines.push('## Available but Unused Skills');
    for (const s of unused) {
      const desc = s.description ? `: ${s.description}` : '';
      lines.push(`- ${s.name}${desc}`);
    }
    lines.push('');
  }

  // If all sections are empty, note that
  if (effective.length === 0 && underperforming.length === 0 && unused.length === 0) {
    lines.push('No skill data available yet. Conversations will be analyzed as they accumulate.');
    lines.push('');
  }

  let report = lines.join('\n');

  // Enforce 2KB cap by trimming unused skills list if needed
  if (Buffer.byteLength(report, 'utf-8') > MAX_REPORT_SIZE) {
    // Truncate from the end until under cap
    while (
      Buffer.byteLength(report, 'utf-8') > MAX_REPORT_SIZE &&
      report.includes('\n')
    ) {
      report = report.slice(0, report.lastIndexOf('\n'));
    }
    report += '\n...(truncated)\n';
  }

  const outPath = path.join(GROUPS_DIR, groupFolder, 'skill-effectiveness.md');
  try {
    fs.writeFileSync(outPath, report, 'utf-8');
    logger.info({ group: groupFolder, path: outPath }, 'Skill effectiveness report written');
  } catch (err) {
    logger.error({ err, group: groupFolder }, 'Failed to write skill effectiveness report');
  }
}

// ---------------------------------------------------------------------------
// Startup / scheduling
// ---------------------------------------------------------------------------

const SIX_HOURS = 6 * 60 * 60 * 1000;
const THREE_MINUTES = 3 * 60 * 1000;

function generateAllReports(): void {
  if (!fs.existsSync(GROUPS_DIR)) return;

  const entries = fs.readdirSync(GROUPS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Skip global meta folder
    if (entry.name === 'global') continue;
    try {
      generateSkillReport(entry.name);
    } catch (err) {
      logger.error({ err, group: entry.name }, 'Skill report generation failed');
    }
  }
}

export function startSkillTracker(): void {
  logger.info('Skill tracker scheduled (6h interval, first run in 3 min)');

  // Delayed first run — let indexer/archiver finish first
  setTimeout(() => {
    generateAllReports();
  }, THREE_MINUTES);

  // Recurring runs every 6 hours
  setInterval(() => {
    generateAllReports();
  }, SIX_HOURS);
}
