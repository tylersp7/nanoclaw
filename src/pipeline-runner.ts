/**
 * Pipeline Runner
 * Executes multi-step pipeline tasks where each step runs as a separate
 * container, with prior step outputs injected into subsequent prompts.
 *
 * Orchestration happens at the host level — containers already have all
 * the tools, the host just decides what prompts to send and in what order.
 */
import crypto from 'crypto';
import { ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  CONTAINER_TIMEOUT,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
} from './config.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  getAllTasks,
  getPipelineState,
  logPipelineStep,
  logTaskRun,
  updatePipelineState,
  updateTaskAfterRun,
} from './db.js';
import { detectAndQueueFollowUps } from './follow-up-detector.js';
import { GroupQueue } from './group-queue.js';
import { logger } from './logger.js';
import {
  PipelineState,
  PipelineStep,
  RegisteredGroup,
  ScheduledTask,
} from './types.js';

export interface PipelineDeps {
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

/**
 * Build the prompt for a pipeline step, interpolating template variables.
 * Supported variables:
 *   {prev_results} — all prior step outputs concatenated
 *   {step_N_output} — output of step N (0-indexed)
 */
function buildStepPrompt(step: PipelineStep, state: PipelineState): string {
  let prompt = step.prompt;

  // Build prev_results: all completed step outputs concatenated
  const prevResults = state.completed_steps
    .sort((a, b) => a - b)
    .map((i) => state.step_outputs[i] || '')
    .filter(Boolean)
    .join('\n\n---\n\n');

  prompt = prompt.replace(/\{prev_results\}/g, prevResults);

  // Replace individual step output references
  prompt = prompt.replace(/\{step_(\d+)_output\}/g, (_match, idx) => {
    return state.step_outputs[parseInt(idx, 10)] || '';
  });

  return prompt;
}

/**
 * Evaluate a skipIf condition against prior step outputs.
 * The expression has access to `results` (the prev_results string).
 * Returns true if the step should be SKIPPED.
 */
function shouldSkipStep(step: PipelineStep, state: PipelineState): boolean {
  if (!step.skipIf) return false;

  const results = state.completed_steps
    .sort((a, b) => a - b)
    .map((i) => state.step_outputs[i] || '')
    .filter(Boolean)
    .join('\n\n');

  try {
    // Safe-ish evaluation: only string operations on `results`
    const fn = new Function('results', `return (${step.skipIf});`);
    return !!fn(results);
  } catch (err) {
    logger.warn(
      { skipIf: step.skipIf, error: err },
      'Failed to evaluate skipIf, running step anyway',
    );
    return false;
  }
}

/**
 * Resume existing pipeline state or create a fresh one.
 * Handles stale run detection (stuck pipelines from crashes).
 */
function resumeOrCreateState(task: ScheduledTask): PipelineState {
  const existing = getPipelineState(task.id);

  if (existing && existing.status === 'running') {
    const startedAt = new Date(existing.started_at).getTime();
    const staleThreshold = 2 * CONTAINER_TIMEOUT;

    if (Date.now() - startedAt > staleThreshold) {
      logger.warn(
        {
          taskId: task.id,
          runId: existing.run_id,
          startedAt: existing.started_at,
        },
        'Stale pipeline run detected, resuming from last completed step',
      );
      // Reset status so we can resume
      existing.status = 'running';
      existing.started_at = new Date().toISOString();
      return existing;
    }

    // Still running (another process?), don't interfere
    logger.info(
      { taskId: task.id, runId: existing.run_id },
      'Pipeline already running, skipping',
    );
    return existing;
  }

  // Fresh run
  return {
    run_id: crypto.randomUUID(),
    current_step: 0,
    completed_steps: [],
    step_outputs: {},
    started_at: new Date().toISOString(),
    status: 'running',
  };
}

/**
 * Run a single pipeline step as a container agent.
 * Returns the output text or throws on error.
 */
async function runStep(
  step: PipelineStep,
  stepIndex: number,
  prompt: string,
  task: ScheduledTask,
  deps: PipelineDeps,
): Promise<string> {
  const groups = deps.registeredGroups();
  const group = Object.values(groups).find(
    (g) => g.folder === task.group_folder,
  );
  if (!group) {
    throw new Error(`Group not found: ${task.group_folder}`);
  }

  const groupDir = path.join(GROUPS_DIR, task.group_folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const isMain = task.group_folder === MAIN_GROUP_FOLDER;
  const sessions = deps.getSessions();
  const contextMode = step.context_mode || task.context_mode;
  const sessionId =
    contextMode === 'group' ? sessions[task.group_folder] : undefined;

  // Update tasks snapshot for container
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
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug(
        { taskId: task.id, step: step.name },
        'Pipeline step idle timeout',
      );
      deps.queue.closeStdin(task.chat_jid);
    }, IDLE_TIMEOUT);
  };

  const output = await runContainerAgent(
    group,
    {
      prompt,
      sessionId,
      groupFolder: task.group_folder,
      chatJid: task.chat_jid,
      isMain,
      isScheduledTask: true,
    },
    (proc, containerName) =>
      deps.onProcess(task.chat_jid, proc, containerName, task.group_folder),
    async (streamedOutput: ContainerOutput) => {
      if (streamedOutput.result) {
        result = streamedOutput.result;
        resetIdleTimer();
      }
    },
  );

  if (idleTimer) clearTimeout(idleTimer);

  if (output.status === 'error') {
    throw new Error(output.error || 'Container error');
  }

  return result || output.result || '';
}

