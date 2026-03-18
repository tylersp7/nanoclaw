/**
 * Runtime Service Manager for NanoClaw
 *
 * Manages long-running services (dev servers, databases, etc.) that agents
 * may need during execution. Services are shared across container runs via
 * a lease-based lifecycle with automatic idle cleanup.
 *
 * Key concepts:
 *   - Service: A long-running process identified by a unique key
 *   - Lease: A reference from a container run to a service
 *   - Idle timeout: Service auto-stops when no leases remain after a grace period
 *
 * Services are persisted to the router_state table for crash recovery.
 */

import { ChildProcess, spawn } from 'child_process';

import { getRouterState, setRouterState } from './db.js';
import { logger } from './logger.js';

// Default idle timeout before stopping unleased services (15 minutes)
const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export interface ServiceConfig {
  /** Unique key for this service (e.g., "dev-server:3000") */
  key: string;
  /** Command to start the service */
  command: string;
  /** Arguments for the command */
  args?: string[];
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Port the service listens on (for readiness checks) */
  port?: number;
  /** Readiness check URL (HTTP GET, expects 2xx) */
  readinessUrl?: string;
  /** Max time to wait for readiness (ms) */
  readinessTimeoutMs?: number;
  /** Idle timeout before auto-stop (ms) */
  idleTimeoutMs?: number;
  /** Reuse key — services with the same reuse key share a single instance */
  reuseKey?: string;
}

interface ManagedService {
  config: ServiceConfig;
  process: ChildProcess | null;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  leases: Set<string>; // Set of lease IDs (container names)
  startedAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  error?: string;
}

const services = new Map<string, ManagedService>();

function getEffectiveKey(config: ServiceConfig): string {
  return config.reuseKey || config.key;
}

/**
 * Acquire a lease on a service. Starts the service if not already running.
 * Returns the service key for later release.
 */
