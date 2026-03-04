import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import http from 'http';
import path from 'path';
import os from 'os';

interface N8nConfig {
  url: string;
  apiKey: string;
}

interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  tags: Array<{ name: string }>;
}

interface N8nExecution {
  id: string;
  finished: boolean;
  mode: string;
  startedAt: string;
  stoppedAt: string;
  workflowId: string;
  workflowName?: string;
  status: 'success' | 'error' | 'waiting' | 'running' | 'crashed';
  retryOf?: string;
}

interface N8nExecutionDetail extends N8nExecution {
  data?: {
    resultData?: {
      error?: {
        message: string;
        stack?: string;
        node?: { name: string };
      };
    };
  };
}

let apiClient: AxiosInstance | null = null;

function loadConfig(): N8nConfig {
  // Try environment variable first
  const apiKey = process.env.N8N_API_KEY;
  if (apiKey) {
    // When using SSH_RELAY, connect to n8n via Tailscale IP instead of public domain
    // The relay can reach Tailscale IPs from the host network
    if (process.env.SSH_RELAY_URL && process.env.SSH_RELAY_SECRET) {
      const vpsConfigPath = path.join(
        os.homedir(),
        '.nanoclaw-vps',
        'config.json',
      );
      if (fs.existsSync(vpsConfigPath)) {
        const vpsConfig = JSON.parse(fs.readFileSync(vpsConfigPath, 'utf-8'));
        const beastmode = vpsConfig.servers?.beastmode;
        if (beastmode?.host) {
          // Use Tailscale IP with local n8n port
          return { url: `http://${beastmode.host}:5678`, apiKey };
        }
      }
    }

    // Fallback to VPS config URL or default
    const vpsConfigPath = path.join(
      os.homedir(),
      '.nanoclaw-vps',
      'config.json',
    );
    if (fs.existsSync(vpsConfigPath)) {
      const vpsConfig = JSON.parse(fs.readFileSync(vpsConfigPath, 'utf-8'));
      const beastmode = vpsConfig.servers?.beastmode;
      if (beastmode?.n8n?.url) {
        return { url: beastmode.n8n.url, apiKey };
      }
    }
    return { url: 'https://n8n.sparksbusinesssolutionsllc.com', apiKey };
  }

  // Try config file
  const configPath = path.join(os.homedir(), '.nanoclaw-n8n', 'config.json');
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }

  throw new Error(
    'n8n API key not found. Set N8N_API_KEY env var or create ~/.nanoclaw-n8n/config.json',
  );
}

/**
 * Make an HTTP request through the host-side relay.
 * Used when running inside a container that can't reach Tailscale-routed domains.
 */
