/**
 * Proactive Insights
 * Detects notable changes in per-group learning data and queues
 * brief insights for the agent to surface during conversation.
 */
import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';
import { hooks } from './lifecycle-hooks.js';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export interface Insight {
  id: string;
  type: 'trend' | 'milestone' | 'anomaly' | 'recommendation';
  priority: 'high' | 'medium' | 'low';
  message: string;
  detail?: string;
  createdAt: string;
  delivered: boolean;
}

const INSIGHTS_FILE = 'pending-insights.md';
const MAX_PENDING = 5;
const PRUNE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const INITIAL_DELAY_MS = 10 * 60 * 1000; // 10 minutes
const INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function readArtifact(groupFolder: string, filename: string): string | null {
  const filePath = path.join(groupFolder, filename);
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Insight detection — individual artifact scanners
// ---------------------------------------------------------------------------

function detectQualityTrends(groupFolder: string): Insight[] {
  const content = readArtifact(groupFolder, 'quality-trends.md');
  if (!content) return [];

  const insights: Insight[] = [];
  const scoreMatch = content.match(/Average quality:\s*([\d.]+)/i);
  if (!scoreMatch) return [];

  const score = parseFloat(scoreMatch[1]);
  if (isNaN(score)) return [];

  if (score < 0.5) {
    // Find lowest signal for context
    const signalMatches = [
      ...content.matchAll(/[-*]\s*(\w[\w\s]*?):\s*([\d.]+)/g),
    ];
    let lowestSignal = 'overall quality';
    let lowestVal = score;
    for (const m of signalMatches) {
      const val = parseFloat(m[2]);
      if (!isNaN(val) && val < lowestVal) {
        lowestVal = val;
        lowestSignal = m[1].trim().toLowerCase();
      }
    }

    insights.push({
      id: `quality-drop-${new Date().toISOString().slice(0, 10)}`,
      type: 'anomaly',
      priority: 'high',
      message:
        `Conversation quality has dropped to ${score.toFixed(2)} — ${lowestSignal} needs attention`.slice(
          0,
          200,
        ),
      createdAt: new Date().toISOString(),
      delivered: false,
    });
  } else if (score > 0.8) {
    insights.push({
      id: `quality-high-${new Date().toISOString().slice(0, 10)}`,
      type: 'milestone',
      priority: 'low',
      message:
        `Quality score reached ${score.toFixed(2)} — nice improvement!`.slice(
          0,
          200,
        ),
      createdAt: new Date().toISOString(),
      delivered: false,
    });
  }

  return insights;
}

function detectTaskScorecard(groupFolder: string): Insight[] {
  const content = readArtifact(groupFolder, 'task-scorecard.md');
  if (!content) return [];

  const insights: Insight[] = [];

  // Parse table rows: | task-id | ... | suppression% | ...
  // Look for rows with percentages > 90
  const rows = content.split('\n').filter((line) => line.startsWith('|'));
  let hasNegativeValue = false;

  for (const row of rows) {
    const cells = row
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 2) continue;

    // Skip header/separator rows
    if (cells[0].startsWith('-') || cells[0].toLowerCase() === 'task') continue;

    const taskId = cells[0];

    // Look for suppression percentage in any cell
    for (const cell of cells) {
      const pctMatch = cell.match(/([\d.]+)%/);
      if (pctMatch) {
        const pct = parseFloat(pctMatch[1]);
        if (!isNaN(pct) && pct > 90) {
          // Check if this is a suppression column (heuristic: column header contains "suppress")
          insights.push({
            id: `task-suppress-${taskId}`,
            type: 'recommendation',
            priority: 'medium',
            message:
              `Task '${taskId}' is suppressed ${pct.toFixed(0)}% of the time — consider pausing it`.slice(
                0,
                200,
              ),
            createdAt: new Date().toISOString(),
            delivered: false,
          });
          break;
        }
      }
    }

    // Check for value scores — look for negative numbers or explicit negative indicators
    for (const cell of cells) {
      const valMatch = cell.match(/(-[\d.]+)/);
      if (valMatch) {
        hasNegativeValue = true;
        break;
      }
    }
  }

  // All tasks positive?
  if (rows.length > 2 && !hasNegativeValue && insights.length === 0) {
    insights.push({
      id: `tasks-healthy-${new Date().toISOString().slice(0, 10)}`,
      type: 'milestone',
      priority: 'low',
      message: 'All scheduled tasks are producing value — good health',
      createdAt: new Date().toISOString(),
      delivered: false,
    });
  }

  return insights;
}

