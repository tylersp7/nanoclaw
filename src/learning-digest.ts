/**
 * Learning Metrics Digest
 * Generates weekly digest comparing learning metrics period-over-period.
 * Parses existing learning artifact files (lessons.md, failure-patterns.md,
 * task-scorecard.md, skill-effectiveness.md) and writes a summary digest.
 */
import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';
import { logger } from './logger.js';

// --- Types ---

export interface DigestMetrics {
  timestamp: string;
  lessonCount: number;
  approachLessons: number;
  avoidanceLessons: number;
  preferenceLessons: number;
  failurePatternCount: number;
  totalFailureOccurrences: number;
  topFailureCategory: string;
  taskCount: number;
  avgValueScore: number;
  highValueTasks: number;
  lowValueTasks: number;
  skillsUsed: number;
  skillsAvailable: number;
  avgSkillSuccessRate: number;
  conversationCount: number;
}

// --- Metric gathering functions ---

/** Parse lessons.md JSON data for counts by category. */
export function countLessons(
  groupFolder: string,
): Pick<
  DigestMetrics,
  'lessonCount' | 'approachLessons' | 'avoidanceLessons' | 'preferenceLessons'
> {
  const result = {
    lessonCount: 0,
    approachLessons: 0,
    avoidanceLessons: 0,
    preferenceLessons: 0,
  };
  const filePath = path.join(groupFolder, 'lessons.md');
  if (!fs.existsSync(filePath)) return result;

  const content = fs.readFileSync(filePath, 'utf-8');

  // Try JSON data in comment block first
  const jsonMatch = content.match(/<!--\s*lessons-data\s+([\s\S]*?)-->/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1].trim());
      if (Array.isArray(data)) {
        result.lessonCount = data.length;
        for (const lesson of data) {
          const cat = (lesson.category || lesson.type || '').toLowerCase();
          if (cat === 'approach' || cat === 'do') result.approachLessons++;
          else if (cat === 'avoidance' || cat === 'avoid' || cat === 'dont')
            result.avoidanceLessons++;
          else if (cat === 'preference') result.preferenceLessons++;
        }
        return result;
      }
    } catch {
      // Fall through to heading-based counting
    }
  }

  // Fallback: count markdown headings as lessons
  const headings = content.match(/^##+ /gm);
  result.lessonCount = headings ? headings.length : 0;

  // Try to categorize by section headers
  const approachMatch = content.match(/approach/gi);
  const avoidMatch = content.match(/avoid/gi);
  const prefMatch = content.match(/preference/gi);
  result.approachLessons = approachMatch ? approachMatch.length : 0;
  result.avoidanceLessons = avoidMatch ? avoidMatch.length : 0;
  result.preferenceLessons = prefMatch ? prefMatch.length : 0;

  return result;
}

/** Parse failure-patterns.md for pattern counts. */
export function countFailurePatterns(
  groupFolder: string,
): Pick<
  DigestMetrics,
  'failurePatternCount' | 'totalFailureOccurrences' | 'topFailureCategory'
