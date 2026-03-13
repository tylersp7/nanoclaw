/**
 * Container Runtime Abstraction
 *
 * Centralizes all runtime-specific logic (Apple Container CLI commands)
 * so the rest of the codebase doesn't hardcode binary names or commands.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';

import { logger } from './logger.js';

/** The container runtime binary name. */
export const CONTAINER_RUNTIME_BIN = 'container';

/**
 * IP address containers use to reach the host machine.
 * Called after ensureContainerRuntimeRunning() so bridge100 exists on macOS.
 * Apple Containers (macOS): bridge100 gateway, typically 192.168.64.1.
 * Docker (Linux): host.docker.internal (resolved via --add-host).
 */
let _hostGateway: string | null = null;

export function getContainerHostGateway(): string {
  if (!_hostGateway) {
    _hostGateway = process.env.CONTAINER_HOST_GATEWAY || detectHostGateway();
  }
  return _hostGateway;
}

function detectHostGateway(): string {
  if (os.platform() === 'darwin') {
    // Apple Containers uses bridge100; find the host's IP on that interface
    const ifaces = os.networkInterfaces();
    const bridge = ifaces['bridge100'];
    if (bridge) {
      const ipv4 = bridge.find((a) => a.family === 'IPv4');
      if (ipv4) return ipv4.address;
    }
    return '192.168.64.1'; // fallback
  }
  return 'host.docker.internal';
}

/**
 * Address the credential proxy binds to.
 * Must match getContainerHostGateway() so containers can reach the proxy.
 */
let _proxyBindHost: string | null = null;

export function getProxyBindHost(): string {
  if (!_proxyBindHost) {
    _proxyBindHost = process.env.CREDENTIAL_PROXY_HOST || detectProxyBindHost();
  }
  return _proxyBindHost;
}

function detectProxyBindHost(): string {
  if (os.platform() === 'darwin') {
    return getContainerHostGateway();
  }

  // WSL uses Docker Desktop (same VM routing as macOS) — loopback is correct.
  if (fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')) return '127.0.0.1';

  // Bare-metal Linux: bind to the docker0 bridge IP instead of 0.0.0.0
  const ifaces = os.networkInterfaces();
  const docker0 = ifaces['docker0'];
  if (docker0) {
    const ipv4 = docker0.find((a) => a.family === 'IPv4');
    if (ipv4) return ipv4.address;
  }
  return '0.0.0.0';
}

/** CLI args needed for the container to resolve the host gateway. */
export function hostGatewayArgs(): string[] {
  // On Linux, host.docker.internal isn't built-in — add it explicitly
  if (os.platform() === 'linux') {
    return ['--add-host=host.docker.internal:host-gateway'];
  }
  return [];
}

/** Returns CLI args for a readonly bind mount. */
export function readonlyMountArgs(
  hostPath: string,
  containerPath: string,
): string[] {
  return [
    '--mount',
    `type=bind,source=${hostPath},target=${containerPath},readonly`,
  ];
}

/** Stop a running container by name. */
export function stopContainer(name: string): void {
  try {
    execSync(`${CONTAINER_RUNTIME_BIN} stop ${name}`, { stdio: 'pipe' });
  } catch {
    /* already stopped */
  }
}

/** Ensure the container runtime system is running. */
export function ensureContainerRuntimeRunning(): void {
  try {
    execSync(`${CONTAINER_RUNTIME_BIN} system status`, { stdio: 'pipe' });
    logger.debug('Container runtime already running');
  } catch {
    logger.info('Starting container runtime...');
    try {
      execSync(`${CONTAINER_RUNTIME_BIN} system start`, {
        stdio: 'pipe',
        timeout: 30000,
      });
      logger.info('Container runtime started');
    } catch (err) {
      logger.error({ err }, 'Failed to start container runtime');
      console.error(
        '\n╔════════════════════════════════════════════════════════════════╗',
      );
      console.error(
        '║  FATAL: Apple Container system failed to start                 ║',
      );
      console.error(
        '║                                                                ║',
      );
      console.error(
        '║  Agents cannot run without Apple Container. To fix:           ║',
      );
      console.error(
        '║  1. Install from: https://github.com/apple/container/releases ║',
      );
      console.error(
        '║  2. Run: container system start                               ║',
      );
      console.error(
        '║  3. Restart NanoClaw                                          ║',
      );
      console.error(
        '╚════════════════════════════════════════════════════════════════╝\n',
      );
      throw new Error('Container runtime is required but failed to start');
    }
  }
}

/** Kill and clean up orphaned NanoClaw containers from previous runs. */
export function cleanupOrphans(): void {
  try {
    const output = execSync(`${CONTAINER_RUNTIME_BIN} ls --format json`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    const containers: { status: string; configuration: { id: string } }[] =
      JSON.parse(output || '[]');
    const orphans = containers
      .filter(
        (c) =>
          c.status === 'running' && c.configuration.id.startsWith('nanoclaw-'),
      )
      .map((c) => c.configuration.id);
    for (const name of orphans) {
      stopContainer(name);
    }
    if (orphans.length > 0) {
      logger.info(
        { count: orphans.length, names: orphans },
        'Stopped orphaned containers',
      );
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up orphaned containers');
  }
}
