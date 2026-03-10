/**
 * Goal Tracker
 * Manages per-group goals with progress tracking.
 *
 * Goals are stored as human-readable Markdown with an embedded JSON block
 * in each group's `goals.md` file. Progress is updated heuristically by
 * scanning learning artifacts (task-scorecard, failure-patterns, etc.)
 * and recent conversation files.
 */
import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';
import { hooks } from './lifecycle-hooks.js';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export interface Goal {
  id: string; // short slug e.g. "reduce-vps-alerts"
  title: string; // "Reduce VPS alerts to under 2 per week"
  type: 'metric' | 'milestone' | 'habit';
  target?: string; // "< 2 alerts/week" for metric goals
  deadline?: string; // ISO date, optional
  status: 'active' | 'completed' | 'stalled';
  progress: number; // 0-100 percentage
  lastUpdated: string; // ISO date
  notes: string[]; // max 5 recent progress notes
  createdAt: string; // ISO date
}

const GOALS_FILE = 'goals.md';
const MAX_ACTIVE_GOALS = 10;
const MAX_COMPLETED_GOALS = 5;
const MAX_NOTES = 5;
const STALE_DAYS = 14;
const HUMAN_READABLE_MAX_BYTES = 3072; // 3KB cap for the readable portion
const GOALS_DATA_OPEN = '<!-- goals-data';
const GOALS_DATA_CLOSE = '-->';
const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FIRST_RUN_DELAY_MS = 8 * 60 * 1000; // 8 minutes

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

function goalsFilePath(groupFolder: string): string {
  return path.join(groupFolder, GOALS_FILE);
}

export function loadGoals(groupFolder: string): Goal[] {
  const filePath = goalsFilePath(groupFolder);
  if (!fs.existsSync(filePath)) return [];

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const dataStart = content.indexOf(GOALS_DATA_OPEN);
    if (dataStart === -1) return [];

    const jsonStart = content.indexOf('\n', dataStart);
    if (jsonStart === -1) return [];

    const jsonEnd = content.indexOf(GOALS_DATA_CLOSE, jsonStart);
    if (jsonEnd === -1) return [];

    const jsonStr = content.slice(jsonStart, jsonEnd).trim();
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];

    return parsed as Goal[];
  } catch (err) {
    logger.warn({ err, groupFolder }, 'Failed to parse goals.md');
    return [];
  }
}

export function saveGoals(groupFolder: string, goals: Goal[]): void {
  // Enforce limits
  const active = goals
    .filter((g) => g.status === 'active')
    .slice(0, MAX_ACTIVE_GOALS);
  const completed = goals
    .filter((g) => g.status === 'completed')
    .sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated))
    .slice(0, MAX_COMPLETED_GOALS);
  const stalled = goals.filter((g) => g.status === 'stalled');

  const allGoals = [...active, ...stalled, ...completed];

  // Trim notes to MAX_NOTES each
  for (const goal of allGoals) {
    goal.notes = goal.notes.slice(0, MAX_NOTES);
  }

  const now = new Date().toISOString().slice(0, 10);
  let md = `# Goals\n_Last updated: ${now}_\n`;

  // Active goals section
  if (active.length > 0 || stalled.length > 0) {
    md += '\n## Active Goals\n';
    for (const goal of [...active, ...stalled]) {
      md += renderGoalMarkdown(goal);
    }
  }

  // Completed goals section
  if (completed.length > 0) {
    md += '\n## Completed Goals\n';
    for (const goal of completed) {
      md += `- ~~${goal.id}~~ \u2014 ${goal.title} \u2713 (completed ${goal.lastUpdated.slice(0, 10)})\n`;
    }
  }

  // Cap human-readable portion
  if (Buffer.byteLength(md, 'utf-8') > HUMAN_READABLE_MAX_BYTES) {
    // Truncate from the end but keep header
    const headerEnd = md.indexOf('\n## ');
    if (headerEnd > 0) {
      const maxLen = HUMAN_READABLE_MAX_BYTES - 50; // leave room for truncation note
      if (Buffer.byteLength(md, 'utf-8') > maxLen) {
        md =
          md.slice(0, maxLen) +
          '\n\n_(truncated \u2014 see goals-data for full list)_\n';
      }
    }
  }

  // Append JSON data block
  md += `\n${GOALS_DATA_OPEN}\n${JSON.stringify(allGoals)}\n${GOALS_DATA_CLOSE}\n`;

  const filePath = goalsFilePath(groupFolder);
  fs.writeFileSync(filePath, md, 'utf-8');
}

