/**
 * Orphan Reaper for NanoClaw
 *
 * Periodically detects and cleans up stuck/orphaned containers.
 * Complements the existing cleanupOrphans() in container-runtime.ts
 * (which runs once at startup) by running continuously during operation.
 *
 * Detects:
 *   1. Containers running longer than 2x CONTAINER_TIMEOUT (stuck)
 *   2. Containers not tracked by the GroupQueue (orphaned)
 *   3. Containers whose group queue entry has been cleared (leaked)
 */

import { execSync } from 'child_process';

import { CONTAINER_TIMEOUT } from './config.js';
import { CONTAINER_RUNTIME_BIN, stopContainer } from './container-runtime.js';
import { logger } from './logger.js';

// How often to check for orphans (5 minutes)
const REAP_INTERVAL_MS = 5 * 60 * 1000;

// Containers running longer than this are considered stuck
const STUCK_THRESHOLD_MS = CONTAINER_TIMEOUT * 2;

interface ContainerInfo {
  name: string;
  status: string;
  createdAt?: string;
  runningForMs?: number;
}

/**
 * Get all running NanoClaw containers with their metadata.
 */
function listRunningContainers(): ContainerInfo[] {
  try {
    const output = execSync(`${CONTAINER_RUNTIME_BIN} ls --format json`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: 10000,
    });

    const containers: Array<{
      status: string;
      configuration: { id: string };
      created?: string;
    }> = JSON.parse(output || '[]');

    return containers
      .filter(
        (c) =>
          c.status === 'running' && c.configuration.id.startsWith('nanoclaw-'),
      )
      .map((c) => {
        const created = c.created ? new Date(c.created).getTime() : 0;
        return {
          name: c.configuration.id,
          status: c.status,
          createdAt: c.created,
          runningForMs: created ? Date.now() - created : undefined,
        };
      });
  } catch (err) {
    logger.warn({ err }, 'Failed to list containers for orphan check');
    return [];
  }
}

/**
 * Get the set of container names currently tracked by the queue.
 */
type GetTrackedContainers = () => Set<string>;

/**
 * Reap orphaned and stuck containers.
 * Returns the number of containers stopped.
 */
export function reapOrphans(
  getTrackedContainers: GetTrackedContainers,
): number {
  const running = listRunningContainers();
  if (running.length === 0) return 0;

  const tracked = getTrackedContainers();
  let reaped = 0;

  for (const container of running) {
    const isTracked = tracked.has(container.name);
    const isStuck =
      container.runningForMs != null &&
      container.runningForMs > STUCK_THRESHOLD_MS;

    if (!isTracked) {
      logger.warn(
        {
          container: container.name,
          runningForMs: container.runningForMs,
        },
        'Reaping orphaned container (not tracked by queue)',
      );
      stopContainer(container.name);
      reaped++;
    } else if (isStuck) {
      logger.warn(
        {
          container: container.name,
          runningForMs: container.runningForMs,
          threshold: STUCK_THRESHOLD_MS,
        },
        'Reaping stuck container (exceeded 2x timeout)',
      );
      stopContainer(container.name);
      reaped++;
    }
  }

  if (reaped > 0) {
    logger.info({ reaped, total: running.length }, 'Orphan reaper completed');
  }

  return reaped;
}

/**
 * Start the periodic orphan reaper.
 */
export function startOrphanReaper(
  getTrackedContainers: GetTrackedContainers,
): void {
  logger.info(
    { intervalMs: REAP_INTERVAL_MS, stuckThresholdMs: STUCK_THRESHOLD_MS },
    'Orphan reaper started',
  );

  setInterval(() => {
    try {
      reapOrphans(getTrackedContainers);
    } catch (err) {
      logger.error({ err }, 'Orphan reaper error');
    }
  }, REAP_INTERVAL_MS);
}