> {
  const result = {
    failurePatternCount: 0,
    totalFailureOccurrences: 0,
    topFailureCategory: 'none',
  };
  const filePath = path.join(groupFolder, 'failure-patterns.md');
  if (!fs.existsSync(filePath)) return result;

  const content = fs.readFileSync(filePath, 'utf-8');

  // Parse ## Category (N occurrences) format
  const categoryPattern = /^##\s+(.+?)\s+\((\d+)\s+occurrence/gm;
  let match: RegExpExecArray | null;
  let maxOccurrences = 0;

  while ((match = categoryPattern.exec(content)) !== null) {
    result.failurePatternCount++;
    const occurrences = parseInt(match[2], 10);
    result.totalFailureOccurrences += occurrences;
    if (occurrences > maxOccurrences) {
      maxOccurrences = occurrences;
      result.topFailureCategory = match[1].trim();
    }
  }

  // If no structured format found, count headings as patterns
  if (result.failurePatternCount === 0) {
    const headings = content.match(/^## /gm);
    result.failurePatternCount = headings ? headings.length : 0;
  }

  return result;
}

/** Parse task-scorecard.md tables for task counts and scores. */
export function countTaskMetrics(
  groupFolder: string,
): Pick<
  DigestMetrics,
  'taskCount' | 'avgValueScore' | 'highValueTasks' | 'lowValueTasks'
> {
  const result = {
    taskCount: 0,
    avgValueScore: 0,
    highValueTasks: 0,
    lowValueTasks: 0,
  };
  const filePath = path.join(groupFolder, 'task-scorecard.md');
  if (!fs.existsSync(filePath)) return result;

  const content = fs.readFileSync(filePath, 'utf-8');

  // Parse markdown table rows — look for rows with numbers that could be scores
  // Typical format: | task name | score | status | ... |
  const tableRowPattern = /^\|[^|]+\|\s*(\d+(?:\.\d+)?)\s*\|/gm;
  let match: RegExpExecArray | null;
  const scores: number[] = [];

  while ((match = tableRowPattern.exec(content)) !== null) {
    const score = parseFloat(match[1]);
    if (score >= 0 && score <= 10) {
      scores.push(score);
    }
  }

  if (scores.length > 0) {
    result.taskCount = scores.length;
    result.avgValueScore =
      Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
    result.highValueTasks = scores.filter((s) => s >= 7).length;
    result.lowValueTasks = scores.filter((s) => s <= 3).length;
  } else {
    // Fallback: count table rows (skip header + separator)
    const rows = content.match(/^\|[^-|][^|]*\|/gm);
    result.taskCount = rows ? Math.max(0, rows.length - 1) : 0;
  }

  return result;
}

/** Parse skill-effectiveness.md tables for skill stats. */
export function countSkillMetrics(
  groupFolder: string,
): Pick<
  DigestMetrics,
  'skillsUsed' | 'skillsAvailable' | 'avgSkillSuccessRate'
> {
  const result = { skillsUsed: 0, skillsAvailable: 0, avgSkillSuccessRate: 0 };
  const filePath = path.join(groupFolder, 'skill-effectiveness.md');
  if (!fs.existsSync(filePath)) return result;

  const content = fs.readFileSync(filePath, 'utf-8');

  // Parse table rows for skill data
  // Typical: | skill name | uses | successes | rate | ... |
  const tableRowPattern = /^\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]*)\|/gm;
  let match: RegExpExecArray | null;
  const successRates: number[] = [];
  let totalSkills = 0;
  let usedSkills = 0;

  while ((match = tableRowPattern.exec(content)) !== null) {
    const name = match[1].trim();
    const uses = match[2].trim();
    // Skip header rows
    if (
      name.startsWith('-') ||
      name.toLowerCase() === 'skill' ||
      name.toLowerCase() === 'name'
    )
      continue;

    totalSkills++;
    const useCount = parseInt(uses, 10);
    if (!isNaN(useCount) && useCount > 0) usedSkills++;

    // Try to extract success rate from 4th column
    const rateStr = match[4]?.trim().replace('%', '');
    const rate = parseFloat(rateStr);
    if (!isNaN(rate) && rate >= 0 && rate <= 100) {
      successRates.push(rate);
    }
  }

  result.skillsAvailable = totalSkills;
  result.skillsUsed = usedSkills;
  if (successRates.length > 0) {
    result.avgSkillSuccessRate =
      Math.round(
        (successRates.reduce((a, b) => a + b, 0) / successRates.length) * 10,
      ) / 10;
  }

  return result;
}

/** Count conversation files from the last 7 days. */
export function countConversations(groupFolder: string): number {
  const convDir = path.join(groupFolder, 'conversations');
  if (!fs.existsSync(convDir)) return 0;

  // Build set of date strings for the last 7 days
  const recentDates = new Set<string>();
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    recentDates.add(d.toISOString().slice(0, 10)); // YYYY-MM-DD
  }

  let count = 0;
  try {
    const files = fs.readdirSync(convDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      // Check if filename contains a recent date
      for (const dateStr of recentDates) {
        if (file.includes(dateStr)) {
          count++;
          break;
        }
      }
    }
  } catch {
    // Directory read error — return 0
  }

  return count;
}

