import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { SHEETS_SPREADSHEET_ID } from './config.js';
import { logger } from './logger.js';

const CREDENTIALS_PATH = path.join(
  os.homedir(),
  '.nanoclaw-calendar',
  'credentials.json',
);
const TOKEN_PATH = path.join(os.homedir(), '.nanoclaw-sheets', 'token.json');

const FLUSH_INTERVAL_MS = 30_000;
const MAX_BATCH_SIZE = 10;
const MAX_MESSAGE_LENGTH = 2000;
const SHEET_TAB_NAME = 'Alerts';

const HEADERS = [
  'Timestamp',
  'Task ID',
  'Task Name',
  'Chat JID',
  'Severity',
  'Message',
  'Suppressed',
];

let sheetsClient: any = null;
let buffer: string[][] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let sheetEnsured = false;

function loadCredentials() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));

  const { client_secret, client_id } = credentials.installed || credentials.web;
  const oauth2Client = new google.auth.OAuth2(client_id, client_secret);
  oauth2Client.setCredentials(tokens);

  // Auto-refresh token
  oauth2Client.on('tokens', (newTokens: any) => {
    const existing = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    const merged = { ...existing, ...newTokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged));
  });

  return oauth2Client;
}

function getSheets() {
  if (sheetsClient) return sheetsClient;

  const auth = loadCredentials();
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

/**
 * Returns true if Sheets logging is configured (token exists and spreadsheet ID set).
 */
export function isConfigured(): boolean {
  return (
    !!SHEETS_SPREADSHEET_ID &&
    fs.existsSync(CREDENTIALS_PATH) &&
    fs.existsSync(TOKEN_PATH)
  );
}

/**
 * Extract severity from message text.
 */
function extractSeverity(text: string): string {
  const upper = text.toUpperCase();
  if (
    upper.includes('CRITICAL') ||
    upper.includes('🔴') ||
    upper.includes('DOWN')
  )
    return 'CRITICAL';
  if (
    upper.includes('WARNING') ||
    upper.includes('⚠') ||
    upper.includes('WARN')
  )
    return 'WARNING';
  return 'info';
}

/**
 * Extract a short task name from the prompt text.
 * Takes text before the first colon or newline, uppercased and truncated.
 */
function extractTaskName(prompt: string): string {
  const firstLine = prompt.split('\n')[0];
  const beforeColon = firstLine.split(':')[0];
  // Take first ~60 chars of the prefix
  return beforeColon.trim().slice(0, 60);
}

/**
 * Ensure the "Alerts" sheet tab exists with headers.
 */
async function ensureSheetExists(): Promise<void> {
  if (sheetEnsured) return;

  const sheets = getSheets();

  try {
    // Check if the tab already exists
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SHEETS_SPREADSHEET_ID,
    });

    const existingSheets = spreadsheet.data.sheets || [];
    const hasTab = existingSheets.some(
      (s: any) => s.properties?.title === SHEET_TAB_NAME,
    );

    if (!hasTab) {
      // Create the tab
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEETS_SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title: SHEET_TAB_NAME },
              },
            },
          ],
        },
      });

      // Write header row
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEETS_SPREADSHEET_ID,
        range: `${SHEET_TAB_NAME}!A1:G1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [HEADERS],
        },
      });

      logger.info('Created Alerts sheet tab with headers');
    }

    sheetEnsured = true;
  } catch (err) {
    logger.error({ err }, 'Failed to ensure Alerts sheet exists');
    throw err;
  }
}

/**
 * Flush buffered rows to the sheet.
 */
async function flushBuffer(): Promise<void> {
  if (buffer.length === 0) return;

  const rows = buffer.splice(0);

  try {
    await ensureSheetExists();

    const sheets = getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEETS_SPREADSHEET_ID,
      range: `${SHEET_TAB_NAME}!A:G`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: rows,
      },
    });

    logger.debug(
      { rowCount: rows.length },
      'Flushed alert rows to Google Sheets',
    );
  } catch (err) {
    logger.error(
      { err, rowCount: rows.length },
      'Failed to flush alert rows to Sheets',
    );
    // Don't re-queue — rows are lost on error to avoid infinite retries
  }
}

/**
 * Start the periodic flush timer.
 */
function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushBuffer().catch(() => {});
  }, FLUSH_INTERVAL_MS);
  // Don't keep the process alive just for this timer
  flushTimer.unref();
}

/**
 * Log an alert to Google Sheets. Fire-and-forget — never throws.
 */
export async function logAlertToSheet(
  taskId: string,
  taskPrompt: string,
  chatJid: string,
  message: string,
  suppressed: boolean,
): Promise<void> {
  const row = [
    new Date().toISOString(),
    taskId,
    extractTaskName(taskPrompt),
    chatJid,
    extractSeverity(message),
    message.slice(0, MAX_MESSAGE_LENGTH),
    suppressed ? 'TRUE' : 'FALSE',
  ];

  buffer.push(row);
  ensureFlushTimer();

  // Flush immediately if batch is full
  if (buffer.length >= MAX_BATCH_SIZE) {
    await flushBuffer();
  }
}

/**
 * Flush pending rows (call on shutdown).
 */
export async function flushSheetLogs(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushBuffer();
}
