import os from 'os';
import path from 'path';

import { readEnvFile } from './env.js';

// Read config values from .env (falls back to process.env).
// Secrets (API keys, tokens) are NOT read here — they are loaded only
// by the credential proxy (credential-proxy.ts), never exposed to containers.
const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'SHEETS_SPREADSHEET_ID',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ONLY',
  'SLACK_ONLY',
]);

export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || 'Andy';
export const ASSISTANT_HAS_OWN_NUMBER =
  (process.env.ASSISTANT_HAS_OWN_NUMBER ||
    envConfig.ASSISTANT_HAS_OWN_NUMBER) === 'true';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || os.homedir();

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'mount-allowlist.json',
);
export const SENDER_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'sender-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'nanoclaw-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '1800000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const CREDENTIAL_PROXY_PORT = parseInt(
  process.env.CREDENTIAL_PROXY_PORT || '3001',
  10,
);
export const IPC_POLL_INTERVAL = 1000;
export const IDLE_TIMEOUT = parseInt(process.env.IDLE_TIMEOUT || '1800000', 10); // 30min default — how long to keep container alive after last result
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
);

// Container pool: pre-warm mount setup to reduce spawn latency
export const CONTAINER_POOL_ENABLED =
  (process.env.CONTAINER_POOL_ENABLED ?? 'true') !== 'false';
export const CONTAINER_POOL_SIZE = Math.max(
  1,
  parseInt(process.env.CONTAINER_POOL_SIZE || '2', 10) || 2,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// Notification batching: hold outbound scheduled-task messages briefly
// so multiple results arriving close together get merged into one message.
export const NOTIFICATION_BATCH_WINDOW = parseInt(
  process.env.NOTIFICATION_BATCH_WINDOW || '30000',
  10,
); // 30s default
export const NOTIFICATION_BATCH_MAX = parseInt(
  process.env.NOTIFICATION_BATCH_MAX || '5',
  10,
);

// Quiet hours: hold non-critical notifications during this window
export const QUIET_HOURS_START = parseInt(
  process.env.QUIET_HOURS_START || '8',
  10,
);
export const QUIET_HOURS_END = parseInt(
  process.env.QUIET_HOURS_END || '14',
  10,
);

// Patterns indicating "nothing to report" — suppress these notifications
export const NOTHING_TO_REPORT_PATTERNS = [
  /nothing\s*(new\s*)?found/i,
  /no\s*(new\s*)?(leads|changes|issues|alerts|updates|results|opportunities)/i,
  /all\s*(caught\s*up|clear|good|healthy|systems?\s*normal)/i,
  /\b0\s*(new\s*)?(leads|items|results|matches|opportunities)/i,
  /already\s*(done|verified|completed|checked|processed|up[- ]to[- ]date)/i,
  /no\s*action\s*(needed|required)/i,
  /everything\s*(looks?\s*good|is\s*(fine|normal|healthy))/i,
  /nothing\s*to\s*report/i,
];

// Google Sheets alert logging
export const SHEETS_SPREADSHEET_ID =
  process.env.SHEETS_SPREADSHEET_ID || envConfig.SHEETS_SPREADSHEET_ID || '';

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// Budget defaults (can be overridden via setBudgetConfig)
export const DEFAULT_DAILY_BUDGET_USD = parseFloat(
  process.env.DAILY_BUDGET_USD || '10',
);
export const DEFAULT_MONTHLY_BUDGET_USD = parseFloat(
  process.env.MONTHLY_BUDGET_USD || '200',
);
export const BUDGET_SOFT_WARNING_PERCENT = parseInt(
  process.env.BUDGET_SOFT_WARNING_PERCENT || '80',
  10,
);

// Orphan reaper interval (how often to check for stuck containers)
export const ORPHAN_REAP_INTERVAL_MS = parseInt(
  process.env.ORPHAN_REAP_INTERVAL_MS || '300000',
  10,
); // 5 min default

// Telegram channel
export const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || envConfig.TELEGRAM_BOT_TOKEN || '';
export const TELEGRAM_ONLY =
  (process.env.TELEGRAM_ONLY || envConfig.TELEGRAM_ONLY) === 'true';
export const SLACK_ONLY =
  (process.env.SLACK_ONLY || envConfig.SLACK_ONLY) === 'true';