function detectFailurePatterns(groupFolder: string): Insight[] {
  const content = readArtifact(groupFolder, 'failure-patterns.md');
  if (!content) return [];

  const insights: Insight[] = [];
  const now = Date.now();
  const recentThreshold = 7 * 24 * 60 * 60 * 1000; // 7 days

  // Pattern: ## Category (N occurrences)
  const categoryPattern = /## (.+?)\s*\((\d+)\s*occurrences?\)/gi;
  let match;

  while ((match = categoryPattern.exec(content)) !== null) {
    const category = match[1].trim();
    const count = parseInt(match[2], 10);

    // Extract lastSeen from the section following this header
    const sectionStart = match.index + match[0].length;
    const nextHeader = content.indexOf('\n## ', sectionStart);
    const section = content.slice(
      sectionStart,
      nextHeader === -1 ? undefined : nextHeader,
    );

    const lastSeenMatch = section.match(/last\s*seen[:\s]*([\d-T:.Z]+)/i);
    let isRecent = false;
    if (lastSeenMatch) {
      const lastSeen = new Date(lastSeenMatch[1]).getTime();
      isRecent = !isNaN(lastSeen) && now - lastSeen < recentThreshold;
    }

    // Extract recovery hint if present
    const recoveryMatch = section.match(/recovery[:\s]*(.+?)(?:\n|$)/i);
    const recoveryHint = recoveryMatch
      ? recoveryMatch[1].trim()
      : 'check logs for details';

    if (count > 3 && isRecent) {
      insights.push({
        id: `failure-recurring-${category.toLowerCase().replace(/\s+/g, '-')}`,
        type: 'anomaly',
        priority: 'high',
        message:
          `'${category}' errors are recurring (${count} times) — ${recoveryHint}`.slice(
            0,
            200,
          ),
        createdAt: new Date().toISOString(),
        delivered: false,
      });
    } else if (count > 3 && !isRecent) {
      insights.push({
        id: `failure-resolved-${category.toLowerCase().replace(/\s+/g, '-')}`,
        type: 'milestone',
        priority: 'low',
        message: `No '${category}' errors recently — that fix is working`.slice(
          0,
          200,
        ),
        createdAt: new Date().toISOString(),
        delivered: false,
      });
    }
  }

  return insights;
}

function detectLessons(groupFolder: string): Insight[] {
  const content = readArtifact(groupFolder, 'lessons.md');
  if (!content) return [];

  // Count items: lines starting with - or * that aren't headers/separators
  const items = content
    .split('\n')
    .filter((line) => /^\s*[-*]\s+\S/.test(line));

  if (items.length <= 10) return [];

  // Count category sections (## headers)
  const categories = content
    .split('\n')
    .filter((line) => /^##\s+/.test(line)).length;

  return [
    {
      id: `lessons-growing-${new Date().toISOString().slice(0, 10)}`,
      type: 'milestone',
      priority: 'low',
      message:
        `Knowledge base growing — ${items.length} lessons learned across ${categories || 1} categories`.slice(
          0,
          200,
        ),
      createdAt: new Date().toISOString(),
      delivered: false,
    },
  ];
}

function detectSkillEffectiveness(groupFolder: string): Insight[] {
  const content = readArtifact(groupFolder, 'skill-effectiveness.md');
  if (!content) return [];

  const insights: Insight[] = [];
  const rows = content.split('\n').filter((line) => line.startsWith('|'));

  for (const row of rows) {
    const cells = row
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 2) continue;

    // Skip header/separator rows
    if (cells[0].startsWith('-') || cells[0].toLowerCase() === 'skill')
      continue;

    const skillName = cells[0];

    // Look for success rate percentage
    for (let i = 1; i < cells.length; i++) {
      const pctMatch = cells[i].match(/([\d.]+)%/);
      if (pctMatch) {
        const pct = parseFloat(pctMatch[1]);
        if (!isNaN(pct) && pct < 30) {
          insights.push({
            id: `skill-underperform-${skillName.toLowerCase().replace(/\s+/g, '-')}`,
            type: 'recommendation',
            priority: 'medium',
            message:
              `Skill '${skillName}' is underperforming (${pct.toFixed(0)}% success) — try alternative approaches`.slice(
                0,
                200,
              ),
            createdAt: new Date().toISOString(),
            delivered: false,
          });
        }
        break; // First percentage in row is success rate
      }
    }
  }

  // Check for unused skills: rows with 0 uses or "0" in a count column
  const unusedSkills: string[] = [];
  for (const row of rows) {
    const cells = row
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 2) continue;
    if (cells[0].startsWith('-') || cells[0].toLowerCase() === 'skill')
      continue;

    // Look for a "0" count that might indicate unused
    const hasZeroUses = cells.some((c) => /^\s*0\s*$/.test(c));
    if (hasZeroUses) {
      unusedSkills.push(cells[0]);
    }
  }

  if (unusedSkills.length > 0) {
    const firstName = unusedSkills[0];
    insights.push({
      id: `skills-unused-${new Date().toISOString().slice(0, 10)}`,
      type: 'recommendation',
      priority: 'low',
      message:
        `You have ${unusedSkills.length} unused skills — try ${firstName}`.slice(
          0,
          200,
        ),
      createdAt: new Date().toISOString(),
      delivered: false,
    });
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Main detection orchestrator
// ---------------------------------------------------------------------------

function detectInsights(groupFolder: string): Insight[] {
  const all: Insight[] = [
    ...detectQualityTrends(groupFolder),
    ...detectTaskScorecard(groupFolder),
    ...detectFailurePatterns(groupFolder),
    ...detectLessons(groupFolder),
    ...detectSkillEffectiveness(groupFolder),
  ];
  return all;
}

// ---------------------------------------------------------------------------
// Persistence — load / save / mark delivered
// ---------------------------------------------------------------------------

export function loadInsights(groupFolder: string): Insight[] {
  const filePath = path.join(groupFolder, INSIGHTS_FILE);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const dataMatch = content.match(/<!-- insights-data\n([\s\S]*?)\n-->/);
    if (!dataMatch) return [];
    return JSON.parse(dataMatch[1]) as Insight[];
  } catch {
    return [];
  }
}

