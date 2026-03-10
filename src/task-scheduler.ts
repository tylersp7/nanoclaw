import { ChildProcess } from 'child_process';
import { CronExpressionParser } from 'cron-parser';
import fs from 'fs';

import {
  ASSISTANT_NAME,
  CONTAINER_POOL_ENABLED,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  NOTHING_TO_REPORT_PATTERNS,
  NOTIFICATION_BATCH_MAX,
  NOTIFICATION_BATCH_WINDOW,
  QUIET_HOURS_END,
  QUIET_HOURS_START,
  SCHEDULER_POLL_INTERVAL,
  TIMEZONE,
} from './config.js';
import { getContainerPool } from './container-pool.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  getAllTasks,
  getDueTasks,
  getPendingFollowUps,
  getTaskById,
  isNotificationDuplicate,
  logNotification,
  logTaskRun,
  markFollowUpCompleted,
  markFollowUpError,
  markFollowUpProcessing,
  updateTask,
  updateTaskAfterRun,
} from './db.js';
import { detectAndQueueFollowUps } from './follow-up-detector.js';
import {
  isConfigured as isSheetsConfigured,
  logAlertToSheet,
  flushSheetLogs,
} from './sheets-logger.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { hooks } from './lifecycle-hooks.js';
import { logger } from './logger.js';
import { NotificationBatcher } from './notification-batcher.js';
import { runPipeline } from './pipeline-runner.js';
import { recordTaskSuppression, recordTaskFollowup } from './task-scorecard.js';
import { RegisteredGroup, ScheduledTask } from './types.js';

// --- Notification filtering helpers ---

/** Returns true if the message is a "nothing to report" result (short + matches patterns). */
function isNothingToReport(text: string): boolean {
  if (text.length > 500) return false; // longer messages likely contain real analysis
  return NOTHING_TO_REPORT_PATTERNS.some((p) => p.test(text));
}

/** Returns true if current time falls within the configured quiet hours window. */
function isQuietHours(): boolean {
  const now = new Date();
  const hour = parseInt(
    now.toLocaleString('en-US', {
      timeZone: TIMEZONE,
      hour: 'numeric',
      hour12: false,
    }),
    10,
  );
  if (QUIET_HOURS_START <= QUIET_HOURS_END) {
    // e.g. 8–14: quiet when hour >= 8 AND hour < 14
    return hour >= QUIET_HOURS_START && hour < QUIET_HOURS_END;
  }
  // Midnight wrap: e.g. 22–6: quiet when hour >= 22 OR hour < 6
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
}

/** Returns true if the message contains urgency signals that should bypass quiet hours. */
function isUrgentMessage(text: string): boolean {
  if (/\bURGENT\b/i.test(text)) return true;
  if (/\bCRITICAL\b/i.test(text)) return true;
  if (/\bESCALATE\b/i.test(text)) return true;
  if (/🔴/.test(text)) return true;
  if (
    /\bDOWN\b/i.test(text) &&
    /\b(SERVER|VPS|SERVICE|DATABASE|SITE)\b/i.test(text)
  )
    return true;
  return false;
}

// --- Quiet hours queue ---

interface QueuedNotification {
  jid: string;
  text: string;
  taskId: string;
}

const quietHoursQueue: QueuedNotification[] = [];
let quietHoursTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Compute the next run time for a recurring task, anchored to the
 * task's scheduled time rather than Date.now() to prevent cumulative
 * drift on interval-based tasks.
 *
 * Co-authored-by: @community-pr-601
 */
export function computeNextRun(task: ScheduledTask): string | null {
  if (task.schedule_type === 'once') return null;

  const now = Date.now();

  if (task.schedule_type === 'cron') {
    const interval = CronExpressionParser.parse(task.schedule_value, {
      tz: TIMEZONE,
    });
    return interval.next().toISOString();
  }

  if (task.schedule_type === 'interval') {
    const ms = parseInt(task.schedule_value, 10);
    if (!ms || ms <= 0) {
      // Guard against malformed interval that would cause an infinite loop
      logger.warn(
        { taskId: task.id, value: task.schedule_value },
        'Invalid interval value',
      );
      return new Date(now + 60_000).toISOString();
    }
    // Anchor to the scheduled time, not now, to prevent drift.
    // Skip past any missed intervals so we always land in the future.
    let next = new Date(task.next_run!).getTime() + ms;
    while (next <= now) {
      next += ms;
    }
    return new Date(next).toISOString();
  }

  return null;
}