function fetchViaRelay(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; body: string }> {
  const relayUrl = process.env.SSH_RELAY_URL!;
  const relaySecret = process.env.SSH_RELAY_SECRET!;

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ url, method, headers, body });
    const endpoint = new URL('/fetch', relayUrl);

    const req = http.request(
      {
        hostname: endpoint.hostname,
        port: endpoint.port,
        path: endpoint.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${relaySecret}`,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 20000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode === 200) {
              resolve({ status: parsed.status, body: parsed.body });
            } else {
              reject(
                new Error(parsed.error || `Relay returned ${res.statusCode}`),
              );
            }
          } catch {
            reject(new Error(`Relay returned invalid response`));
          }
        });
      },
    );
    req.on('error', (err) =>
      reject(new Error(`Relay connection failed: ${err.message}`)),
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Relay request timed out'));
    });
    req.write(payload);
    req.end();
  });
}

function getClient(): AxiosInstance {
  if (apiClient) return apiClient;

  const config = loadConfig();
  apiClient = axios.create({
    baseURL: `${config.url}/api/v1`,
    headers: {
      'X-N8N-API-KEY': config.apiKey,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });

  // When running in a container with relay access, intercept requests
  // and route them through the host's network (which can reach Tailscale IPs)
  if (process.env.SSH_RELAY_URL && process.env.SSH_RELAY_SECRET) {
    apiClient.interceptors.request.use(async (reqConfig) => {
      // Build the full URL including query params
      const url = new URL(reqConfig.url || '', reqConfig.baseURL);
      if (reqConfig.params) {
        for (const [k, v] of Object.entries(reqConfig.params)) {
          if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
        }
      }

      const method = (reqConfig.method || 'GET').toUpperCase();
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(reqConfig.headers || {})) {
        if (typeof v === 'string') headers[k] = v;
      }

      const relayResult = await fetchViaRelay(
        url.toString(),
        method,
        headers,
        reqConfig.data ? JSON.stringify(reqConfig.data) : undefined,
      );

      // Short-circuit axios by returning a resolved response from the adapter
      reqConfig.adapter = () =>
        Promise.resolve({
          data: JSON.parse(relayResult.body),
          status: relayResult.status,
          statusText: relayResult.status === 200 ? 'OK' : 'Error',
          headers: {},
          config: reqConfig,
        });

      return reqConfig;
    });
  }

  return apiClient;
}

/**
 * List all workflows
 */
export async function listWorkflows(
  activeOnly: boolean = false,
): Promise<N8nWorkflow[]> {
  const client = getClient();
  const { data } = await client.get('/workflows', {
    params: activeOnly ? { active: true } : {},
  });
  return data.data || data;
}

/**
 * Get workflow by ID
 */
export async function getWorkflow(id: string): Promise<N8nWorkflow> {
  const client = getClient();
  const { data } = await client.get(`/workflows/${id}`);
  return data;
}

/**
 * Activate/deactivate a workflow
 */
export async function setWorkflowActive(
  id: string,
  active: boolean,
): Promise<void> {
  const client = getClient();
  await client.patch(`/workflows/${id}`, { active });
}

/**
 * List recent executions
 */
export async function listExecutions(options?: {
  workflowId?: string;
  status?: 'success' | 'error' | 'waiting';
  limit?: number;
}): Promise<N8nExecution[]> {
  const client = getClient();
  const params: any = {
    limit: options?.limit || 20,
  };

  if (options?.workflowId) params.workflowId = options.workflowId;
  if (options?.status) params.status = options.status;

  const { data } = await client.get('/executions', { params });
  return data.data || data;
}

/**
 * Get execution details (including error info)
 */
export async function getExecution(id: string): Promise<N8nExecutionDetail> {
  const client = getClient();
  const { data } = await client.get(`/executions/${id}`);
  return data;
}

/**
 * Get failed executions with error details
 */
export async function getFailedExecutions(
  limit: number = 10,
): Promise<
  Array<N8nExecution & { errorMessage?: string; errorNode?: string }>
> {
  const executions = await listExecutions({ status: 'error', limit });

  const detailed = await Promise.all(
    executions.slice(0, limit).map(async (exec) => {
      try {
        const detail = await getExecution(exec.id);
        return {
          ...exec,
          errorMessage: detail.data?.resultData?.error?.message,
          errorNode: detail.data?.resultData?.error?.node?.name,
        };
      } catch {
        return {
          ...exec,
          errorMessage: 'Could not fetch details',
          errorNode: undefined,
        };
      }
    }),
  );

  return detailed;
}

/**
 * Retry a failed execution
 */
export async function retryExecution(id: string): Promise<N8nExecution> {
  const client = getClient();
  const { data } = await client.post(`/executions/${id}/retry`);
  return data;
}

/**
 * Delete an execution
 */
export async function deleteExecution(id: string): Promise<void> {
  const client = getClient();
  await client.delete(`/executions/${id}`);
}

/**
 * Get execution statistics
 */
export async function getExecutionStats(hours: number = 24): Promise<{
  total: number;
  success: number;
  failed: number;
  running: number;
  successRate: string;
  topErrors: Array<{ workflow: string; count: number; lastError: string }>;
}> {
  const [successExecs, failedExecs] = await Promise.all([
    listExecutions({ status: 'success', limit: 100 }),
    listExecutions({ status: 'error', limit: 100 }),
  ]);

  const cutoff = Date.now() - hours * 60 * 60 * 1000;

  const recentSuccess = successExecs.filter(
    (e) => new Date(e.startedAt).getTime() > cutoff,
  );
  const recentFailed = failedExecs.filter(
    (e) => new Date(e.startedAt).getTime() > cutoff,
  );

  // Group errors by workflow
  const errorsByWorkflow: Record<string, { count: number; lastError: string }> =
    {};
  for (const exec of recentFailed) {
    const wfName = exec.workflowName || exec.workflowId;
    if (!errorsByWorkflow[wfName]) {
      errorsByWorkflow[wfName] = { count: 0, lastError: '' };
    }
    errorsByWorkflow[wfName].count++;
  }

  const topErrors = Object.entries(errorsByWorkflow)
    .map(([workflow, info]) => ({ workflow, ...info }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const total = recentSuccess.length + recentFailed.length;
  const successRate =
    total > 0 ? `${Math.round((recentSuccess.length / total) * 100)}%` : 'N/A';

  return {
    total,
    success: recentSuccess.length,
    failed: recentFailed.length,
    running: 0,
    successRate,
    topErrors,
  };
}

/**
 * Format workflows for WhatsApp
 */
export function formatWorkflowsForWhatsApp(workflows: N8nWorkflow[]): string {
  if (workflows.length === 0) return 'No workflows found.';

  return workflows
    .map((wf, i) => {
      const status = wf.active ? '🟢 Active' : '⚪ Inactive';
      const tags = wf.tags?.map((t) => t.name).join(', ') || '';

      return `${i + 1}. *${wf.name}* ${status}
ID: ${wf.id}${tags ? ` • Tags: ${tags}` : ''}`;
    })
    .join('\n');
}

/**
 * Format executions for WhatsApp
 */
export function formatExecutionsForWhatsApp(
  executions: Array<
    N8nExecution & { errorMessage?: string; errorNode?: string }
  >,
): string {
  if (executions.length === 0) return 'No executions found.';

  return executions
    .map((exec, i) => {
      const statusEmoji =
        {
          success: '✅',
          error: '❌',
          waiting: '⏳',
          running: '🔄',
          crashed: '💥',
        }[exec.status] || '❓';

      const time = new Date(exec.startedAt).toLocaleString();
      const error = exec.errorMessage
        ? `\nError: ${exec.errorMessage.substring(0, 150)}`
        : '';
      const node = exec.errorNode ? ` (node: ${exec.errorNode})` : '';

      return `${i + 1}. ${statusEmoji} ${exec.workflowName || exec.workflowId}
${time} • ${exec.mode}${node}${error}`;
    })
    .join('\n\n');
}

/**
 * Format stats for WhatsApp
 */
export function formatStatsForWhatsApp(
  stats: {
    total: number;
    success: number;
    failed: number;
    successRate: string;
    topErrors: Array<{ workflow: string; count: number }>;
  },
  hours: number,
): string {
  let output = `*n8n Execution Stats (last ${hours}h)*

Total: ${stats.total}
✅ Success: ${stats.success}
❌ Failed: ${stats.failed}
📊 Success Rate: ${stats.successRate}`;

  if (stats.topErrors.length > 0) {
    output += '\n\n*Top Errors:*\n';
    output += stats.topErrors
      .map((e) => `• ${e.workflow}: ${e.count} failures`)
      .join('\n');
  }

  return output;
}
