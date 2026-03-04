/**
 * Google Calendar tools for NanoClaw MCP server.
 * Uses direct REST API calls with mounted OAuth credentials.
 * No external dependencies — uses Node's built-in https module.
 */
import fs from 'fs';
import https from 'https';
import path from 'path';

const CRED_DIR = '/home/node/.nanoclaw-calendar';
const CREDENTIALS_PATH = path.join(CRED_DIR, 'credentials.json');
const TOKEN_PATH = path.join(CRED_DIR, 'token.json');

interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
}

interface OAuthCredentials {
  client_id: string;
  client_secret: string;
}

function loadCredentials(): OAuthCredentials | null {
  if (!fs.existsSync(CREDENTIALS_PATH)) return null;
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  const cred = raw.installed || raw.web;
  return { client_id: cred.client_id, client_secret: cred.client_secret };
}

function loadTokens(): OAuthTokens | null {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
}

function saveTokens(tokens: OAuthTokens): void {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

async function refreshAccessToken(
  cred: OAuthCredentials,
  tokens: OAuthTokens,
): Promise<string> {
  if (!tokens.refresh_token) throw new Error('No refresh token available');

  const body = new URLSearchParams({
    client_id: cred.client_id,
    client_secret: cred.client_secret,
    refresh_token: tokens.refresh_token,
    grant_type: 'refresh_token',
  }).toString();

  const response = await httpRequest('POST', 'oauth2.googleapis.com', '/token', body, {
    'Content-Type': 'application/x-www-form-urlencoded',
  });

  const data = JSON.parse(response);
  if (data.error) throw new Error(`Token refresh failed: ${data.error}`);

  tokens.access_token = data.access_token;
  tokens.expiry_date = Date.now() + (data.expires_in || 3600) * 1000;
  saveTokens(tokens);
  return tokens.access_token;
}

async function getAccessToken(): Promise<string> {
  const cred = loadCredentials();
  const tokens = loadTokens();
  if (!cred || !tokens) throw new Error('Calendar not configured. Missing credentials or token at ~/.nanoclaw-calendar/');

  // Check if token is expired or will expire in next 5 minutes
  if (tokens.expiry_date && tokens.expiry_date < Date.now() + 5 * 60 * 1000) {
    return refreshAccessToken(cred, tokens);
  }

  return tokens.access_token;
}

function httpRequest(
  method: string,
  hostname: string,
  path: string,
  body?: string,
  headers?: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method,
        headers: {
          ...headers,
          ...(body ? { 'Content-Length': Buffer.byteLength(body).toString() } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
          } else {
            resolve(data);
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function calendarGet(endpoint: string, params?: Record<string, string>): Promise<any> {
  const token = await getAccessToken();
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const response = await httpRequest(
    'GET',
    'www.googleapis.com',
    `/calendar/v3${endpoint}${qs}`,
    undefined,
    { Authorization: `Bearer ${token}` },
  );
  return JSON.parse(response);
}

async function calendarPost(endpoint: string, body: object): Promise<any> {
  const token = await getAccessToken();
  const response = await httpRequest(
    'POST',
    'www.googleapis.com',
    `/calendar/v3${endpoint}?sendUpdates=all`,
    JSON.stringify(body),
    {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  );
  return JSON.parse(response);
}

// --- Exported tool handlers ---

export function isCalendarConfigured(): boolean {
  return fs.existsSync(CREDENTIALS_PATH) && fs.existsSync(TOKEN_PATH);
}

export async function listEvents(
  timeMin: string,
  timeMax: string,
  maxResults: number = 20,
): Promise<string> {
  const data = await calendarGet('/calendars/primary/events', {
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(maxResults),
  });

  if (!data.items || data.items.length === 0) return 'No events found.';

  return data.items
    .map((e: any) => {
      const start = e.start?.dateTime || e.start?.date || '?';
      const end = e.end?.dateTime || e.end?.date || '?';
      const attendees = e.attendees?.map((a: any) => a.email).join(', ') || '';
      return `- ${e.summary || '(no title)'}\n  ${start} → ${end}${attendees ? `\n  Attendees: ${attendees}` : ''}${e.location ? `\n  Location: ${e.location}` : ''}`;
    })
    .join('\n');
}

export async function createEvent(
  summary: string,
  startDateTime: string,
  endDateTime: string,
  description?: string,
  attendees?: string[],
  location?: string,
): Promise<string> {
  const event: any = {
    summary,
    start: { dateTime: startDateTime },
    end: { dateTime: endDateTime },
  };
  if (description) event.description = description;
  if (attendees?.length) event.attendees = attendees.map((e) => ({ email: e }));
  if (location) event.location = location;

  const result = await calendarPost('/calendars/primary/events', event);
  return `Event created: ${result.summary}\nLink: ${result.htmlLink || 'N/A'}`;
}

export async function findFreeTime(
  date: string,
  durationMinutes: number = 60,
  startHour: number = 9,
  endHour: number = 17,
): Promise<string> {
  const dayStart = new Date(`${date}T${String(startHour).padStart(2, '0')}:00:00`);
  const dayEnd = new Date(`${date}T${String(endHour).padStart(2, '0')}:00:00`);

  const data = await calendarGet('/calendars/primary/events', {
    timeMin: dayStart.toISOString(),
    timeMax: dayEnd.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
  });

  const events = (data.items || [])
    .filter((e: any) => e.start?.dateTime) // Skip all-day events
    .map((e: any) => ({
      start: new Date(e.start.dateTime).getTime(),
      end: new Date(e.end.dateTime).getTime(),
    }));

  const durationMs = durationMinutes * 60 * 1000;
  const slots: string[] = [];
  let cursor = dayStart.getTime();

  for (const event of events) {
    if (event.start - cursor >= durationMs) {
      slots.push(
        `${new Date(cursor).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} – ${new Date(cursor + durationMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
      );
    }
    cursor = Math.max(cursor, event.end);
  }

  if (dayEnd.getTime() - cursor >= durationMs) {
    slots.push(
      `${new Date(cursor).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} – ${new Date(cursor + durationMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
    );
  }

  if (slots.length === 0) return `No ${durationMinutes}-minute slots available on ${date} between ${startHour}:00–${endHour}:00.`;
  return `Available ${durationMinutes}-minute slots on ${date}:\n${slots.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
}