/**
 * A batch of pipeline step indices that should be executed together.
 * If `parallel` is true, all steps in `indices` run concurrently.
 */
type StepBatch = { indices: number[]; parallel: boolean };

/**
 * Group consecutive pipeline steps into batches for execution.
 * Consecutive steps sharing the same non-null `parallel_group` form a
 * parallel batch. Everything else becomes a sequential batch of one.
 */
export function groupStepsIntoBatches(steps: PipelineStep[]): StepBatch[] {
  const batches: StepBatch[] = [];

  let i = 0;
  while (i < steps.length) {
    const group = steps[i].parallel_group;

    if (group) {
      // Collect consecutive steps with the same parallel_group
      const indices: number[] = [i];
      let j = i + 1;
      while (j < steps.length && steps[j].parallel_group === group) {
        indices.push(j);
        j++;
      }
      batches.push({ indices, parallel: indices.length > 1 });
      i = j;
    } else {
      // Sequential step (no parallel_group)
      batches.push({ indices: [i], parallel: false });
      i++;
    }
  }

  return batches;
}

/**
 * Execute a single step within the pipeline, handling skipIf, logging, state
 * persistence, and follow-up detection.  Returns { success, error? }.
 */
async function executeStep(
  stepIndex: number,
  steps: PipelineStep[],
  state: PipelineState,
  task: ScheduledTask,
  deps: PipelineDeps,
): Promise<{ success: boolean; error?: string }> {
  const step = steps[stepIndex];

  // Check skipIf condition
  if (shouldSkipStep(step, state)) {
    logger.info(
      { taskId: task.id, step: step.name, stepIndex },
      'Skipping step (skipIf matched)',
    );

    logPipelineStep({
      task_id: task.id,
      run_id: state.run_id,
      step_index: stepIndex,
      step_name: step.name,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: 0,
      status: 'skipped',
    });

    state.completed_steps.push(stepIndex);
    state.step_outputs[stepIndex] = '';
    updatePipelineState(task.id, state);
    return { success: true };
  }

  const stepStart = Date.now();
  const prompt = buildStepPrompt(step, state);

  logPipelineStep({
    task_id: task.id,
    run_id: state.run_id,
    step_index: stepIndex,
    step_name: step.name,
    started_at: new Date().toISOString(),
    status: 'running',
    input_summary: prompt.slice(0, 200),
  });

  logger.info(
    { taskId: task.id, step: step.name, stepIndex },
    'Running pipeline step',
  );

  try {
    let output = await runStep(step, stepIndex, prompt, task, deps);

    // QA Gate: validate output if enabled
    if (step.qaGate?.enabled) {
      const maxRetries = step.qaGate.maxRetries ?? 3;
      const qaPrompt =
        step.qaGate.qaPrompt ||
        'Validate the following output for correctness, completeness, and actionability. ' +
          'If it passes all checks, respond with exactly "QA: PASS" on the first line followed by a brief summary. ' +
          'If it fails, respond with exactly "QA: FAIL" on the first line followed by specific issues and actionable fixes.';

      let qaAttempt = 0;
      let passed = false;

      while (qaAttempt < maxRetries && !passed) {
        qaAttempt++;
        logger.info(
          {
            taskId: task.id,
            step: step.name,
            qaAttempt,
            maxRetries,
          },
          'Running QA gate',
        );

        const qaFullPrompt = `${qaPrompt}\n\n--- Output to validate ---\n${output}`;

        // QA runs in isolated mode — no session persistence
        const qaStep: PipelineStep = {
          name: `${step.name} (QA)`,
          prompt: qaFullPrompt,
          context_mode: 'isolated',
        };

        try {
          const qaOutput = await runStep(
            qaStep,
            stepIndex,
            qaFullPrompt,
            task,
            deps,
          );
          const firstLine = qaOutput.trim().split('\n')[0].toUpperCase();

          if (firstLine.includes('QA: PASS') || firstLine.includes('PASS')) {
            passed = true;
            logger.info(
              { taskId: task.id, step: step.name, qaAttempt },
              'QA gate passed',
            );
          } else {
            logger.warn(
              {
                taskId: task.id,
                step: step.name,
                qaAttempt,
                qaOutput: qaOutput.slice(0, 300),
              },
              'QA gate failed, retrying step',
            );

            if (qaAttempt < maxRetries) {
              // Re-run original step with QA feedback appended
              const retryPrompt = `${prompt}\n\n--- QA Feedback (attempt ${qaAttempt}) ---\n${qaOutput}\n\nPlease address the QA feedback above and produce an improved output.`;
              output = await runStep(step, stepIndex, retryPrompt, task, deps);
            }
          }
        } catch (qaErr) {
          logger.error(
            { taskId: task.id, step: step.name, qaAttempt, error: qaErr },
            'QA gate container error, treating as pass',
          );
          passed = true; // Don't block pipeline on QA infrastructure failure
        }
      }

      if (!passed) {
        logger.warn(
          { taskId: task.id, step: step.name, maxRetries },
          'QA gate: max retries exceeded, continuing with best attempt',
        );
        output = `[QA ESCALATION: Step "${step.name}" failed QA after ${maxRetries} attempts. Output may need human review.]\n\n${output}`;
      }
    }

    const stepDuration = Date.now() - stepStart;
    state.completed_steps.push(stepIndex);
    state.step_outputs[stepIndex] = output;
    updatePipelineState(task.id, state);

    logPipelineStep({
      task_id: task.id,
      run_id: state.run_id,
      step_index: stepIndex,
      step_name: step.name,
      started_at: new Date(stepStart).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: stepDuration,
      status: 'success',
      output_summary: output.slice(0, 500),
    });

    // Scan step output for follow-up signals
    detectAndQueueFollowUps(output, task);

    logger.info(
      { taskId: task.id, step: step.name, durationMs: stepDuration },
      'Pipeline step completed',
    );

    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    logPipelineStep({
      task_id: task.id,
      run_id: state.run_id,
      step_index: stepIndex,
      step_name: step.name,
      started_at: new Date(stepStart).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - stepStart,
      status: 'error',
      error: errorMsg,
    });

    logger.error(
      { taskId: task.id, step: step.name, error: errorMsg },
      'Pipeline step failed',
    );

    return { success: false, error: errorMsg };
  }
}