// --- Digest generation ---

function trendArrow(delta: number, positiveIsGood: boolean): string {
  if (delta === 0) return '-';
  const isPositive = positiveIsGood ? delta > 0 : delta < 0;
  return isPositive ? 'up' : 'down';
}

function formatDelta(delta: number): string {
  if (delta === 0) return '0';
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function loadPreviousMetrics(digestPath: string): DigestMetrics | null {
  if (!fs.existsSync(digestPath)) return null;
  const content = fs.readFileSync(digestPath, 'utf-8');
  const match = content.match(/<!--\s*digest-data\s+([\s\S]*?)-->/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim()) as DigestMetrics;
  } catch {
    return null;
  }
}

function generateHighlights(
  current: DigestMetrics,
  previous: DigestMetrics | null,
): string[] {
  const highlights: string[] = [];

  if (!previous) {
    highlights.push('First digest generated — baselines established');
    if (current.lessonCount > 0)
      highlights.push(`${current.lessonCount} lessons already captured`);
    if (current.failurePatternCount > 0)
      highlights.push(
        `${current.failurePatternCount} failure patterns tracked`,
      );
    return highlights;
  }

  const lessonDelta = current.lessonCount - previous.lessonCount;
  if (lessonDelta > 0)
    highlights.push(
      `${lessonDelta} new lesson${lessonDelta > 1 ? 's' : ''} learned this period`,
    );

  const failureDelta =
    current.failurePatternCount - previous.failurePatternCount;
  if (failureDelta < 0)
    highlights.push(
      `${Math.abs(failureDelta)} failure pattern${Math.abs(failureDelta) > 1 ? 's' : ''} resolved`,
    );
  if (failureDelta > 0)
    highlights.push(
      `${failureDelta} new failure pattern${failureDelta > 1 ? 's' : ''} detected`,
    );

  const scoreDelta = current.avgValueScore - previous.avgValueScore;
  if (scoreDelta > 0.5)
    highlights.push(
      `Task value scores improved by ${scoreDelta.toFixed(1)} points`,
    );

  const convDelta = current.conversationCount - previous.conversationCount;
  if (convDelta > 5)
    highlights.push(
      `Conversation activity up significantly (${formatDelta(convDelta)})`,
    );

  if (highlights.length === 0)
    highlights.push('Metrics stable — no notable changes this period');

  return highlights;
}

function generateRecommendations(
  current: DigestMetrics,
  previous: DigestMetrics | null,
): string[] {
  const recs: string[] = [];

  // Failure patterns increasing
  if (
    previous &&
    current.totalFailureOccurrences > previous.totalFailureOccurrences + 2
  ) {
    recs.push(
      'Error rate rising — review failure-patterns.md for recurring issues',
    );
  }

  // Many low-value tasks
  if (current.lowValueTasks >= 3) {
    recs.push(
      `${current.lowValueTasks} tasks have low value scores — consider reviewing or removing them`,
    );
  }

  // Skills underutilized
  if (
    current.skillsAvailable > 0 &&
    current.skillsUsed < current.skillsAvailable * 0.5
  ) {
    const unused = current.skillsAvailable - current.skillsUsed;
    recs.push(
      `${unused} skills available but unused — try expanding toolkit usage`,
    );
  }

  // Low success rate
  if (current.avgSkillSuccessRate > 0 && current.avgSkillSuccessRate < 70) {
    recs.push(
      `Average skill success rate is ${current.avgSkillSuccessRate}% — investigate failing skills`,
    );
  }

  // No lessons learned recently
  if (previous && current.lessonCount === previous.lessonCount) {
    recs.push(
      'No new lessons captured this period — consider reviewing recent interactions',
    );
  }

  if (recs.length === 0)
    recs.push('All metrics healthy — no immediate action needed');

  return recs;
}

