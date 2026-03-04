import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';

interface VPSConfig {
  name: string;
  host: string;
  publicHost?: string;
  user: string;
  port: number;
  keyPath: string;
  services: string[];
  sshMode?: 'standard' | 'tailscale';
  n8n?: {
    url: string;
    apiKeyEnv: string;
  };
}

interface ServerConfigs {
  servers: Record<string, VPSConfig>;
}

interface HealthReport {
  server: string;
  timestamp: string;
  uptime: string;
  cpu: { loadAvg: string; cores: number };
  memory: { used: string; total: string; percent: string };
  disk: Array<{ mount: string; used: string; total: string; percent: string }>;
  docker: Array<{ name: string; status: string; image: string }>;
  services: Array<{ name: string; active: boolean }>;
  recentErrors: string[];
  connectionMethod?: string;
}

function loadConfig(): ServerConfigs {
  const configPath = path.join(os.homedir(), '.nanoclaw-vps', 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('VPS config not found at ~/.nanoclaw-vps/config.json');
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function resolveKeyPath(keyPath: string): string {
  return keyPath.replace('~', os.homedir());
}

/**
 * Execute a command via the host-side SSH relay.
 * Used when running inside a container that can't reach Tailscale IPs directly.
 */
function sshExecViaRelay(
  serverName: string,
  command: string,
  relayUrl: string,
  relaySecret: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ serverName, command });
    const url = new URL('/exec', relayUrl);

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${relaySecret}`,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 30000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode === 200 && parsed.result !== undefined) {
              resolve(parsed.result);
            } else {
              reject(
                new Error(parsed.error || `Relay returned ${res.statusCode}`),
              );
            }
          } catch {
            reject(
              new Error(`Relay returned invalid JSON: ${data.slice(0, 200)}`),
            );
          }
        });
      },
    );

    req.on('error', (err) =>
      reject(new Error(`SSH relay connection failed: ${err.message}`)),
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('SSH relay request timed out'));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Execute a command on a remote server via SSH
 * Tries multiple connection methods: primary host, then public host fallback.
 * If SSH_RELAY_URL is set (container environment), uses the host-side relay
 * for servers that use Tailscale mode.
 */
export function sshExec(server: VPSConfig, command: string): Promise<string> {
  // Check if we should use the SSH relay (running inside a container)
  const relayUrl = process.env.SSH_RELAY_URL;
  const relaySecret = process.env.SSH_RELAY_SECRET;
  if (relayUrl && relaySecret && server.sshMode === 'tailscale') {
    // Find the server name from config to pass to relay
    const configPath = path.join(os.homedir(), '.nanoclaw-vps', 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const serverName = Object.entries(config.servers || {}).find(
        ([, s]: [string, any]) => s.host === server.host,
      )?.[0];
      if (serverName) {
        return sshExecViaRelay(serverName, command, relayUrl, relaySecret);
      }
    }
  }

  // Direct SSH: build list of hosts to try
  const hosts: Array<{ host: string; port: number; label: string }> = [
    { host: server.host, port: server.port, label: 'primary' },
  ];
  if (server.publicHost) {
    hosts.push({ host: server.publicHost, port: server.port, label: 'public' });
  }

  return tryHosts(server, command, hosts, 0);
}

function tryHosts(
  server: VPSConfig,
  command: string,
  hosts: Array<{ host: string; port: number; label: string }>,
  index: number,
): Promise<string> {
  if (index >= hosts.length) {
    const tried = hosts.map((h) => `${h.host}:${h.port}`).join(', ');
    const hint =
      server.sshMode === 'tailscale'
        ? '. BeastMode uses Tailscale SSH which requires browser auth. To fix: enable standard OpenSSH on port 2222 on the VPS, or run commands from the host machine.'
        : '';
    return Promise.reject(
      new Error(
        `SSH connection failed to ${server.name}. Tried: ${tried}${hint}`,
      ),
    );
  }

  const { host, port, label } = hosts[index];

  return new Promise((resolve, reject) => {
    const conn = new Client();
    let output = '';

    const keyFile = resolveKeyPath(server.keyPath);
    if (!fs.existsSync(keyFile)) {
      reject(new Error(`SSH key not found: ${keyFile}`));
      return;
    }

    const timeout = setTimeout(() => {
      conn.end();
      // Try next host
      tryHosts(server, command, hosts, index + 1)
        .then(resolve)
        .catch(reject);
    }, 8000);

    conn.on('ready', () => {
      clearTimeout(timeout);
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          reject(err);
          return;
        }

        stream.on('close', () => {
          conn.end();
          resolve(output.trim());
        });

        stream.on('data', (data: Buffer) => {
          output += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          output += data.toString();
        });
      });
    });

    conn.on('error', () => {
      clearTimeout(timeout);
      // Try next host
      tryHosts(server, command, hosts, index + 1)
        .then(resolve)
        .catch(reject);
    });

    conn.connect({
      host,
      port,
      username: server.user,
      privateKey: fs.readFileSync(keyFile),
      readyTimeout: 8000,
    });
  });
}

/**
 * Get full health report for a server
 */
export async function getHealthReport(
  serverName: string,
): Promise<HealthReport> {
  const config = loadConfig();
  const server = config.servers[serverName];
  if (!server) {
    throw new Error(
      `Server '${serverName}' not found. Available: ${Object.keys(config.servers).join(', ')}`,
    );
  }

  const commands = [
    'uptime -p 2>/dev/null || uptime',
    'cat /proc/loadavg',
    'nproc',
    'free -m | grep Mem',
    'df -h --output=target,used,size,pcent / /var /tmp 2>/dev/null || df -h /',
    'docker ps --format "{{.Names}}|{{.Status}}|{{.Image}}" 2>/dev/null || echo "NO_DOCKER"',
    'journalctl --no-pager -p err -n 10 --since "1 hour ago" 2>/dev/null || dmesg | tail -10',
  ];

  const combinedCommand = commands
    .map((cmd, i) => `echo "===SECTION${i}==="; ${cmd}`)
    .join('; ');

  try {
    const output = await sshExec(server, combinedCommand);
    const sections = output
      .split(/===SECTION\d+===/)
      .filter((s: string) => s.trim());

    const uptime = sections[0]?.trim() || 'unknown';
    const loadParts = sections[1]?.trim().split(' ') || [];
    const loadAvg = loadParts.slice(0, 3).join(' ');
    const cores = parseInt(sections[2]?.trim() || '1');

    const memLine = sections[3]?.trim() || '';
    const memParts = memLine.split(/\s+/);
    const memTotal = memParts[1] ? `${memParts[1]}MB` : 'unknown';
    const memUsed = memParts[2] ? `${memParts[2]}MB` : 'unknown';
    const memPercent =
      memParts[1] && memParts[2]
        ? `${Math.round((parseInt(memParts[2]) / parseInt(memParts[1])) * 100)}%`
        : 'unknown';

    const diskLines =
      sections[4]
        ?.trim()
        .split('\n')
        .filter((l: string) => l && !l.startsWith('Mounted')) || [];
    const disk = diskLines.map((line: string) => {
      const parts = line.split(/\s+/);
      return {
        mount: parts[0] || '/',
        used: parts[1] || '?',
        total: parts[2] || '?',
        percent: parts[3] || '?',
      };
    });

    const dockerOutput = sections[5]?.trim() || '';
    const docker =
      dockerOutput === 'NO_DOCKER'
        ? []
        : dockerOutput
            .split('\n')
            .filter((l: string) => l.trim())
            .map((line: string) => {
              const [name, status, image] = line.split('|');
              return {
                name: name || 'unknown',
                status: status || 'unknown',
                image: image || 'unknown',
              };
            });

    const errorOutput = sections[6]?.trim() || '';
    const recentErrors = errorOutput
      .split('\n')
      .filter((l: string) => l.trim())
      .slice(0, 10);

    const serviceChecks = await checkServices(server);

    return {
      server: server.name,
      timestamp: new Date().toISOString(),
      uptime,
      cpu: { loadAvg, cores },
      memory: { used: memUsed, total: memTotal, percent: memPercent },
      disk,
      docker,
      services: serviceChecks,
      recentErrors,
      connectionMethod: 'ssh',
    };
  } catch (sshError: any) {
    // If SSH fails and server has n8n, try to get partial health via n8n API
    if (server.n8n) {
      return getPartialHealthViaN8n(server, sshError.message);
    }
    throw sshError;
  }
}

/**
 * Get partial health report via n8n API when SSH is unavailable.
 * Uses the n8n-api-helper (which supports relay mode in containers).
 */
async function getPartialHealthViaN8n(
  server: VPSConfig,
  sshError: string,
): Promise<HealthReport> {
  const report: HealthReport = {
    server: server.name,
    timestamp: new Date().toISOString(),
    uptime: 'unknown (SSH unavailable)',
    cpu: { loadAvg: 'unknown', cores: 0 },
    memory: { used: 'unknown', total: 'unknown', percent: 'unknown' },
    disk: [],
    docker: [],
    services: [],
    recentErrors: [`SSH: ${sshError}`],
    connectionMethod: 'n8n-api-only',
  };

  if (process.env.N8N_API_KEY && server.n8n) {
    try {
      const { listWorkflows } = await import('./n8n-api-helper.js');
      const workflows = await listWorkflows();
      const active = workflows.filter((w: any) => w.active).length;
      report.services.push({ name: 'n8n', active: true });
      report.services.push({
        name: `n8n-workflows (${active} active)`,
        active: true,
      });
    } catch {
      report.services.push({ name: 'n8n', active: false });
    }
  }

  return report;
}

/**
 * Check if services are running
 */
async function checkServices(
  server: VPSConfig,
): Promise<Array<{ name: string; active: boolean }>> {
  const results: Array<{ name: string; active: boolean }> = [];

  for (const service of server.services) {
    try {
      if (service === 'docker') {
        const output = await sshExec(
          server,
          'systemctl is-active docker 2>/dev/null || service docker status 2>/dev/null | head -1',
        );
        results.push({
          name: 'docker',
          active: output.includes('active') || output.includes('running'),
        });
      } else if (service === 'n8n') {
        const output = await sshExec(
          server,
          'docker ps --filter name=n8n --format "{{.Status}}" 2>/dev/null || systemctl is-active n8n 2>/dev/null',
        );
        results.push({
          name: 'n8n',
          active: output.includes('Up') || output.includes('active'),
        });
      } else {
        const output = await sshExec(
          server,
          `systemctl is-active ${service} 2>/dev/null || service ${service} status 2>/dev/null | head -1`,
        );
        results.push({
          name: service,
          active: output.includes('active') || output.includes('running'),
        });
      }
    } catch {
      results.push({ name: service, active: false });
    }
  }

  return results;
}

/**
 * Get Docker container logs
 */
export async function getContainerLogs(
  serverName: string,
  containerName: string,
  lines: number = 50,
): Promise<string> {
  const config = loadConfig();
  const server = config.servers[serverName];
  if (!server) throw new Error(`Server '${serverName}' not found`);
  return sshExec(server, `docker logs --tail ${lines} ${containerName} 2>&1`);
}

/**
 * Restart a Docker container
 */
export async function restartContainer(
  serverName: string,
  containerName: string,
): Promise<string> {
  const config = loadConfig();
  const server = config.servers[serverName];
  if (!server) throw new Error(`Server '${serverName}' not found`);
  return sshExec(server, `docker restart ${containerName} 2>&1`);
}

/**
 * Restart a system service
 */
export async function restartService(
  serverName: string,
  serviceName: string,
): Promise<string> {
  const config = loadConfig();
  const server = config.servers[serverName];
  if (!server) throw new Error(`Server '${serverName}' not found`);
  return sshExec(server, `sudo systemctl restart ${serviceName} 2>&1`);
}

/**
 * Run arbitrary command on VPS
 */
export async function runCommand(
  serverName: string,
  command: string,
): Promise<string> {
  const config = loadConfig();
  const server = config.servers[serverName];
  if (!server) throw new Error(`Server '${serverName}' not found`);
  return sshExec(server, command);
}

/**
 * List available servers
 */
export function listServers(): Array<{
  id: string;
  name: string;
  host: string;
  sshMode: string;
}> {
  const config = loadConfig();
  return Object.entries(config.servers).map(([id, server]) => ({
    id,
    name: server.name,
    host: server.host,
    sshMode: server.sshMode || 'standard',
  }));
}

/**
 * Format health report for WhatsApp
 */
export function formatHealthForWhatsApp(report: HealthReport): string {
  const method =
    report.connectionMethod === 'n8n-api-only'
      ? '\n⚠️ _SSH unavailable — partial report via n8n API_\n'
      : '';

  const serviceStatus = report.services
    .map(
      (s: { name: string; active: boolean }) =>
        `${s.active ? '✅' : '❌'} ${s.name}`,
    )
    .join('\n');

  const dockerStatus =
    report.docker.length > 0
      ? report.docker
          .map((d: { name: string; status: string }) => {
            const isUp = d.status.toLowerCase().includes('up');
            return `${isUp ? '✅' : '❌'} ${d.name} - ${d.status}`;
          })
          .join('\n')
      : 'No Docker containers';

  const diskStatus = report.disk
    .map(
      (d: { mount: string; used: string; total: string; percent: string }) =>
        `${d.mount}: ${d.used}/${d.total} (${d.percent})`,
    )
    .join('\n');

  const errors =
    report.recentErrors.length > 0
      ? report.recentErrors.slice(0, 5).join('\n')
      : 'No recent errors';

  return `*${report.server} Health Report*
${new Date(report.timestamp).toLocaleString()}${method}

*Uptime:* ${report.uptime}
*CPU:* Load ${report.cpu.loadAvg} (${report.cpu.cores} cores)
*Memory:* ${report.memory.used}/${report.memory.total} (${report.memory.percent})

*Disk:*
${diskStatus || 'N/A'}

*Services:*
${serviceStatus || 'N/A'}

*Docker:*
${dockerStatus}

*Recent Errors:*
${errors}`;
}