/**
 * Main pipeline execution entry point.
 * Called from task-scheduler when a task has pipeline_steps.
 */
export async function runPipeline(
  task: ScheduledTask,
  deps: PipelineDeps,
): Promise<void> {
  const startTime = Date.now();

  if (!task.pipeline_steps) {
    logger.error(
      { taskId: task.id },
      'runPipeline called but no pipeline_steps',
    );
    return;
  }

  let steps: PipelineStep[];
  try {
    steps = JSON.parse(task.pipeline_steps);
  } catch (err) {
    logger.error({ taskId: task.id, err }, 'Failed to parse pipeline_steps');
    return;
  }

  if (steps.length === 0) {
    logger.warn({ taskId: task.id }, 'Pipeline has no steps');
    return;
  }

  const state = resumeOrCreateState(task);

  // If state came back as already running (non-stale), skip
  if (
    state.status === 'running' &&
    getPipelineState(task.id)?.run_id === state.run_id &&
    state.completed_steps.length > 0
  ) {
    // This is a stale-resume — proceed
  } else if (state.status !== 'running') {
    // Completed/error/paused from a previous run — start fresh
    state.run_id = crypto.randomUUID();
    state.current_step = 0;
    state.completed_steps = [];
    state.step_outputs = {};
    state.started_at = new Date().toISOString();
    state.status = 'running';
    state.error = undefined;
  }

  // Persist initial state
  updatePipelineState(task.id, state);

  // Group steps into sequential/parallel batches
  const batches = groupStepsIntoBatches(steps);

  logger.info(
    {
      taskId: task.id,
      runId: state.run_id,
      totalSteps: steps.length,
      totalBatches: batches.length,
      parallelBatches: batches.filter((b) => b.parallel).length,
      resumeFrom: state.current_step,
    },
    'Pipeline starting',
  );

  let lastError: string | null = null;
  let aborted = false;

  for (const batch of batches) {
    if (aborted) break;

    // Skip batches whose steps have all been completed already (crash recovery)
    const pendingIndices = batch.indices.filter(
      (i) => !state.completed_steps.includes(i),
    );
    if (pendingIndices.length === 0) continue;

    // Skip batches that are entirely before our resume point
    const maxIndexInBatch = Math.max(...batch.indices);
    if (maxIndexInBatch < state.current_step) continue;

    if (batch.parallel && pendingIndices.length > 1) {
      // --- Parallel batch execution ---
      const stepNames = pendingIndices.map((i) => steps[i].name);
      logger.info(
        {
          taskId: task.id,
          parallelGroup: steps[pendingIndices[0]].parallel_group,
          steps: stepNames,
        },
        'Running parallel batch',
      );

      state.current_step = Math.min(...pendingIndices);
      updatePipelineState(task.id, state);

      const results = await Promise.all(
        pendingIndices.map((i) => executeStep(i, steps, state, task, deps)),
      );

      const failures = results.filter((r) => !r.success);
      const successes = results.filter((r) => r.success);

      if (failures.length > 0) {
        const errorMsgs = failures.map((f) => f.error).join('; ');
        lastError = errorMsgs;

        if (successes.length === 0) {
          // ALL steps in the batch failed — mark pipeline as error and abort
          state.status = 'error';
          state.error = `Parallel batch fully failed: ${errorMsgs}`;
          updatePipelineState(task.id, state);
          logger.error(
            {
              taskId: task.id,
              parallelGroup: steps[pendingIndices[0]].parallel_group,
            },
            'All steps in parallel batch failed, aborting pipeline',
          );
          aborted = true;
        } else {
          // Some steps failed but others succeeded — continue pipeline
          logger.warn(
            {
              taskId: task.id,
              parallelGroup: steps[pendingIndices[0]].parallel_group,
              failed: failures.length,
              succeeded: successes.length,
            },
            'Some steps in parallel batch failed, continuing pipeline',
          );
        }
      }

      // Advance current_step past the batch
      state.current_step = maxIndexInBatch + 1;
      updatePipelineState(task.id, state);
    } else {
      // --- Sequential execution (single step) ---
      const i = pendingIndices[0];
      if (i < state.current_step) continue;

      state.current_step = i;
      updatePipelineState(task.id, state);

      const result = await executeStep(i, steps, state, task, deps);

      if (!result.success) {
        lastError = result.error || 'Unknown error';
        state.status = 'error';
        state.error = `Step ${i} (${steps[i].name}): ${lastError}`;
        updatePipelineState(task.id, state);
        aborted = true;
      }
    }
  }

  // Mark pipeline complete if no error
  if (state.status === 'running') {
    state.status = 'completed';
    updatePipelineState(task.id, state);
  }

  const totalDuration = Date.now() - startTime;

  logTaskRun({
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: totalDuration,
    status: lastError ? 'error' : 'success',
    result:
      state.status === 'completed'
        ? `Pipeline completed: ${state.completed_steps.length}/${steps.length} steps`
        : null,
    error: lastError,
  });

  logger.info(
    {
      taskId: task.id,
      runId: state.run_id,
      totalDuration,
      status: state.status,
    },
    'Pipeline finished',
  );
}
