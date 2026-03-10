/**
 * Adaptive Lessons
 * Extracts recurring patterns from conversation summaries and maintains
 * a per-group lessons.md file that agents can consult for guidance.
 *
 * Lessons capture three categories:
 *   - approach:   techniques that worked well
 *   - avoidance:  patterns that caused problems
 *   - preference: user style and workflow preferences
 *
 * Runs on the `learning:indexed` lifecycle hook — no separate timer needed.
 */
import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';
import { hooks } from './lifecycle-hooks.js';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export interface Lesson {
  date: string; // ISO date when first observed
  lastSeen: string; // ISO date when last reinforced
  category: 'approach' | 'avoidance' | 'preference';
  text: string; // The lesson (max 150 chars)
  reinforcements: number; // How many times this pattern was seen
}

// ---------------------------------------------------------------------------
// Pattern matching keywords per category
// ---------------------------------------------------------------------------

const APPROACH_KEYWORDS =
  /\b(worked|solved|fixed|successfully|effective approach)\b/i;
const AVOIDANCE_KEYWORDS =
  /\b(failed|error|avoid|don't|broke|caused issues)\b/i;
const PREFERENCE_KEYWORDS =
  /\b(prefers|always|never|likes|wants|style)\b/i;

const CATEGORY_PATTERNS: {
  category: Lesson['category'];
  pattern: RegExp;
}[] = [
  { category: 'approach', pattern: APPROACH_KEYWORDS },
  { category: 'avoidance', pattern: AVOIDANCE_KEYWORDS },
  { category: 'preference', pattern: PREFERENCE_KEYWORDS },
];

const MAX_TEXT_LENGTH = 150;
const MAX_LESSONS_PER_CATEGORY = 5;
const MAX_LESSONS_TOTAL = 15;
const MAX_HUMAN_READABLE_BYTES = 2048;
const DECAY_DAYS = 30;
const MIN_REINFORCEMENTS_TO_KEEP = 2;
const SIMILARITY_THRESHOLD = 0.6;
const MAX_SUMMARIES_TO_SCAN = 10;

// ---------------------------------------------------------------------------
// String similarity (shared-word ratio)
// ---------------------------------------------------------------------------

function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(Boolean),
  );
}