export interface SchedulerDependencies {
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
  queue: GroupQueue;
  onProcess: (
    groupJid: string,
    proc: ChildProcess,
    containerName: string,
    groupFolder: string,
  ) => void;
  sendMessage: (jid: string, text: string) => Promise<void>;
}

async function runTask(
  task: ScheduledTask,
  deps: SchedulerDependencies,
): Promise<void> {
  // Pipeline tasks delegate to the pipeline runner
  if (task.pipeline_steps) {
    await runPipeline(task, deps);
    // Compute next_run after pipeline completes
    let nextRun: string | null = null;
    if (task.schedule_type === 'cron') {
      const interval = CronExpressionParser.parse(task.schedule_value, {
        tz: TIMEZONE,
      });
      nextRun = interval.next().toISOString();
    } else if (task.schedule_type === 'interval') {
      const ms = parseInt(task.schedule_value, 10);
      nextRun = new Date(Date.now() + ms).toISOString();
    }
    updateTaskAfterRun(task.id, nextRun, 'Pipeline completed');
    return;
  }

  const startTime = Date.now();
  try {
    hooks.emit('task:start', {
      taskId: task.id,
      groupFolder: task.group_folder,
      chatJid: task.chat_jid,
      prompt: task.prompt,
    });
  } catch (hookErr) {
    logger.warn({ err: hookErr }, 'task:start hook error');
  }

  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(task.group_folder);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // Stop retry churn for malformed legacy rows.
    updateTask(task.id, { status: 'paused' });
    logger.error(
      { taskId: task.id, groupFolder: task.group_folder, error },
      'Task has invalid group folder',
    );
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error,
    });
    return;
  }
  fs.mkdirSync(groupDir, { recursive: true });

  logger.info(
    { taskId: task.id, group: task.group_folder },
    'Running scheduled task',
  );

  const groups = deps.registeredGroups();
  const group = Object.values(groups).find(
    (g) => g.folder === task.group_folder,
  );

  if (!group) {
    logger.error(
      { taskId: task.id, groupFolder: task.group_folder },
      'Group not found for task',
    );
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error: `Group not found: ${task.group_folder}`,
    });
    return;
  }

  // Update tasks snapshot for container to read (filtered by group)
  const isMain = group.isMain === true;
  const tasks = getAllTasks();
  writeTasksSnapshot(
    task.group_folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  let result: string | null = null;
  let error: string | null = null;

  // For group context mode, use the group's current session
  const sessions = deps.getSessions();
  const sessionId =
    task.context_mode === 'group' ? sessions[task.group_folder] : undefined;

  // After the task produces a result, close the container promptly.
  // Tasks are single-turn — no need to wait IDLE_TIMEOUT (30 min) for the
  // query loop to time out. A short delay handles any final MCP calls.
  const TASK_CLOSE_DELAY_MS = 10000;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  // Scheduled tasks finish quickly (2-5 min) — use a shorter idle timeout
  // so containers don't sit idle for the full 30-min IDLE_TIMEOUT.
  const SCHEDULED_TASK_IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

  const queueKey = task.task_category
    ? `category:${task.task_category}`
    : task.chat_jid;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug(
        { taskId: task.id },
        'Scheduled task idle timeout, closing container stdin',
      );
      deps.queue.closeStdin(queueKey);
    }, SCHEDULED_TASK_IDLE_TIMEOUT);
  };

  const scheduleClose = () => {
    if (closeTimer) return; // already scheduled
    closeTimer = setTimeout(() => {
      logger.debug({ taskId: task.id }, 'Closing task container after result');
      deps.queue.closeStdin(queueKey);
    }, TASK_CLOSE_DELAY_MS);
  };

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt: task.prompt,
        sessionId,
        groupFolder: task.group_folder,
        chatJid: task.chat_jid,
        isMain,
        isScheduledTask: true,
        assistantName: ASSISTANT_NAME,
      },
      (proc, containerName) =>
        deps.onProcess(queueKey, proc, containerName, task.group_folder),
      async (streamedOutput: ContainerOutput) => {
        if (streamedOutput.result) {
          result = streamedOutput.result;
          // Forward result to user (strip <internal> tags, dedup)
          const text = streamedOutput.result
            .replace(/<internal>[\s\S]*?<\/internal>/g, '')
            .trim();
          if (text) {
            // 1. Suppress "nothing to report" messages
            if (isNothingToReport(text)) {
              logNotification(task.chat_jid, text, task.id, true);
              recordTaskSuppression(task.id);
              logger.info(
                { taskId: task.id },
                'Suppressed nothing-to-report notification',
              );
              // 2. Check for duplicate notifications (6h window)
            } else if (
              isNotificationDuplicate(task.chat_jid, text, 360, task.id)
            ) {
              logNotification(task.chat_jid, text, task.id, true);
              if (isSheetsConfigured()) {
                logAlertToSheet(
                  task.id,
                  task.prompt,
                  task.chat_jid,
                  text,
                  true,
                ).catch(() => {});
              }
              recordTaskSuppression(task.id);
              logger.info(
                { taskId: task.id },
                'Suppressed duplicate notification',
              );
              // 3. Queue non-urgent messages during quiet hours
            } else if (isQuietHours() && !isUrgentMessage(text)) {
              logNotification(task.chat_jid, text, task.id, true);
              quietHoursQueue.push({
                jid: task.chat_jid,
                text,
                taskId: task.id,
              });
              logger.info(
                { taskId: task.id },
                'Queued notification for after quiet hours',
              );
              // 4. Send normally
            } else {
              logNotification(task.chat_jid, text, task.id, false);
              if (isSheetsConfigured()) {
                logAlertToSheet(
                  task.id,
                  task.prompt,
                  task.chat_jid,
                  text,
                  false,
                ).catch(() => {});
              }
              await deps.sendMessage(task.chat_jid, text);
            }
          }
          // Scan for follow-up signals in output
          const followUps = detectAndQueueFollowUps(
            streamedOutput.result,
            task,
          );
          if (followUps > 0) recordTaskFollowup(task.id);
          // Only reset idle timer on actual results, not session-update markers
          resetIdleTimer();
          scheduleClose();
        }
        if (streamedOutput.status === 'success') {
          deps.queue.notifyIdle(task.chat_jid);
          scheduleClose(); // Close promptly even when result is null (e.g. IPC-only tasks)
        }
        if (streamedOutput.status === 'error') {
          error = streamedOutput.error || 'Unknown error';
        }
      },
    );

    if (closeTimer) clearTimeout(closeTimer);

    if (output.status === 'error') {
      error = output.error || 'Unknown error';
    } else if (output.result) {
      // Result was already forwarded to the user via the streaming callback above
      result = output.result;
    }

    logger.info(
      { taskId: task.id, durationMs: Date.now() - startTime },
      'Task completed',
    );
  } catch (err) {
    if (closeTimer) clearTimeout(closeTimer);
    error = err instanceof Error ? err.message : String(err);
    logger.error({ taskId: task.id, error }, 'Task failed');
  }

  const durationMs = Date.now() - startTime;

  // Only log to task_run_logs for real scheduled tasks (not follow-ups which
  // use synthetic IDs that don't exist in the scheduled_tasks table, causing
  // a FOREIGN KEY constraint failure).
  if (!task.id.startsWith('followup-')) {
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: durationMs,
      status: error ? 'error' : 'success',
      result,
      error,
    });
  }

  const nextRun = computeNextRun(task);
  const resultSummary = error
    ? `Error: ${error}`
    : result
      ? result.slice(0, 200)
      : 'Completed';
  updateTaskAfterRun(task.id, nextRun, resultSummary);

  try {
    hooks.emit('task:end', {
      taskId: task.id,
      groupFolder: task.group_folder,
      durationMs,
      success: !error,
      resultSummary,
    });
  } catch (hookErr) {
    logger.warn({ err: hookErr }, 'task:end hook error');
  }
}

