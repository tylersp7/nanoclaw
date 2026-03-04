/**
 * Network Relay Server
 *
 * Lightweight HTTP server on the host's bridge gateway IP (192.168.64.1)
 * that proxies SSH commands and HTTP requests from containers through the
 * host's Tailscale network.
 *
 * Containers can't reach Tailscale IPs (100.64/10) because Apple Container's
 * NAT bridge doesn't route through the utun5 interface. Additionally, the
 * host's DNS resolves some domains to Tailscale IPs (e.g. n8n), which the
 * container can't reach even with correct DNS resolution.
 *
 * This relay runs on the host (which HAS Tailscale access) and proxies:
 *   POST /exec  - SSH commands to configured VPS servers
 *   POST /fetch - HTTP requests through the host's network
 */
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { logger } from './logger.js';
import { sshExec } from './vps-monitor.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const RELAY_HOST = '192.168.64.1';
const RELAY_PORT = 19876;

// Generate a per-session secret for relay auth
let relaySecret: string | null = null;

export function getRelaySecret(): string {
  if (!relaySecret) {
    relaySecret = crypto.randomBytes(32).toString('hex');
  }
  return relaySecret;
}

export function getRelayUrl(): string {
  return `http://${RELAY_HOST}:${RELAY_PORT}`;
}

function loadVpsConfig(): Record<string, any> | null {
  const configPath = path.join(os.homedir(), '.nanoclaw-vps', 'config.json');
  if (!fs.existsSync(configPath)) return null;
  return JSON.parse(fs.readFileSync(configPath, 'utf-8')).servers || {};
}

/**
 * Proxy an HTTP(S) request through the host's network.
 * Used by containers that can't resolve or reach Tailscale-routed domains.
 */
function handleFetch(body: string, res: http.ServerResponse): void {
  let parsed: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  if (!parsed.url) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing url' }));
    return;
  }

  const url = new URL(parsed.url);
  const client = url.protocol === 'https:' ? https : http;

  const proxyReq = client.request(
    parsed.url,
    {
      method: parsed.method || 'GET',
      headers: parsed.headers || {},
      timeout: 15000,
    },
    (proxyRes) => {
      let data = '';
      proxyRes.on('data', (chunk) => {
        data += chunk;
      });
      proxyRes.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: proxyRes.statusCode,
            headers: proxyRes.headers,
            body: data,
          }),
        );
      });
    },
  );

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ error: `Upstream request failed: ${err.message}` }),
    );
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.writeHead(504, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Upstream request timed out' }));
  });

  if (parsed.body) {
    proxyReq.write(parsed.body);
  }
  proxyReq.end();
}

/**
 * Handle SSH command execution via the host's Tailscale-connected SSH.
 */
async function handleExec(
  body: string,
  res: http.ServerResponse,
): Promise<void> {
  const { serverName, command } = JSON.parse(body);

  if (!serverName || !command) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing serverName or command' }));
    return;
  }

  const currentServers = loadVpsConfig();
  if (!currentServers || !currentServers[serverName]) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Unknown server: ${serverName}` }));
    return;
  }

  logger.info({ serverName, commandLength: command.length }, 'Relay: SSH exec');

  const result = await sshExec(currentServers[serverName], command);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ result }));
}

export function startRelayServer(): http.Server | null {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${getRelaySecret()}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const urlPath = req.url || '/';

        if (urlPath === '/exec') {
          await handleExec(body, res);
        } else if (urlPath === '/fetch') {
          handleFetch(body, res);
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found. Use /exec or /fetch' }));
        }
      } catch (err: any) {
        logger.warn(
          { error: err.message, path: req.url },
          'Relay: request failed',
        );
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      }
    });
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRNOTAVAIL') {
      logger.warn(
        'Relay: bridge interface 192.168.64.1 not available (no containers running?). Relay disabled.',
      );
    } else {
      logger.error({ error: err }, 'Relay: server error');
    }
  });

  server.listen(RELAY_PORT, RELAY_HOST, () => {
    logger.info(
      { host: RELAY_HOST, port: RELAY_PORT },
      'Network relay server started (SSH + HTTP proxy)',
    );
  });

  return server;
}
