/**
 * Task Performance Scorecard
 * Tracks per-task metrics (runs, successes, suppressions, follow-ups)
 * and periodically generates a markdown scorecard per group.
 */
import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';
import { getDb } from './db.js';
import { hooks } from './lifecycle-hooks.js';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export function initTaskMetrics(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_metrics (
      task_id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      run_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      suppressed_count INTEGER DEFAULT 0,
      total_duration_ms INTEGER DEFAULT 0,
      followup_count INTEGER DEFAULT 0,
      last_run TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

// ---------------------------------------------------------------------------
// Recording helpers
// ---------------------------------------------------------------------------

export function recordTaskRun(
  taskId: string,
  groupFolder: string,
  success: boolean,
  durationMs: number,
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO task_metrics (task_id, group_folder, run_count, success_count, error_count, total_duration_ms, last_run)
    VALUES (?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET
      run_count = run_count + 1,
      success_count = success_count + ?,
      error_count = error_count + ?,
      total_duration_ms = total_duration_ms + ?,
      last_run = ?
  `).run(
    taskId,
    groupFolder,
    success ? 1 : 0,
    success ? 0 : 1,
    durationMs,
    now,
    // ON CONFLICT bind values
    success ? 1 : 0,
    success ? 0 : 1,
    durationMs,
    now,
  );
}

export function recordTaskSuppression(taskId: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE task_metrics SET suppressed_count = suppressed_count + 1
    WHERE task_id = ?
  `).run(taskId);
}

export function recordTaskFollowup(taskId: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE task_metrics SET followup_count = followup_count + 1
    WHERE task_id = ?
  `).run(taskId);
}

// ---------------------------------------------------------------------------
// Scorecard generation
// ---------------------------------------------------------------------------

interface MetricRow {
  task_id: string;
  group_folder: string;
  run_count: number;
  success_count: number;
  error_count: number;
  suppressed_count: number;
  total_duration_ms: number;
  followup_count: number;
  last_run: string | null;
  prompt: string | null;
  schedule_value: string | null;
}

const MAX_SCORECARD_BYTES = 3072; // 3 KB cap

export function generateScorecard(groupFolder: string): void {
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      m.task_id,
      m.group_folder,
      m.run_count,
      m.success_count,
      m.error_count,
      m.suppressed_count,
      m.total_duration_ms,
      m.followup_count,
      m.last_run,
      t.prompt,
      t.schedule_value
    FROM task_metrics m
    LEFT JOIN scheduled_tasks t ON m.task_id = t.id
    WHERE m.group_folder = ? AND m.run_count >= 3
    ORDER BY m.run_count DESC
  `).all(groupFolder) as MetricRow[];

  if (rows.length === 0) return;

  // Compute value scores
  const scored = rows.map((r) => {
    const valueScore =
      (r.success_count - r.suppressed_count) / Math.max(r.run_count, 1);
    const successPct = Math.round((r.success_count / Math.max(r.run_count, 1)) * 100);
    const suppressedPct = Math.round(
      (r.suppressed_count / Math.max(r.run_count, 1)) * 100,
    );
    const avgDurationSec = +(
      r.total_duration_ms /
      Math.max(r.run_count, 1) /
      1000
    ).toFixed(1);
    return { ...r, valueScore, successPct, suppressedPct, avgDurationSec };
  });

  scored.sort((a, b) => b.valueScore - a.valueScore);

  const highValue = scored.filter((r) => r.suppressedPct <= 80);
  const lowValue = scored.filter((r) => r.suppressedPct > 80);

  const now = new Date().toISOString();
  const lines: string[] = [
    '# Task Performance Scorecard',
    `_Auto-generated. Last updated: ${now}_`,
    '',
  ];

  // High value table
  if (highValue.length > 0) {
    lines.push('## High Value Tasks');
    lines.push('| Task | Runs | Success% | Suppressed% | Avg Duration | Score |');
    lines.push('|------|------|----------|-------------|--------------|-------|');
    for (const r of highValue) {
      const label = truncateId(r.task_id);
      lines.push(
        `| ${label} | ${r.run_count} | ${r.successPct}% | ${r.suppressedPct}% | ${r.avgDurationSec}s | ${r.valueScore.toFixed(2)} |`,
      );
    }
    lines.push('');
  }

  // Low value table
  if (lowValue.length > 0) {
    lines.push('## Low Value Tasks (consider pausing)');
    lines.push('| Task | Runs | Suppressed% | Last Run | Recommendation |');
    lines.push('|------|------|-------------|----------|----------------|');
    for (const r of lowValue) {
      const label = truncateId(r.task_id);
      const lastRun = r.last_run ? r.last_run.split('T')[0] : 'n/a';
      const rec = `Pause: ${r.suppressedPct}% suppressed`;
      lines.push(`| ${label} | ${r.run_count} | ${r.suppressedPct}% | ${lastRun} | ${rec} |`);
    }
    lines.push('');
  }

  let content = lines.join('\n');

  // Enforce 3 KB cap — trim trailing rows if needed
  if (Buffer.byteLength(content, 'utf-8') > MAX_SCORECARD_BYTES) {
    while (
      Buffer.byteLength(content, 'utf-8') > MAX_SCORECARD_BYTES &&
      content.includes('\n')
    ) {
      // Remove last non-empty line
      const idx = content.lastIndexOf('\n', content.length - 2);
      if (idx <= 0) break;
      content = content.slice(0, idx) + '\n';
    }
  }

  const groupDir = path.join(GROUPS_DIR, groupFolder);
  fs.mkdirSync(groupDir, { recursive: true });
  fs.writeFileSync(path.join(groupDir, 'task-scorecard.md'), content, 'utf-8');

  logger.debug(
    { groupFolder, tasks: rows.length },
    'Generated task scorecard',
  );
}

function truncateId(id: string): string {
  return id.length > 20 ? id.slice(0, 18) + '..' : id;
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

let scorecardInterval: ReturnType<typeof setInterval> | null = null;

export function startTaskScorecard(): void {
  initTaskMetrics();

  // Listen for task completions
  hooks.on('task:end', (payload) => {
    try {
      recordTaskRun(
        payload.taskId,
        payload.groupFolder,
        payload.success,
        payload.durationMs,
      );
    } catch (err) {
      logger.error({ err, taskId: payload.taskId }, 'Failed to record task metric');
    }
  });

  // Generate scorecards for all groups that have metrics
  const generateAll = () => {
    try {
      const db = getDb();
      const folders = db
        .prepare(
          `SELECT DISTINCT group_folder FROM task_metrics WHERE run_count >= 3`,
        )
        .all() as Array<{ group_folder: string }>;

      for (const { group_folder } of folders) {
        try {
          generateScorecard(group_folder);
        } catch (err) {
          logger.error(
            { err, groupFolder: group_folder },
            'Failed to generate scorecard',
          );
        }
      }
    } catch (err) {
      logger.error({ err }, 'Failed to enumerate groups for scorecards');
    }
  };

  // First run after 5-minute warm-up
  setTimeout(generateAll, 5 * 60 * 1000);

  // Then every 24 hours
  scorecardInterval = setInterval(generateAll, 24 * 60 * 60 * 1000);
}