function renderGoalMarkdown(goal: Goal): string {
  let md = `\n### ${goal.id} \u2014 ${goal.title}\n`;

  const parts: string[] = [`**Type**: ${goal.type}`];
  if (goal.target) parts.push(`**Target**: ${goal.target}`);
  parts.push(`**Progress**: ${goal.progress}%`);
  if (goal.status === 'stalled') parts.push('**Status**: stalled');
  md += `- ${parts.join(' | ')}\n`;

  if (goal.deadline) {
    md += `- **Deadline**: ${goal.deadline.slice(0, 10)}\n`;
  }

  for (const note of goal.notes.slice(0, 3)) {
    md += `- Recent: ${note}\n`;
  }

  return md;
}

// ---------------------------------------------------------------------------
// Progress update logic
// ---------------------------------------------------------------------------

/** Read a file if it exists, returning its content or empty string. */
function readArtifact(groupFolder: string, filename: string): string {
  const filePath = path.join(groupFolder, filename);
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  } catch {
    return '';
  }
}

/** List conversation files modified in the last N days. */
function recentConversations(groupFolder: string, days: number): string[] {
  const conversationsDir = path.join(groupFolder, 'conversations');
  if (!fs.existsSync(conversationsDir)) return [];

  try {
    const cutoff = Date.now() - days * 86400000;
    return fs
      .readdirSync(conversationsDir)
      .filter((f) => f.endsWith('.md') || f.endsWith('.txt'))
      .map((f) => path.join(conversationsDir, f))
      .filter((fp) => {
        try {
          return fs.statSync(fp).mtimeMs >= cutoff;
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

/** Simple keyword matching: does the text mention the goal? */
function mentionsGoal(text: string, goal: Goal): boolean {
  const lower = text.toLowerCase();
  // Check slug words and title words
  const slugWords = goal.id.split('-').filter((w) => w.length > 2);
  const titleWords = goal.title
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const keywords = [...new Set([...slugWords, ...titleWords])];
  // Require at least 2 keyword matches (or 1 if few keywords)
  const threshold = Math.min(2, keywords.length);
  let matches = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) matches++;
  }
  return matches >= threshold;
}

/** Extract numbers from text near goal-related keywords. */
function extractNumbers(text: string, goal: Goal): number[] {
  const lower = text.toLowerCase();
  const nums: number[] = [];
  // Find lines mentioning the goal, then extract numbers
  const lines = lower.split('\n');
  for (const line of lines) {
    if (!mentionsGoal(line + ' ' + goal.id, goal)) continue;
    const matches = line.match(/\d+(\.\d+)?/g);
    if (matches) {
      for (const m of matches) {
        const n = parseFloat(m);
        if (!isNaN(n) && n <= 10000) nums.push(n);
      }
    }
  }
  return nums;
}

/** Check for completion signals in text. */
function hasCompletionSignal(text: string): boolean {
  const completionPatterns = [
    /\b(done|shipped|deployed|completed|finished|launched|released)\b/i,
    /\b(merged|delivered|closed|resolved)\b/i,
    /\u2705|\u2714|100%/,
  ];
  return completionPatterns.some((p) => p.test(text));
}

/** Count how many recent conversations mention the goal (for habit tracking). */
function countMentioningSessions(convFiles: string[], goal: Goal): number {
  let count = 0;
  for (const fp of convFiles) {
    try {
      const content = fs.readFileSync(fp, 'utf-8');
      if (mentionsGoal(content, goal)) count++;
    } catch {
      // skip unreadable files
    }
  }
  return count;
}

export function updateGoalProgress(groupFolder: string): void {
  const goals = loadGoals(groupFolder);
  if (goals.length === 0) return;

  const scorecard = readArtifact(groupFolder, 'task-scorecard.md');
  const failures = readArtifact(groupFolder, 'failure-patterns.md');
  const quality = readArtifact(groupFolder, 'quality-trends.md');
  const allArtifacts = [scorecard, failures, quality].join('\n');

  const convFiles = recentConversations(groupFolder, 7);
  let recentText = '';
  for (const fp of convFiles.slice(0, 20)) {
    // Cap to avoid reading too many files
    try {
      recentText += fs.readFileSync(fp, 'utf-8') + '\n';
    } catch {
      // skip
    }
  }

  const combinedText = allArtifacts + '\n' + recentText;
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  let changed = false;

  for (const goal of goals) {
    if (goal.status !== 'active' && goal.status !== 'stalled') continue;

    const prevProgress = goal.progress;
    let newNote: string | null = null;

    switch (goal.type) {
      case 'metric': {
        // Look for numbers in artifacts/conversations that relate to the goal
        const nums = extractNumbers(combinedText, goal);
        if (nums.length > 0) {
          // Use the most recent (last) number found as a heuristic signal
          const latest = nums[nums.length - 1];
          // If target mentions a number, try to compute progress
          if (goal.target) {
            const targetNums = goal.target.match(/\d+(\.\d+)?/g);
            if (targetNums && targetNums.length > 0) {
              const targetVal = parseFloat(targetNums[0]);
              if (targetVal > 0) {
                // For "< X" targets, lower is better
                const isLowerBetter = goal.target.includes('<');
                if (isLowerBetter) {
                  // progress = how close we are to being under the target
                  const ratio = Math.max(0, 1 - latest / (targetVal * 2));
                  goal.progress = Math.min(100, Math.round(ratio * 100));
                } else {
                  goal.progress = Math.min(
                    100,
                    Math.round((latest / targetVal) * 100),
                  );
                }
              }
            }
          }
          if (goal.progress !== prevProgress) {
            newNote = `Progress updated to ${goal.progress}% (metric value: ${nums[nums.length - 1]})`;
          }
        }
        break;
      }

      case 'milestone': {
        // Look for completion signals in recent text
        const relevantText = combinedText
          .split('\n')
          .filter((line) => mentionsGoal(line + ' ' + goal.id, { ...goal }))
          .join('\n');

        if (hasCompletionSignal(relevantText)) {
          goal.progress = 100;
          newNote = 'Completion signal detected in recent activity';
        } else if (mentionsGoal(combinedText, goal)) {
          // Bump progress slightly if there's activity
          if (goal.progress < 95) {
            goal.progress = Math.min(95, goal.progress + 5);
            newNote = 'Activity detected related to this goal';
          }
        }
        break;
      }

      case 'habit': {
        // Count sessions in last 7 days mentioning the goal topic
        const count = countMentioningSessions(convFiles, goal);
        // Assume a habit goal targets ~5 sessions per week
        goal.progress = Math.min(100, Math.round((count / 5) * 100));
        if (goal.progress !== prevProgress) {
          newNote = `${count} related session(s) in the last 7 days`;
        }
        break;
      }
    }

    // Add note if something changed
    if (newNote) {
      goal.notes.unshift(newNote);
      goal.notes = goal.notes.slice(0, MAX_NOTES);
      goal.lastUpdated = today;
      changed = true;
    }

    // Mark completed if progress >= 100
    if (goal.progress >= 100) {
      goal.status = 'completed';
      goal.lastUpdated = today;
      changed = true;
      logger.info({ goalId: goal.id, groupFolder }, 'Goal completed');
    }

    // Mark stalled if no progress change in 14 days
    if (goal.status === 'active' && goal.progress === prevProgress) {
      const lastUpdate = new Date(goal.lastUpdated).getTime();
      const staleDays = (Date.now() - lastUpdate) / 86400000;
      if (staleDays >= STALE_DAYS) {
        goal.status = 'stalled';
        goal.lastUpdated = today;
        goal.notes.unshift(
          `No progress in ${Math.round(staleDays)} days \u2014 marked stalled`,
        );
        goal.notes = goal.notes.slice(0, MAX_NOTES);
        changed = true;
        logger.info({ goalId: goal.id, groupFolder }, 'Goal marked as stalled');
      }
    }

    // Un-stall if progress was made
    if (goal.status === 'stalled' && goal.progress !== prevProgress) {
      goal.status = 'active';
      changed = true;
    }
  }

  if (changed) {
    saveGoals(groupFolder, goals);
    logger.debug({ groupFolder }, 'Goals updated');
  }
}

// ---------------------------------------------------------------------------
// Startup and scheduling
// ---------------------------------------------------------------------------

let scanInterval: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;

function scanAllGroups(): void {
  try {
    if (!fs.existsSync(GROUPS_DIR)) return;
    const entries = fs.readdirSync(GROUPS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const groupFolder = path.join(GROUPS_DIR, entry.name);
      const goalsPath = path.join(groupFolder, GOALS_FILE);
      if (fs.existsSync(goalsPath)) {
        try {
          updateGoalProgress(groupFolder);
        } catch (err) {
          logger.warn({ err, groupFolder }, 'Error updating goals for group');
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Error scanning groups for goal updates');
  }
}

export function startGoalTracker(): void {
  // Register session:end hook to update goals for the group that just finished
  hooks.on('session:end', (payload) => {
    try {
      const groupFolder = path.join(GROUPS_DIR, payload.groupFolder);
      if (fs.existsSync(path.join(groupFolder, GOALS_FILE))) {
        updateGoalProgress(groupFolder);
      }
    } catch (err) {
      logger.warn(
        { err, groupFolder: payload.groupFolder },
        'Error updating goals on session end',
      );
    }
  });

  // First run delayed 8 minutes
  startupTimer = setTimeout(() => {
    scanAllGroups();

    // Then every 24 hours
    scanInterval = setInterval(scanAllGroups, SCAN_INTERVAL_MS);
  }, FIRST_RUN_DELAY_MS);

  logger.info('Goal tracker started (first scan in 8 minutes)');
}

// Exported for testing: clean up timers
export function stopGoalTracker(): void {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
}