function wordSimilarity(a: string, b: string): number {
  const setA = wordSet(a);
  const setB = wordSet(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0;
  let shared = 0;
  for (const w of setA) {
    if (setB.has(w)) shared++;
  }
  return shared / union.size;
}

// ---------------------------------------------------------------------------
// Lesson extraction from summary content
// ---------------------------------------------------------------------------

export function extractLessons(
  summaryContent: string,
  existingLessons: Lesson[],
): Lesson[] {
  const now = new Date().toISOString().slice(0, 10);
  const updated = [...existingLessons];

  // Split into sentences (roughly)
  const sentences = summaryContent
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  for (const sentence of sentences) {
    for (const { category, pattern } of CATEGORY_PATTERNS) {
      if (!pattern.test(sentence)) continue;

      const text =
        sentence.length > MAX_TEXT_LENGTH
          ? sentence.slice(0, MAX_TEXT_LENGTH - 3) + '...'
          : sentence;

      // Check for duplicate against existing lessons
      const duplicate = updated.find(
        (l) =>
          l.category === category &&
          wordSimilarity(l.text, text) > SIMILARITY_THRESHOLD,
      );

      if (duplicate) {
        duplicate.reinforcements++;
        duplicate.lastSeen = now;
      } else {
        updated.push({
          date: now,
          lastSeen: now,
          category,
          text,
          reinforcements: 1,
        });
      }

      // Only match the first category per sentence
      break;
    }
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Lesson pruning / decay
// ---------------------------------------------------------------------------

export function pruneLessons(lessons: Lesson[]): Lesson[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DECAY_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // Remove stale low-reinforcement lessons
  const kept = lessons.filter((l) => {
    if (l.reinforcements >= MIN_REINFORCEMENTS_TO_KEEP) return true;
    return l.lastSeen >= cutoffStr;
  });

  // Sort within each category by reinforcements descending
  const byCategory: Record<Lesson['category'], Lesson[]> = {
    approach: [],
    avoidance: [],
    preference: [],
  };
  for (const l of kept) {
    byCategory[l.category].push(l);
  }
  for (const cat of Object.keys(byCategory) as Lesson['category'][]) {
    byCategory[cat].sort((a, b) => b.reinforcements - a.reinforcements);
    byCategory[cat] = byCategory[cat].slice(0, MAX_LESSONS_PER_CATEGORY);
  }

  const result = [
    ...byCategory.approach,
    ...byCategory.avoidance,
    ...byCategory.preference,
  ];
  return result.slice(0, MAX_LESSONS_TOTAL);
}

// ---------------------------------------------------------------------------
// File I/O — lessons.md with embedded JSON data block
// ---------------------------------------------------------------------------

const LESSONS_FILENAME = 'lessons.md';
const DATA_START = '<!-- lessons-data';
const DATA_END = '-->';

export function loadLessons(groupFolder: string): Lesson[] {
  const filePath = path.join(GROUPS_DIR, groupFolder, LESSONS_FILENAME);
  if (!fs.existsSync(filePath)) return [];

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const startIdx = content.indexOf(DATA_START);
    if (startIdx === -1) return [];

    const jsonStart = startIdx + DATA_START.length;
    const endIdx = content.indexOf(DATA_END, jsonStart);
    if (endIdx === -1) return [];

    const jsonStr = content.slice(jsonStart, endIdx).trim();
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    return parsed as Lesson[];
  } catch (err) {
    logger.warn({ err, groupFolder }, 'Failed to load lessons, starting fresh');
    return [];
  }
}

function formatLessonLine(l: Lesson): string {
  return `- ${l.text} _(seen ${l.reinforcements}x, last: ${l.lastSeen})_`;
}

export function saveLessons(groupFolder: string, lessons: Lesson[]): void {
  const groupDir = path.join(GROUPS_DIR, groupFolder);
  if (!fs.existsSync(groupDir)) {
    logger.warn({ groupFolder }, 'Group directory does not exist, skipping save');
    return;
  }

  const now = new Date().toISOString().slice(0, 10);

  const approaches = lessons.filter((l) => l.category === 'approach');
  const avoidances = lessons.filter((l) => l.category === 'avoidance');
  const preferences = lessons.filter((l) => l.category === 'preference');

  // Build human-readable portion
  let humanReadable = `# Learned Lessons\n_Auto-generated from conversation patterns. Last updated: ${now}_\n`;

  if (approaches.length > 0) {
    humanReadable += '\n## Effective Approaches\n';
    humanReadable += approaches.map(formatLessonLine).join('\n') + '\n';
  }

  if (avoidances.length > 0) {
    humanReadable += '\n## Things to Avoid\n';
    humanReadable += avoidances.map(formatLessonLine).join('\n') + '\n';
  }

  if (preferences.length > 0) {
    humanReadable += '\n## User Preferences\n';
    humanReadable += preferences.map(formatLessonLine).join('\n') + '\n';
  }

  // Enforce 2KB cap on human-readable portion
  if (Buffer.byteLength(humanReadable, 'utf-8') > MAX_HUMAN_READABLE_BYTES) {
    // Truncate by removing the last lesson lines until under limit
    const lines = humanReadable.split('\n');
    while (
      lines.length > 3 &&
      Buffer.byteLength(lines.join('\n'), 'utf-8') > MAX_HUMAN_READABLE_BYTES
    ) {
      // Remove the last lesson line (lines starting with "- ")
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].startsWith('- ')) {
          lines.splice(i, 1);
          break;
        }
      }
    }
    humanReadable = lines.join('\n') + '\n';
  }

  // Machine-readable JSON block
  const jsonBlock = `\n${DATA_START}\n${JSON.stringify(lessons)}\n${DATA_END}\n`;

  const filePath = path.join(groupDir, LESSONS_FILENAME);
  fs.writeFileSync(filePath, humanReadable + jsonBlock, 'utf-8');
  logger.info(
    { groupFolder, lessonCount: lessons.length },
    'Lessons saved',
  );
}

// ---------------------------------------------------------------------------
// Scan summaries and update lessons for a group
// ---------------------------------------------------------------------------

export function updateGroupLessons(groupFolder: string): void {
  const summariesDir = path.join(
    GROUPS_DIR,
    groupFolder,
    'conversations',
    'summaries',
  );

  if (!fs.existsSync(summariesDir)) {
    logger.debug({ groupFolder }, 'No summaries directory, skipping lessons update');
    return;
  }

  // Read the most recent summaries (sorted by filename descending = most recent first)
  let summaryFiles: string[];
  try {
    summaryFiles = fs
      .readdirSync(summariesDir)
      .filter((f) => f.endsWith('.md') || f.endsWith('.txt') || f.endsWith('.yaml'))
      .sort()
      .reverse()
      .slice(0, MAX_SUMMARIES_TO_SCAN);
  } catch (err) {
    logger.warn({ err, groupFolder }, 'Failed to read summaries directory');
    return;
  }

  if (summaryFiles.length === 0) {
    logger.debug({ groupFolder }, 'No summary files found');
    return;
  }

  let lessons = loadLessons(groupFolder);

  for (const file of summaryFiles) {
    try {
      const content = fs.readFileSync(path.join(summariesDir, file), 'utf-8');
      lessons = extractLessons(content, lessons);
    } catch (err) {
      logger.warn({ err, file }, 'Failed to read summary file');
    }
  }

  lessons = pruneLessons(lessons);
  saveLessons(groupFolder, lessons);
}

// ---------------------------------------------------------------------------
// Startup — register lifecycle hook
// ---------------------------------------------------------------------------

export function startAdaptiveLessons(): void {
  hooks.on('learning:indexed', (payload: { groupFolder: string }) => {
    try {
      updateGroupLessons(payload.groupFolder);
    } catch (err) {
      logger.error(
        { err, groupFolder: payload.groupFolder },
        'Adaptive lessons update failed',
      );
    }
  });

  logger.info('Adaptive lessons registered on learning:indexed hook');
}
