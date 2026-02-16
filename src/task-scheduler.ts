import { ChildProcess } from 'child_process';
import { CronExpressionParser } from 'cron-parser';
import fs from 'fs';
import path from 'path';

import {
  CONTAINER_POOL_ENABLED,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
  NOTIFICATION_BATCH_MAX,
  NOTIFICATION_BATCH_WINDOW,
  SCHEDULER_POLL_INTERVAL,
  TIMEZONE,
} from './config.js';
import { getContainerPool } from './container-pool.js';
import { ContainerOutput, runContainerAgent, writeTasksSnapshot } from './container-runner.js';
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
  updateTaskAfterRun,
} from './db.js';
import { detectAndQueueFollowUps } from './follow-up-detector.js';
import { GroupQueue } from './group-queue.js';
import { logger } from './logger.js';
import { NotificationBatcher } from './notification-batcher.js';
import { runPipeline } from './pipeline-runner.js';
import { RegisteredGroup, ScheduledTask } from './types.js';

export interface SchedulerDependencies {
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
  queue: GroupQueue;
  onProcess: (groupJid: string, proc: ChildProcess, containerName: string, groupFolder: string) => void;
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
      const interval = CronExpressionParser.parse(task.schedule_value, { tz: TIMEZONE });
      nextRun = interval.next().toISOString();
    } else if (task.schedule_type === 'interval') {
      const ms = parseInt(task.schedule_value, 10);
      nextRun = new Date(Date.now() + ms).toISOString();
    }
    updateTaskAfterRun(task.id, nextRun, 'Pipeline completed');
    return;
  }

  const startTime = Date.now();
  const groupDir = path.join(GROUPS_DIR, task.group_folder);
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
  const isMain = task.group_folder === MAIN_GROUP_FOLDER;
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

  // Idle timer: writes _close sentinel after IDLE_TIMEOUT of no output,
  // so the container exits instead of hanging at waitForIpcMessage forever.
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug({ taskId: task.id }, 'Scheduled task idle timeout, closing container stdin');
      deps.queue.closeStdin(task.chat_jid);
    }, IDLE_TIMEOUT);
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
      },
      (proc, containerName) => deps.onProcess(task.chat_jid, proc, containerName, task.group_folder),
      async (streamedOutput: ContainerOutput) => {
        if (streamedOutput.result) {
          result = streamedOutput.result;
          // Forward result to user (strip <internal> tags, dedup)
          const text = streamedOutput.result.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
          if (text) {
            // Check for duplicate notifications (6h window)
            if (isNotificationDuplicate(task.chat_jid, text)) {
              logNotification(task.chat_jid, text, task.id, true);
              logger.info({ taskId: task.id }, 'Suppressed duplicate notification');
            } else {
              logNotification(task.chat_jid, text, task.id, false);
              // sendMessage handles formatting (prefix, etc.)
              await deps.sendMessage(task.chat_jid, text);
            }
          }
          // Scan for follow-up signals in output
          detectAndQueueFollowUps(streamedOutput.result, task);
          // Only reset idle timer on actual results, not session-update markers
          resetIdleTimer();
        }
        if (streamedOutput.status === 'error') {
          error = streamedOutput.error || 'Unknown error';
        }
      },
    );

    if (idleTimer) clearTimeout(idleTimer);

    if (output.status === 'error') {
      error = output.error || 'Unknown error';
    } else if (output.result) {
      // Messages are sent via MCP tool (IPC), result text is just logged
      result = output.result;
    }

    logger.info(
      { taskId: task.id, durationMs: Date.now() - startTime },
      'Task completed',
    );
  } catch (err) {
    if (idleTimer) clearTimeout(idleTimer);
    error = err instanceof Error ? err.message : String(err);
    logger.error({ taskId: task.id, error }, 'Task failed');
  }

  const durationMs = Date.now() - startTime;

  logTaskRun({
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: durationMs,
    status: error ? 'error' : 'success',
    result,
    error,
  });

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
  // 'once' tasks have no next run

  const resultSummary = error
    ? `Error: ${error}`
    : result
      ? result.slice(0, 200)
      : 'Completed';
  updateTaskAfterRun(task.id, nextRun, resultSummary);
}

let schedulerRunning = false;
let batcher: NotificationBatcher | null = null;

/** Flush all pending batched notifications (call on shutdown). */
export async function flushNotifications(): Promise<void> {
  if (batcher) await batcher.flushAll();
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

        batchedDeps.queue.enqueueTask(
          currentTask.chat_jid,
          currentTask.id,
          () => runTask(currentTask, batchedDeps),
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
              logger.error({ followUpId: followUp.id, err }, 'Follow-up failed');
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
