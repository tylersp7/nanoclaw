import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';
import { hooks, LifecycleEventMap } from './lifecycle-hooks.js';
import { logger } from './logger.js';

interface HookConfig {
  name: string;
  event: keyof LifecycleEventMap;
  enabled: boolean;
  action: HookAction;
}

type HookAction =
  | { type: 'log'; message: string }
  | { type: 'write_file'; path: string; template: string }
  | { type: 'append_file'; path: string; template: string }
  | { type: 'ipc_task'; task: Record<string, unknown> };

const VALID_EVENTS = new Set<keyof LifecycleEventMap>([
  'session:start',
  'session:end',
  'session:output',
  'task:start',
  'task:end',
  'compaction:complete',
  'learning:indexed',
]);

/**
 * Interpolate template variables in a string.
 * Unknown variables are left as-is to avoid data loss.
 */
function interpolate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    return key in vars ? vars[key] : match;
  });
}

/**
 * Build a template variables map from an event data object.
 * Always includes {timestamp} and {date}.
 */
function buildVars(
  groupFolder: string,
  data: Record<string, unknown>,
): Record<string, string> {
  const now = new Date();
  const vars: Record<string, string> = {
    groupFolder,
    timestamp: now.toISOString(),
    date: now.toISOString().slice(0, 10),
  };

  // Pull known fields from event data
  for (const key of [
    'chatJid',
    'taskId',
    'success',
    'durationMs',
    'sessionId',
    'text',
    'prompt',
    'filename',
    'messageCount',
    'contentLength',
  ]) {
    if (key in data && data[key] !== undefined) {
      vars[key] = String(data[key]);
    }
  }

  return vars;
}

/**
 * Execute a hook action safely. All errors are caught and logged
 * to prevent hook failures from breaking the main system.
 */
function executeAction(
  groupFolder: string,
  action: HookAction,
  vars: Record<string, string>,
): void {
  const groupDir = path.join(GROUPS_DIR, groupFolder);

  switch (action.type) {
    case 'log': {
      const message = interpolate(action.message, vars);
      logger.info({ hook: true, groupFolder }, message);
      break;
    }

    case 'write_file': {
      const filePath = path.resolve(groupDir, action.path);
      // Guard: only allow writes within the group directory
      if (!filePath.startsWith(groupDir + path.sep) && filePath !== groupDir) {
        logger.warn(
          { filePath, groupFolder },
          'Hook write_file path escapes group directory, skipping',
        );
        return;
      }
      const content = interpolate(action.template, vars);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      break;
    }

    case 'append_file': {
      const filePath = path.resolve(groupDir, action.path);
      if (!filePath.startsWith(groupDir + path.sep) && filePath !== groupDir) {
        logger.warn(
          { filePath, groupFolder },
          'Hook append_file path escapes group directory, skipping',
        );
        return;
      }
      const content = interpolate(action.template, vars);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.appendFileSync(filePath, content, 'utf-8');
      break;
    }

    case 'ipc_task': {
      const ipcTasksDir = path.join(groupDir, 'ipc', 'tasks');
      fs.mkdirSync(ipcTasksDir, { recursive: true });
      const taskData = JSON.parse(
        interpolate(JSON.stringify(action.task), vars),
      );
      const taskFile = path.join(
        ipcTasksDir,
        `hook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
      );
      fs.writeFileSync(taskFile, JSON.stringify(taskData, null, 2), 'utf-8');
      break;
    }

    default:
      logger.warn(
        { actionType: (action as { type: string }).type, groupFolder },
        'Unknown hook action type',
      );
  }
}

/**
 * Register a single hook for a group.
 */
export function registerHook(
  groupFolder: string,
  config: HookConfig,
): void {
  if (!config.enabled) return;

  if (!VALID_EVENTS.has(config.event)) {
    logger.warn(
      { event: config.event, hookName: config.name, groupFolder },
      'Invalid hook event, skipping',
    );
    return;
  }

  hooks.on(config.event, (data) => {
    try {
      // For non-global hooks, only fire for matching group
      const eventData = data as unknown as Record<string, unknown>;
      if (
        groupFolder !== 'global' &&
        'groupFolder' in eventData &&
        eventData.groupFolder !== groupFolder
      ) {
        return;
      }

      const effectiveGroup =
        groupFolder === 'global'
          ? (eventData.groupFolder as string) || 'global'
          : groupFolder;

      const vars = buildVars(effectiveGroup, eventData);
      executeAction(effectiveGroup, config.action, vars);
    } catch (err) {
      logger.warn(
        { err, hookName: config.name, groupFolder },
        'Hook action failed',
      );
    }
  });
}

/**
 * Scan all groups/*/hooks/*.json files, parse each as HookConfig,
 * and register with the lifecycle hooks system.
 * Returns the count of hooks loaded.
 */
export function loadHooksFromGroups(): number {
  let count = 0;

  if (!fs.existsSync(GROUPS_DIR)) return count;

  let groupDirs: string[];
  try {
    groupDirs = fs
      .readdirSync(GROUPS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch (err) {
    logger.warn({ err }, 'Failed to read groups directory for hooks');
    return count;
  }

  for (const groupName of groupDirs) {
    const hooksDir = path.join(GROUPS_DIR, groupName, 'hooks');
    if (!fs.existsSync(hooksDir)) continue;

    let files: string[];
    try {
      files = fs
        .readdirSync(hooksDir)
        .filter((f) => f.endsWith('.json'));
    } catch (err) {
      logger.warn(
        { err, group: groupName },
        'Failed to read hooks directory',
      );
      continue;
    }

    for (const file of files) {
      const filePath = path.join(hooksDir, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const config: HookConfig = JSON.parse(raw);

        if (!config.name || !config.event || !config.action) {
          logger.warn(
            { file: filePath },
            'Hook config missing required fields, skipping',
          );
          continue;
        }

        registerHook(groupName, config);
        count++;
        logger.debug(
          { hookName: config.name, event: config.event, group: groupName },
          'Hook registered',
        );
      } catch (err) {
        logger.warn(
          { err, file: filePath },
          'Failed to load hook config',
        );
      }
    }
  }

  return count;
}