/** Generate the learning metrics digest for a single group. */
export function generateDigest(groupFolder: string): void {
  const groupName = path.basename(groupFolder);
  const digestPath = path.join(groupFolder, 'learning-digest.md');

  // Collect current metrics
  const lessons = countLessons(groupFolder);
  const failures = countFailurePatterns(groupFolder);
  const tasks = countTaskMetrics(groupFolder);
  const skills = countSkillMetrics(groupFolder);
  const conversationCount = countConversations(groupFolder);

  const current: DigestMetrics = {
    timestamp: new Date().toISOString(),
    ...lessons,
    ...failures,
    ...tasks,
    ...skills,
    conversationCount,
  };

  // Load previous metrics
  const previous = loadPreviousMetrics(digestPath);

  // Calculate deltas
  const d = (key: keyof DigestMetrics): number => {
    if (!previous) return 0;
    const cur = current[key];
    const prev = previous[key];
    if (typeof cur === 'number' && typeof prev === 'number') return cur - prev;
    return 0;
  };

  const weekOf = new Date().toISOString().slice(0, 10);

  const highlights = generateHighlights(current, previous);
  const recommendations = generateRecommendations(current, previous);

  const digestJson = JSON.stringify(current);

  let content = `# Learning Metrics Digest
_Week of ${weekOf}. Auto-generated._

## Summary
| Metric | Current | Change | Trend |
|--------|---------|--------|-------|
| Lessons learned | ${current.lessonCount} | ${formatDelta(d('lessonCount'))} | ${trendArrow(d('lessonCount'), true)} |
| Failure patterns | ${current.failurePatternCount} (${current.totalFailureOccurrences} occurrences) | ${formatDelta(d('failurePatternCount'))} | ${trendArrow(d('failurePatternCount'), false)} |
| Active tasks | ${current.taskCount} (avg score: ${current.avgValueScore}) | ${formatDelta(d('taskCount'))} | ${trendArrow(d('avgValueScore'), true)} |
| Skills used/available | ${current.skillsUsed}/${current.skillsAvailable} | ${formatDelta(d('skillsUsed'))} | ${trendArrow(d('skillsUsed'), true)} |
| Conversations (7d) | ${current.conversationCount} | ${formatDelta(d('conversationCount'))} | ${trendArrow(d('conversationCount'), true)} |

## Highlights
${highlights.map((h) => `- ${h}`).join('\n')}

## Recommendations
${recommendations.map((r) => `- ${r}`).join('\n')}

<!-- digest-data
${digestJson}
-->
`;

  // Cap at 2KB
  if (Buffer.byteLength(content, 'utf-8') > 2048) {
    // Trim recommendations to fit
    while (
      Buffer.byteLength(content, 'utf-8') > 2048 &&
      recommendations.length > 1
    ) {
      recommendations.pop();
      content = content.replace(
        /## Recommendations\n[\s\S]*?\n\n/,
        `## Recommendations\n${recommendations.map((r) => `- ${r}`).join('\n')}\n\n`,
      );
    }
  }

  fs.writeFileSync(digestPath, content, 'utf-8');
  logger.info(
    { group: groupName, metrics: current },
    'Learning digest generated',
  );
}

// --- Startup and scheduling ---

let digestInterval: ReturnType<typeof setInterval> | null = null;

function runForAllGroups(): void {
  if (!fs.existsSync(GROUPS_DIR)) return;

  const groups = fs.readdirSync(GROUPS_DIR).filter((name) => {
    if (name === 'global') return false;
    const fullPath = path.join(GROUPS_DIR, name);
    return fs.statSync(fullPath).isDirectory();
  });

  for (const group of groups) {
    try {
      generateDigest(path.join(GROUPS_DIR, group));
    } catch (err) {
      logger.error({ err, group }, 'Failed to generate learning digest');
    }
  }
}

/** Start the weekly learning digest generator. */
export function startLearningDigest(): void {
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const TEN_MINUTES_MS = 10 * 60 * 1000;

  // First run after 10 minutes
  setTimeout(() => {
    runForAllGroups();

    // Then every 7 days
    digestInterval = setInterval(runForAllGroups, SEVEN_DAYS_MS);
  }, TEN_MINUTES_MS);

  logger.info(
    'Learning digest scheduled (first run in 10 minutes, then every 7 days)',
  );
}