export function saveInsights(groupFolder: string, insights: Insight[]): void {
  // Remove delivered insights
  const now = Date.now();
  const pending = insights.filter((i) => {
    if (i.delivered) return false;
    // Auto-prune insights older than 7 days
    const age = now - new Date(i.createdAt).getTime();
    return age < PRUNE_AGE_MS;
  });

  // Prioritize and cap at MAX_PENDING
  const priorityOrder: Record<string, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  pending.sort(
    (a, b) =>
      (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3),
  );
  const capped = pending.slice(0, MAX_PENDING);

  // Group by priority for markdown rendering
  const high = capped.filter((i) => i.priority === 'high');
  const medium = capped.filter((i) => i.priority === 'medium');
  const low = capped.filter((i) => i.priority === 'low');

  let md = '# Pending Insights\n';
  md += '_Insights for the agent to mention during conversation._\n';

  if (high.length > 0) {
    md += '\n## High Priority\n';
    for (const i of high) {
      md += `- **[${i.type}]** ${i.message}\n`;
      if (i.detail) md += `  ${i.detail}\n`;
    }
  }

  if (medium.length > 0) {
    md += '\n## Medium Priority\n';
    for (const i of medium) {
      md += `- **[${i.type}]** ${i.message}\n`;
      if (i.detail) md += `  ${i.detail}\n`;
    }
  }

  if (low.length > 0) {
    md += '\n## Low Priority\n';
    for (const i of low) {
      md += `- **[${i.type}]** ${i.message}\n`;
      if (i.detail) md += `  ${i.detail}\n`;
    }
  }

  md += `\n<!-- insights-data\n${JSON.stringify(capped)}\n-->\n`;

  const filePath = path.join(groupFolder, INSIGHTS_FILE);
  fs.writeFileSync(filePath, md, 'utf-8');
}

export function markInsightDelivered(
  groupFolder: string,
  insightId: string,
): void {
  const insights = loadInsights(groupFolder);
  const target = insights.find((i) => i.id === insightId);
  if (target) {
    target.delivered = true;
    saveInsights(groupFolder, insights);
    logger.debug({ insightId, groupFolder }, 'Insight marked delivered');
  }
}

// ---------------------------------------------------------------------------
// Deduplication helper
// ---------------------------------------------------------------------------

function isDuplicate(existing: Insight[], candidate: Insight): boolean {
  const candidateKey = candidate.type + candidate.message.slice(0, 50);
  return existing.some((e) => e.type + e.message.slice(0, 50) === candidateKey);
}

// ---------------------------------------------------------------------------
// Generation — detect, merge, save
// ---------------------------------------------------------------------------

export function generateInsights(groupFolder: string): void {
  const existing = loadInsights(groupFolder);
  const detected = detectInsights(groupFolder);

  let added = 0;
  const merged = [...existing];

  for (const insight of detected) {
    if (!isDuplicate(merged, insight)) {
      merged.push(insight);
      added++;
    }
  }

  if (added > 0) {
    saveInsights(groupFolder, merged);
    logger.info(
      { groupFolder: path.basename(groupFolder), added },
      'Proactive insights generated',
    );
  }
}

// ---------------------------------------------------------------------------
// Scheduling — hook + interval
// ---------------------------------------------------------------------------

function runForAllGroups(): void {
  try {
    if (!fs.existsSync(GROUPS_DIR)) return;
    const entries = fs.readdirSync(GROUPS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const groupFolder = path.join(GROUPS_DIR, entry.name);
      try {
        generateInsights(groupFolder);
      } catch (err) {
        logger.warn(
          { err, group: entry.name },
          'Failed to generate insights for group',
        );
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to enumerate groups for insights');
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startProactiveInsights(): void {
  // Register on learning:indexed hook
  hooks.on('learning:indexed', (event) => {
    try {
      generateInsights(event.groupFolder);
    } catch (err) {
      logger.warn(
        { err, groupFolder: event.groupFolder },
        'Insight generation failed on learning:indexed',
      );
    }
  });

  // First run delayed 10 minutes
  setTimeout(() => {
    runForAllGroups();

    // Then every 12 hours
    intervalHandle = setInterval(runForAllGroups, INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  logger.info('Proactive insights system started');
}