export async function acquireService(
  config: ServiceConfig,
  leaseId: string,
): Promise<{ key: string; port?: number }> {
  const key = getEffectiveKey(config);
  let service = services.get(key);

  if (service && service.status === 'running') {
    // Service already running — add lease and cancel idle timer
    service.leases.add(leaseId);
    if (service.idleTimer) {
      clearTimeout(service.idleTimer);
      service.idleTimer = null;
    }
    logger.info(
      { key, leaseId, leaseCount: service.leases.size },
      'Lease acquired on existing service',
    );
    return { key, port: service.config.port };
  }

  if (service && service.status === 'starting') {
    // Wait for startup to complete
    service.leases.add(leaseId);
    await waitForStatus(key, 'running', config.readinessTimeoutMs || 30000);
    return { key, port: service.config.port };
  }

  // Start new service
  service = {
    config: { ...config, key },
    process: null,
    status: 'starting',
    leases: new Set([leaseId]),
    startedAt: Date.now(),
    idleTimer: null,
  };
  services.set(key, service);

  try {
    const proc = spawn(config.command, config.args || [], {
      cwd: config.cwd,
      env: { ...process.env, ...config.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    service.process = proc;

    proc.stdout?.on('data', (data: Buffer) => {
      logger.trace({ service: key }, data.toString().trim());
    });

    proc.stderr?.on('data', (data: Buffer) => {
      logger.debug({ service: key }, data.toString().trim());
    });

    proc.on('exit', (code) => {
      logger.info({ service: key, code }, 'Service process exited');
      const svc = services.get(key);
      if (svc) {
        svc.status = 'stopped';
        svc.process = null;
      }
    });

    // Wait for readiness if configured
    if (config.readinessUrl) {
      await waitForReadiness(
        config.readinessUrl,
        config.readinessTimeoutMs || 30000,
      );
    } else if (config.port) {
      // Simple delay for port-based services
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    service.status = 'running';
    persistServiceState();

    logger.info(
      { key, port: config.port, leaseId },
      'Service started and lease acquired',
    );
    return { key, port: config.port };
  } catch (err) {
    service.status = 'error';
    service.error = err instanceof Error ? err.message : String(err);
    logger.error({ key, err }, 'Failed to start service');
    throw err;
  }
}

/**
 * Release a lease on a service. If no leases remain, start the idle timer.
 */
export function releaseService(key: string, leaseId: string): void {
  const service = services.get(key);
  if (!service) return;

  service.leases.delete(leaseId);

  logger.info(
    { key, leaseId, remainingLeases: service.leases.size },
    'Lease released',
  );

  if (service.leases.size === 0 && service.status === 'running') {
    const idleMs =
      service.config.idleTimeoutMs || DEFAULT_IDLE_TIMEOUT_MS;
    service.idleTimer = setTimeout(() => {
      stopService(key);
    }, idleMs);

    logger.debug(
      { key, idleTimeoutMs: idleMs },
      'No leases remaining, idle timer started',
    );
  }

  persistServiceState();
}

/**
 * Stop a service immediately.
 */
export function stopService(key: string): void {
  const service = services.get(key);
  if (!service || !service.process) return;

  service.status = 'stopping';
  if (service.idleTimer) {
    clearTimeout(service.idleTimer);
    service.idleTimer = null;
  }

  try {
    // Try graceful shutdown first
    service.process.kill('SIGTERM');
    setTimeout(() => {
      if (service.process && !service.process.killed) {
        service.process.kill('SIGKILL');
      }
    }, 5000);
  } catch (err) {
    logger.warn({ key, err }, 'Error stopping service');
  }

  services.delete(key);
  persistServiceState();
  logger.info({ key }, 'Service stopped');
}

/**
 * Get status of all managed services.
 */
export function listServices(): Array<{
  key: string;
  status: string;
  leaseCount: number;
  port?: number;
  runningForMs: number;
}> {
  return Array.from(services.entries()).map(([key, svc]) => ({
    key,
    status: svc.status,
    leaseCount: svc.leases.size,
    port: svc.config.port,
    runningForMs: Date.now() - svc.startedAt,
  }));
}

/**
 * Stop all services. Called during shutdown.
 */
export function stopAllServices(): void {
  for (const [key] of services) {
    stopService(key);
  }
}

/**
 * Reconcile service state on startup.
 * Marks any previously-running services as stopped (they didn't survive the restart).
 */
export function reconcileServices(): void {
  const raw = getRouterState('runtime_services');
  if (!raw) return;

  try {
    const persisted = JSON.parse(raw) as Array<{ key: string; status: string }>;
    const staleCount = persisted.filter((s) => s.status === 'running').length;
    if (staleCount > 0) {
      logger.info(
        { staleCount },
        'Reconciled stale runtime services from previous run',
      );
    }
  } catch {
    // Ignore corrupt state
  }

  // Clear persisted state — fresh start
  setRouterState('runtime_services', '[]');
}

// --- Internal helpers ---

async function waitForReadiness(
  url: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const { request } = await import('http');

  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = request(url, { timeout: 2000 }, (res) => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
          res.resume(); // Drain response
        });
        req.on('error', reject);
        req.end();
      });
      return; // Ready
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  throw new Error(`Service readiness timeout after ${timeoutMs}ms: ${url}`);
}

async function waitForStatus(
  key: string,
  status: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const service = services.get(key);
    if (service?.status === status) return;
    if (service?.status === 'error') {
      throw new Error(`Service ${key} failed: ${service.error}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timeout waiting for service ${key} to reach status ${status}`);
}

function persistServiceState(): void {
  const state = Array.from(services.entries()).map(([key, svc]) => ({
    key,
    status: svc.status,
    port: svc.config.port,
    startedAt: svc.startedAt,
    leaseCount: svc.leases.size,
  }));
  setRouterState('runtime_services', JSON.stringify(state));
}