let schedulerRunning = false;
let batcher: NotificationBatcher | null = null;

/** Flush all pending batched notifications (call on shutdown). */
export async function flushNotifications(): Promise<void> {
  // Drain quiet hours queue — on shutdown, send everything
  if (batcher && quietHoursQueue.length > 0) {
    logger.info(
      { count: quietHoursQueue.length },
      'Flushing quiet hours queue on shutdown',
    );
    while (quietHoursQueue.length > 0) {
      const item = quietHoursQueue.shift()!;
      batcher.send(item.jid, item.text);
    }
  }
  if (batcher) await batcher.flushAll();
  await flushSheetLogs();
}

export function startSchedulerLoop(deps: SchedulerDependencies): void {
  if (schedulerRunning) {
    logger.debug('Scheduler loop already running, skipping duplicate start');
    return;
  }
  schedulerRunning = true;

  // Wrap sendMessage with a batcher so scheduled-task notifications
  // arriving close together for the same chat are merged into one message.
  batcher = new NotificationBatcher(deps.sendMessage, {
    windowMs: NOTIFICATION_BATCH_WINDOW,
    maxMessages: NOTIFICATION_BATCH_MAX,
    separator: '\n\n---\n\n',
  });

  const batchedDeps: SchedulerDependencies = {
    ...deps,
    sendMessage: async (jid, text) => batcher!.send(jid, text),
  };

  logger.info('Scheduler loop started');

  // Quiet hours flush: check every 5 min if quiet hours ended, then drain queue
  quietHoursTimer = setInterval(
    () => {
      if (!isQuietHours() && quietHoursQueue.length > 0) {
        logger.info(
          { count: quietHoursQueue.length },
          'Quiet hours ended, flushing queued notifications',
        );
        while (quietHoursQueue.length > 0) {
          const item = quietHoursQueue.shift()!;
          batcher!.send(item.jid, item.text);
        }
      }
    },
    5 * 60 * 1000,
  );

  const loop = async () => {
    try {
      const dueTasks = getDueTasks();
      if (dueTasks.length > 0) {
        logger.info({ count: dueTasks.length }, 'Found due tasks');
      }

      for (const task of dueTasks) {
        // Re-check task status in case it was paused/cancelled
        const currentTask = getTaskById(task.id);
        if (!currentTask || currentTask.status !== 'active') {
          continue;
        }

        const taskQueueKey = currentTask.task_category
          ? `category:${currentTask.task_category}`
          : currentTask.chat_jid;
        batchedDeps.queue.enqueueTask(taskQueueKey, currentTask.id, () =>
          runTask(currentTask, batchedDeps),
        );
      }

      // Process pending follow-ups
      const followUps = getPendingFollowUps();
      for (const followUp of followUps) {
        markFollowUpProcessing(followUp.id!);
        const followUpId = `followup-${followUp.id}-${Date.now()}`;

        batchedDeps.queue.enqueueTask(
          followUp.chat_jid,
          followUpId,
          async () => {
            try {
              // Run follow-up as a one-off task
              await runTask(
                {
                  id: followUpId,
                  group_folder: followUp.group_folder,
                  chat_jid: followUp.chat_jid,
                  prompt: followUp.prompt,
                  schedule_type: 'once',
                  schedule_value: new Date().toISOString(),
                  context_mode: 'isolated',
                  next_run: null,
                  last_run: null,
                  last_result: null,
                  status: 'completed',
                  created_at: followUp.created_at,
                },
                batchedDeps,
              );
              markFollowUpCompleted(followUp.id!);
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err);
              markFollowUpError(followUp.id!, errorMsg);
              logger.error(
                { followUpId: followUp.id, err },
                'Follow-up failed',
              );
            }
          },
        );
      }
    } catch (err) {
      logger.error({ err }, 'Error in scheduler loop');
    }

    // Pre-warm container setup for known groups during idle periods
    if (CONTAINER_POOL_ENABLED) {
      try {
        const groups = deps.registeredGroups();
        const groupFolders = Object.values(groups).map((g) => g.folder);
        if (groupFolders.length > 0) {
          getContainerPool().warmup(groupFolders);
        }
      } catch (err) {
        logger.debug({ err }, 'Container pool warmup failed (non-critical)');
      }
    }

    setTimeout(loop, SCHEDULER_POLL_INTERVAL);
  };

  loop();
}

/** @internal - for tests only. */
export function _resetSchedulerLoopForTests(): void {
  schedulerRunning = false;
}
