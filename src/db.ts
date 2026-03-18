import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { ASSISTANT_NAME, DATA_DIR, STORE_DIR } from './config.js';
import { isValidGroupFolder } from './group-folder.js';
import { logger } from './logger.js';
import {
  FollowUpEntry,
  MessageDestination,
  NewMessage,
  PipelineRunLogEntry,
  PipelineState,
  RegisteredGroup,
  ScheduledTask,
  TaskRunLog,
} from './types.js';

let db: Database.Database;

function createSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_message_time TEXT,
      channel TEXT,
      is_group INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,
      chat_jid TEXT,
      sender TEXT,
      sender_name TEXT,
      content TEXT,
      timestamp TEXT,
      is_from_me INTEGER,
      is_bot_message INTEGER DEFAULT 0,
      PRIMARY KEY (id, chat_jid),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);

    CREATE TABLE IF NOT EXISTS task_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);

    CREATE TABLE IF NOT EXISTS router_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      group_folder TEXT PRIMARY KEY,
      session_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registered_groups (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder TEXT NOT NULL UNIQUE,
      trigger_pattern TEXT NOT NULL,
      added_at TEXT NOT NULL,
      container_config TEXT,
      requires_trigger INTEGER DEFAULT 1
    );
  `);

  // Add context_mode column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE scheduled_tasks ADD COLUMN context_mode TEXT DEFAULT 'isolated'`,
    );
  } catch {
    /* column already exists */
  }

  // Add is_bot_message column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE messages ADD COLUMN is_bot_message INTEGER DEFAULT 0`,
    );
    // Backfill: mark existing bot messages that used the content prefix pattern
    database
      .prepare(`UPDATE messages SET is_bot_message = 1 WHERE content LIKE ?`)
      .run(`${ASSISTANT_NAME}:%`);
  } catch {
    /* column already exists */
  }

  // Add media_path column to messages (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE messages ADD COLUMN media_path TEXT DEFAULT NULL`,
    );
  } catch {
    /* column already exists */
  }

  // Add is_main column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE registered_groups ADD COLUMN is_main INTEGER DEFAULT 0`,
    );
    // Backfill: existing rows with folder = 'main' are the main group
    database.exec(
      `UPDATE registered_groups SET is_main = 1 WHERE folder = 'main'`,
    );
  } catch {
    /* column already exists */
  }

  // Add pipeline columns to scheduled_tasks (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE scheduled_tasks ADD COLUMN pipeline_steps TEXT DEFAULT NULL`,
    );
  } catch {
    /* column already exists */
  }
  try {
    database.exec(
      `ALTER TABLE scheduled_tasks ADD COLUMN pipeline_state TEXT DEFAULT NULL`,
    );
  } catch {
    /* column already exists */
  }

  // Add task_category column for queue sharding (parallel task execution)
  try {
    database.exec(
      `ALTER TABLE scheduled_tasks ADD COLUMN task_category TEXT DEFAULT NULL`,
    );
  } catch {
    /* column already exists */
  }

  // Pipeline run logs
  database.exec(`
    CREATE TABLE IF NOT EXISTS pipeline_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      step_name TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,
      status TEXT NOT NULL,
      input_summary TEXT,
      output_summary TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_pipeline_run_logs ON pipeline_run_logs(task_id, run_id);
  `);

  // Follow-up queue
  database.exec(`
    CREATE TABLE IF NOT EXISTS follow_up_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_task_id TEXT,
      group_folder TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      signal TEXT NOT NULL,
      prompt TEXT NOT NULL,
      context TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL,
      processed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_follow_up_status ON follow_up_queue(status);
  `);

  // Notification dedup: prevent duplicate messages from scheduled tasks
  database.exec(`
    CREATE TABLE IF NOT EXISTS notification_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_hash TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      source TEXT,
      sent_at TEXT NOT NULL,
      suppressed INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_notif_hash ON notification_log(content_hash, chat_jid, sent_at);
  `);

  // Conversation FTS5 full-text search
  database.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS conversation_fts USING fts5(
      group_folder,
      filename,
      title,
      content,
      archived_at,
      tokenize='porter unicode61'
    );

    CREATE TABLE IF NOT EXISTS conversation_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_folder TEXT NOT NULL,
      filename TEXT NOT NULL,
      title TEXT,
      archived_at TEXT,
      file_size INTEGER,
      indexed_at TEXT NOT NULL,
      UNIQUE(group_folder, filename)
    );
  `);

  // Cost events tracking (API token usage per container run)
  database.exec(`
    CREATE TABLE IF NOT EXISTS cost_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_folder TEXT NOT NULL,
      source TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      request_count INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      task_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cost_events_date ON cost_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_cost_events_group ON cost_events(group_folder, created_at);
  `);

  // HubSpot sync tracking
  database.exec(`
    CREATE TABLE IF NOT EXISTS hubspot_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      hubspot_contact_id TEXT,
      hubspot_deal_id TEXT,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_hubspot_sync ON hubspot_sync_log(lead_id, synced_at);
  `);

  // Add channel and is_group columns if they don't exist (migration for existing DBs)
  try {
    database.exec(`ALTER TABLE chats ADD COLUMN channel TEXT`);
    database.exec(`ALTER TABLE chats ADD COLUMN is_group INTEGER DEFAULT 0`);
    // Backfill from JID patterns
    database.exec(
      `UPDATE chats SET channel = 'whatsapp', is_group = 1 WHERE jid LIKE '%@g.us'`,
    );
    database.exec(
      `UPDATE chats SET channel = 'whatsapp', is_group = 0 WHERE jid LIKE '%@s.whatsapp.net'`,
    );
    database.exec(
      `UPDATE chats SET channel = 'discord', is_group = 1 WHERE jid LIKE 'dc:%'`,
    );
    database.exec(
      `UPDATE chats SET channel = 'telegram', is_group = 1 WHERE jid LIKE 'tg:%'`,
    );
  } catch {
    /* columns already exist */
  }

  // Add destinations column to registered_groups (named routing)
  try {
    database.exec(
      `ALTER TABLE registered_groups ADD COLUMN destinations TEXT DEFAULT NULL`,
    );
  } catch {
    /* column already exists */
  }
}

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  createSchema(db);

  // Migrate from JSON files if they exist
  migrateJsonState();
}

/** @internal - for tests only. Creates a fresh in-memory database. */
export function _initTestDatabase(): void {
  db = new Database(':memory:');
  createSchema(db);
}

/**
 * Store chat metadata only (no message content).
 * Used for all chats to enable group discovery without storing sensitive content.
 */
export function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
): void {
  const ch = channel ?? null;
  const group = isGroup === undefined ? null : isGroup ? 1 : 0;

  if (name) {
    // Update with name, preserving existing timestamp if newer
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        name = excluded.name,
        last_message_time = MAX(last_message_time, excluded.last_message_time),
        channel = COALESCE(excluded.channel, channel),
        is_group = COALESCE(excluded.is_group, is_group)
    `,
    ).run(chatJid, name, timestamp, ch, group);
  } else {
    // Update timestamp only, preserve existing name if any
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        last_message_time = MAX(last_message_time, excluded.last_message_time),
        channel = COALESCE(excluded.channel, channel),
        is_group = COALESCE(excluded.is_group, is_group)
    `,
    ).run(chatJid, chatJid, timestamp, ch, group);
  }
}

/**
 * Update chat name without changing timestamp for existing chats.
 * New chats get the current time as their initial timestamp.
 * Used during group metadata sync.
 */
export function updateChatName(chatJid: string, name: string): void {
  db.prepare(
    `
    INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET name = excluded.name
  `,
  ).run(chatJid, name, new Date().toISOString());
}

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
  channel: string | null;
  is_group: number;
}

/**
 * Get all known chats, ordered by most recent activity.
 */
export function getAllChats(): ChatInfo[] {
  return db
    .prepare(
      `
    SELECT jid, name, last_message_time, channel, is_group
    FROM chats
    ORDER BY last_message_time DESC
  `,
    )
    .all() as ChatInfo[];
}

/**
 * Get timestamp of last group metadata sync.
 */
export function getLastGroupSync(): string | null {
  // Store sync time in a special chat entry
  const row = db
    .prepare(`SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`)
    .get() as { last_message_time: string } | undefined;
  return row?.last_message_time || null;
}

/**
 * Record that group metadata was synced.
 */
export function setLastGroupSync(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES ('__group_sync__', '__group_sync__', ?)`,
  ).run(now);
}

/**
 * Store a message with full content.
 * Only call this for registered groups where message history is needed.
 */
export function storeMessage(msg: NewMessage): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message, media_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.chat_jid,
    msg.sender,
    msg.sender_name,
    msg.content,
    msg.timestamp,
    msg.is_from_me ? 1 : 0,
    msg.is_bot_message ? 1 : 0,
    msg.media_path || null,
  );
}

/**
 * Store a message directly.
 */
export function storeMessageDirect(msg: {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  is_bot_message?: boolean;
}): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.chat_jid,
    msg.sender,
    msg.sender_name,
    msg.content,
    msg.timestamp,
    msg.is_from_me ? 1 : 0,
    msg.is_bot_message ? 1 : 0,
  );
}

export function getNewMessages(
  jids: string[],
  lastTimestamp: string,
  botPrefix: string,
  limit: number = 200,
): { messages: NewMessage[]; newTimestamp: string } {
  if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

  const placeholders = jids.map(() => '?').join(',');
  // Filter bot messages using both the is_bot_message flag AND the content
  // prefix as a backstop for messages written before the migration ran.
  // Subquery takes the N most recent, outer query re-sorts chronologically.
  const sql = `
    SELECT * FROM (
      SELECT id, chat_jid, sender, sender_name, content, timestamp, media_path, is_from_me
      FROM messages
      WHERE timestamp > ? AND chat_jid IN (${placeholders})
        AND is_bot_message = 0 AND content NOT LIKE ?
        AND content != '' AND content IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT ?
    ) ORDER BY timestamp
  `;

  const rows = db
    .prepare(sql)
    .all(lastTimestamp, ...jids, `${botPrefix}:%`, limit) as NewMessage[];

  let newTimestamp = lastTimestamp;
  for (const row of rows) {
    if (row.timestamp > newTimestamp) newTimestamp = row.timestamp;
  }

  return { messages: rows, newTimestamp };
}

export function getMessagesSince(
  chatJid: string,
  sinceTimestamp: string,
  botPrefix: string,
  limit: number = 200,
): NewMessage[] {
  // Filter bot messages using both the is_bot_message flag AND the content
  // prefix as a backstop for messages written before the migration ran.
  // Subquery takes the N most recent, outer query re-sorts chronologically.
  const sql = `
    SELECT * FROM (
      SELECT id, chat_jid, sender, sender_name, content, timestamp, media_path, is_from_me
      FROM messages
      WHERE chat_jid = ? AND timestamp > ?
        AND is_bot_message = 0 AND content NOT LIKE ?
        AND content != '' AND content IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT ?
    ) ORDER BY timestamp
  `;
  return db
    .prepare(sql)
    .all(chatJid, sinceTimestamp, `${botPrefix}:%`, limit) as NewMessage[];
}

export function createTask(
  task: Omit<ScheduledTask, 'last_run' | 'last_result'>,
): void {
  db.prepare(
    `
    INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at, pipeline_steps)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.group_folder,
    task.chat_jid,
    task.prompt,
    task.schedule_type,
    task.schedule_value,
    task.context_mode || 'isolated',
    task.next_run,
    task.status,
    task.created_at,
    task.pipeline_steps || null,
  );
}

export function getTaskById(id: string): ScheduledTask | undefined {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
    | ScheduledTask
    | undefined;
}

export function getTasksForGroup(groupFolder: string): ScheduledTask[] {
  return db
    .prepare(
      'SELECT * FROM scheduled_tasks WHERE group_folder = ? ORDER BY created_at DESC',
    )
    .all(groupFolder) as ScheduledTask[];
}

export function getAllTasks(): ScheduledTask[] {
  return db
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    .all() as ScheduledTask[];
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<
      ScheduledTask,
      'prompt' | 'schedule_type' | 'schedule_value' | 'next_run' | 'status'
    >
  >,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.prompt !== undefined) {
    fields.push('prompt = ?');
    values.push(updates.prompt);
  }
  if (updates.schedule_type !== undefined) {
    fields.push('schedule_type = ?');
    values.push(updates.schedule_type);
  }
  if (updates.schedule_value !== undefined) {
    fields.push('schedule_value = ?');
    values.push(updates.schedule_value);
  }
  if (updates.next_run !== undefined) {
    fields.push('next_run = ?');
    values.push(updates.next_run);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(
    `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`,
  ).run(...values);
}

export function deleteTask(id: string): void {
  // Delete child records first (FK constraint)
  db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}

export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();
  return db
    .prepare(
      `
    SELECT * FROM scheduled_tasks
    WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
    ORDER BY next_run
  `,
    )
    .all(now) as ScheduledTask[];
}

export function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  lastResult: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE scheduled_tasks
    SET next_run = ?, last_run = ?, last_result = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
    WHERE id = ?
  `,
  ).run(nextRun, now, lastResult, nextRun, id);
}

export function logTaskRun(log: TaskRunLog): void {
  db.prepare(
    `
    INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
    log.task_id,
    log.run_at,
    log.duration_ms,
    log.status,
    log.result,
    log.error,
  );
}

// --- Router state accessors ---

export function getRouterState(key: string): string | undefined {
  const row = db
    .prepare('SELECT value FROM router_state WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setRouterState(key: string, value: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)',
  ).run(key, value);
}

// --- Session accessors ---

export function getSession(groupFolder: string): string | undefined {
  const row = db
    .prepare('SELECT session_id FROM sessions WHERE group_folder = ?')
    .get(groupFolder) as { session_id: string } | undefined;
  return row?.session_id;
}

export function setSession(groupFolder: string, sessionId: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO sessions (group_folder, session_id) VALUES (?, ?)',
  ).run(groupFolder, sessionId);
}

export function getAllSessions(): Record<string, string> {
  const rows = db
    .prepare('SELECT group_folder, session_id FROM sessions')
    .all() as Array<{ group_folder: string; session_id: string }>;
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.group_folder] = row.session_id;
  }
  return result;
}

// --- Registered group accessors ---

export function getRegisteredGroup(
  jid: string,
): (RegisteredGroup & { jid: string }) | undefined {
  const row = db
    .prepare('SELECT * FROM registered_groups WHERE jid = ?')
    .get(jid) as
    | {
        jid: string;
        name: string;
        folder: string;
        trigger_pattern: string;
        added_at: string;
        container_config: string | null;
        requires_trigger: number | null;
        destinations: string | null;
        is_main: number | null;
      }
    | undefined;
  if (!row) return undefined;
  if (!isValidGroupFolder(row.folder)) {
    logger.warn(
      { jid: row.jid, folder: row.folder },
      'Skipping registered group with invalid folder',
    );
    return undefined;
  }
  return {
    jid: row.jid,
    name: row.name,
    folder: row.folder,
    trigger: row.trigger_pattern,
    added_at: row.added_at,
    containerConfig: row.container_config
      ? JSON.parse(row.container_config)
      : undefined,
    requiresTrigger:
      row.requires_trigger === null ? undefined : row.requires_trigger === 1,
    destinations: row.destinations ? JSON.parse(row.destinations) : undefined,
    isMain: row.is_main === 1 ? true : undefined,
  };
}

export function setRegisteredGroup(jid: string, group: RegisteredGroup): void {
  if (!isValidGroupFolder(group.folder)) {
    throw new Error(`Invalid group folder "${group.folder}" for JID ${jid}`);
  }
  db.prepare(
    `INSERT OR REPLACE INTO registered_groups (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger, destinations, is_main)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jid,
    group.name,
    group.folder,
    group.trigger,
    group.added_at,
    group.containerConfig ? JSON.stringify(group.containerConfig) : null,
    group.requiresTrigger === undefined ? 1 : group.requiresTrigger ? 1 : 0,
    group.destinations ? JSON.stringify(group.destinations) : null,
    group.isMain ? 1 : 0,
  );
}

export function getAllRegisteredGroups(): Record<string, RegisteredGroup> {
  const rows = db.prepare('SELECT * FROM registered_groups').all() as Array<{
    jid: string;
    name: string;
    folder: string;
    trigger_pattern: string;
    added_at: string;
    container_config: string | null;
    requires_trigger: number | null;
    destinations: string | null;
    is_main: number | null;
  }>;
  const result: Record<string, RegisteredGroup> = {};
  for (const row of rows) {
    if (!isValidGroupFolder(row.folder)) {
      logger.warn(
        { jid: row.jid, folder: row.folder },
        'Skipping registered group with invalid folder',
      );
      continue;
    }
    result[row.jid] = {
      name: row.name,
      folder: row.folder,
      trigger: row.trigger_pattern,
      added_at: row.added_at,
      containerConfig: row.container_config
        ? JSON.parse(row.container_config)
        : undefined,
      requiresTrigger:
        row.requires_trigger === null ? undefined : row.requires_trigger === 1,
      destinations: row.destinations ? JSON.parse(row.destinations) : undefined,
      isMain: row.is_main === 1 ? true : undefined,
    };
  }
  return result;
}

// --- Pipeline state ---

export function updatePipelineState(
  taskId: string,
  state: PipelineState,
): void {
  db.prepare(`UPDATE scheduled_tasks SET pipeline_state = ? WHERE id = ?`).run(
    JSON.stringify(state),
    taskId,
  );
}

export function getPipelineState(taskId: string): PipelineState | null {
  const row = db
    .prepare(`SELECT pipeline_state FROM scheduled_tasks WHERE id = ?`)
    .get(taskId) as { pipeline_state: string | null } | undefined;
  if (!row?.pipeline_state) return null;
  return JSON.parse(row.pipeline_state);
}

export function logPipelineStep(entry: PipelineRunLogEntry): void {
  db.prepare(
    `INSERT INTO pipeline_run_logs (task_id, run_id, step_index, step_name, started_at, completed_at, duration_ms, status, input_summary, output_summary, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.task_id,
    entry.run_id,
    entry.step_index,
    entry.step_name,
    entry.started_at,
    entry.completed_at || null,
    entry.duration_ms || null,
    entry.status,
    entry.input_summary || null,
    entry.output_summary || null,
    entry.error || null,
  );
}

// --- Follow-up queue ---

export function queueFollowUp(entry: FollowUpEntry): void {
  db.prepare(
    `INSERT INTO follow_up_queue (source_task_id, group_folder, chat_jid, signal, prompt, context, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(
    entry.source_task_id || null,
    entry.group_folder,
    entry.chat_jid,
    entry.signal,
    entry.prompt,
    entry.context || null,
    entry.created_at,
  );
}

export function getPendingFollowUps(): FollowUpEntry[] {
  return db
    .prepare(
      `SELECT * FROM follow_up_queue WHERE status = 'pending' ORDER BY created_at`,
    )
    .all() as FollowUpEntry[];
}

export function markFollowUpProcessing(id: number): void {
  db.prepare(
    `UPDATE follow_up_queue SET status = 'processing' WHERE id = ?`,
  ).run(id);
}

export function markFollowUpCompleted(id: number): void {
  db.prepare(
    `UPDATE follow_up_queue SET status = 'completed', processed_at = ? WHERE id = ?`,
  ).run(new Date().toISOString(), id);
}

export function markFollowUpError(id: number, error: string): void {
  db.prepare(
    `UPDATE follow_up_queue SET status = 'error', processed_at = ?, context = COALESCE(context, '') || ? WHERE id = ?`,
  ).run(new Date().toISOString(), `\nError: ${error}`, id);
}

// --- Notification dedup ---

import crypto from 'crypto';

/**
 * Check if a message is a duplicate (sent recently with same content hash)
 * Returns true if the message should be suppressed
 */
export function isNotificationDuplicate(
  chatJid: string,
  content: string,
  windowMinutes: number = 360, // 6 hour dedup window
  taskId?: string,
): boolean {
  // Normalize: strip timestamps, whitespace variations, emojis for dedup
  const normalized = content
    .replace(/\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?/gi, '') // strip times
    .replace(/\d{4}-\d{2}-\d{2}/g, '') // strip dates
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 500); // only hash first 500 chars for efficiency

  const hash = crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex')
    .substring(0, 16);

  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  // Global dedup: same content hash to same chat within window
  const existing = db
    .prepare(
      `
    SELECT id FROM notification_log
    WHERE content_hash = ? AND chat_jid = ? AND sent_at > ? AND suppressed = 0
    LIMIT 1
  `,
    )
    .get(hash, chatJid, cutoff);

  if (existing) return true;

  // Task-level dedup: same task sent same content hash within window (catches slight variations)
  if (taskId) {
    const taskDup = db
      .prepare(
        `
      SELECT id FROM notification_log
      WHERE content_hash = ? AND source = ? AND sent_at > ? AND suppressed = 0
      LIMIT 1
    `,
      )
      .get(hash, taskId, cutoff);
    if (taskDup) return true;
  }

  return false;
}

/**
 * Log a notification that was sent (or suppressed)
 */
export function logNotification(
  chatJid: string,
  content: string,
  source?: string,
  suppressed: boolean = false,
): void {
  const normalized = content
    .replace(/\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?/gi, '')
    .replace(/\d{4}-\d{2}-\d{2}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 500);

  const hash = crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex')
    .substring(0, 16);

  db.prepare(
    `
    INSERT INTO notification_log (content_hash, chat_jid, source, sent_at, suppressed)
    VALUES (?, ?, ?, ?, ?)
  `,
  ).run(
    hash,
    chatJid,
    source || null,
    new Date().toISOString(),
    suppressed ? 1 : 0,
  );

  // Cleanup old entries (older than 7 days)
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`DELETE FROM notification_log WHERE sent_at < ?`).run(weekAgo);
}

/**
 * Get notification stats for monitoring
 */
export function getNotificationStats(hours: number = 24): {
  total: number;
  sent: number;
  suppressed: number;
} {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const row = db
    .prepare(
      `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN suppressed = 0 THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN suppressed = 1 THEN 1 ELSE 0 END) as suppressed
    FROM notification_log WHERE sent_at > ?
  `,
    )
    .get(cutoff) as { total: number; sent: number; suppressed: number };

  return row || { total: 0, sent: 0, suppressed: 0 };
}

// --- HubSpot sync log ---

export function logHubSpotSync(entry: {
  lead_id: string;
  hubspot_contact_id?: string;
  hubspot_deal_id?: string;
  action: string;
  status: string;
  error?: string;
}): void {
  db.prepare(
    `
    INSERT INTO hubspot_sync_log (lead_id, hubspot_contact_id, hubspot_deal_id, action, status, synced_at, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    entry.lead_id,
    entry.hubspot_contact_id || null,
    entry.hubspot_deal_id || null,
    entry.action,
    entry.status,
    new Date().toISOString(),
    entry.error || null,
  );
}

export function getHubSpotSyncStats(): {
  totalSynced: number;
  totalErrors: number;
  lastSync: string | null;
  byAction: Record<string, number>;
} {
  const total = db
    .prepare(
      `
    SELECT
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as synced,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
    FROM hubspot_sync_log
  `,
    )
    .get() as { synced: number; errors: number } | undefined;

  const lastRow = db
    .prepare(
      `
    SELECT synced_at FROM hubspot_sync_log WHERE status = 'success' ORDER BY synced_at DESC LIMIT 1
  `,
    )
    .get() as { synced_at: string } | undefined;

  const actionRows = db
    .prepare(
      `
    SELECT action, COUNT(*) as count FROM hubspot_sync_log WHERE status = 'success' GROUP BY action
  `,
    )
    .all() as Array<{ action: string; count: number }>;

  const byAction: Record<string, number> = {};
  for (const row of actionRows) {
    byAction[row.action] = row.count;
  }

  return {
    totalSynced: total?.synced || 0,
    totalErrors: total?.errors || 0,
    lastSync: lastRow?.synced_at || null,
    byAction,
  };
}

export function getUnsyncedLeads(): Array<{ lead_id: string }> {
  // Returns lead IDs that have never been successfully synced
  return db
    .prepare(
      `
    SELECT DISTINCT lead_id FROM hubspot_sync_log
    WHERE status = 'error'
      AND lead_id NOT IN (
        SELECT lead_id FROM hubspot_sync_log WHERE status = 'success'
      )
  `,
    )
    .all() as Array<{ lead_id: string }>;
}

// --- Cost tracking ---

export interface CostEvent {
  id?: number;
  group_folder: string;
  source: string; // 'interactive' | 'scheduled_task' | 'pipeline_step' | 'follow_up'
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  request_count: number;
  cost_usd: number;
  duration_ms?: number;
  task_id?: string;
  created_at?: string;
}

export function logCostEvent(
  event: Omit<CostEvent, 'id' | 'created_at'>,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO cost_events (group_folder, source, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, request_count, cost_usd, duration_ms, task_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.group_folder,
    event.source,
    event.input_tokens,
    event.output_tokens,
    event.cache_creation_tokens,
    event.cache_read_tokens,
    event.request_count,
    event.cost_usd,
    event.duration_ms || null,
    event.task_id || null,
    now,
  );
}

export function getCostSummary(): {
  dailyCostUsd: number;
  monthlyCostUsd: number;
  dailyRequests: number;
  monthlyRequests: number;
  topGroups: Array<{ group_folder: string; cost_usd: number }>;
} {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const monthStart = today.slice(0, 7) + '-01'; // YYYY-MM-01

  const daily = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) as cost, COALESCE(SUM(request_count), 0) as reqs
       FROM cost_events WHERE created_at >= ?`,
    )
    .get(today + 'T00:00:00.000Z') as { cost: number; reqs: number };

  const monthly = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) as cost, COALESCE(SUM(request_count), 0) as reqs
       FROM cost_events WHERE created_at >= ?`,
    )
    .get(monthStart + 'T00:00:00.000Z') as { cost: number; reqs: number };

  const topGroups = db
    .prepare(
      `SELECT group_folder, SUM(cost_usd) as cost_usd
       FROM cost_events WHERE created_at >= ?
       GROUP BY group_folder ORDER BY cost_usd DESC LIMIT 10`,
    )
    .all(monthStart + 'T00:00:00.000Z') as Array<{
    group_folder: string;
    cost_usd: number;
  }>;

  return {
    dailyCostUsd: daily.cost,
    monthlyCostUsd: monthly.cost,
    dailyRequests: daily.reqs,
    monthlyRequests: monthly.reqs,
    topGroups,
  };
}

export function getCostHistory(days: number = 30): Array<{
  date: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  request_count: number;
}> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  return db
    .prepare(
      `SELECT
         substr(created_at, 1, 10) as date,
         SUM(cost_usd) as cost_usd,
         SUM(input_tokens) as input_tokens,
         SUM(output_tokens) as output_tokens,
         SUM(request_count) as request_count
       FROM cost_events
       WHERE created_at >= ?
       GROUP BY date
       ORDER BY date`,
    )
    .all(since) as Array<{
    date: string;
    cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    request_count: number;
  }>;
}

// --- Conversation FTS5 search ---

export interface ConversationSearchResult {
  group_folder: string;
  filename: string;
  title: string;
  archived_at: string;
  snippet: string;
  rank: number;
}

export interface ConversationIndexStats {
  group_folder: string;
  count: number;
}

/**
 * Index a conversation into both the FTS5 table and the tracking table.
 * Uses delete-then-insert to handle updates (FTS5 doesn't support UPDATE).
 */
export function indexConversation(
  groupFolder: string,
  filename: string,
  title: string,
  content: string,
  archivedAt: string,
  fileSize: number,
): void {
  const now = new Date().toISOString();

  // Remove existing FTS entry if present (FTS5 requires delete + insert for updates)
  const existing = db
    .prepare(
      `SELECT rowid FROM conversation_fts WHERE group_folder = ? AND filename = ?`,
    )
    .get(groupFolder, filename) as { rowid: number } | undefined;

  if (existing) {
    db.prepare(`DELETE FROM conversation_fts WHERE rowid = ?`).run(
      existing.rowid,
    );
  }

  db.prepare(
    `INSERT INTO conversation_fts (group_folder, filename, title, content, archived_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(groupFolder, filename, title, content, archivedAt);

  db.prepare(
    `INSERT INTO conversation_index (group_folder, filename, title, archived_at, file_size, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(group_folder, filename) DO UPDATE SET
       title = excluded.title,
       archived_at = excluded.archived_at,
       file_size = excluded.file_size,
       indexed_at = excluded.indexed_at`,
  ).run(groupFolder, filename, title, archivedAt, fileSize, now);
}

/**
 * Search conversations using FTS5 full-text search.
 * Returns ranked results with highlighted snippets.
 */
export function searchConversations(
  query: string,
  groupFolder?: string,
  limit: number = 10,
): ConversationSearchResult[] {
  // Sanitize limit
  const safeLimit = Math.max(1, Math.min(limit, 50));

  if (groupFolder) {
    return db
      .prepare(
        `SELECT
          group_folder,
          filename,
          title,
          archived_at,
          snippet(conversation_fts, 3, '<mark>', '</mark>', '...', 40) as snippet,
          rank
        FROM conversation_fts
        WHERE conversation_fts MATCH ? AND group_folder = ?
        ORDER BY rank
        LIMIT ?`,
      )
      .all(query, groupFolder, safeLimit) as ConversationSearchResult[];
  }

  return db
    .prepare(
      `SELECT
        group_folder,
        filename,
        title,
        archived_at,
        snippet(conversation_fts, 3, '<mark>', '</mark>', '...', 40) as snippet,
        rank
      FROM conversation_fts
      WHERE conversation_fts MATCH ?
      ORDER BY rank
      LIMIT ?`,
    )
    .all(query, safeLimit) as ConversationSearchResult[];
}

/**
 * Get conversation index stats per group.
 */
export function getConversationIndexStats(): ConversationIndexStats[] {
  return db
    .prepare(
      `SELECT group_folder, COUNT(*) as count
       FROM conversation_index
       GROUP BY group_folder
       ORDER BY count DESC`,
    )
    .all() as ConversationIndexStats[];
}

/**
 * Check if a conversation is already indexed with the same file size.
 * Returns true if the file is indexed and unchanged.
 */
export function isConversationIndexed(
  groupFolder: string,
  filename: string,
  fileSize: number,
): boolean {
  const row = db
    .prepare(
      `SELECT file_size FROM conversation_index WHERE group_folder = ? AND filename = ?`,
    )
    .get(groupFolder, filename) as { file_size: number } | undefined;
  return row !== undefined && row.file_size === fileSize;
}

/** Expose the raw database handle for modules that manage their own tables. */
export function getDb(): Database.Database {
  return db;
}

// --- JSON migration ---

function migrateJsonState(): void {
  const migrateFile = (filename: string) => {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      fs.renameSync(filePath, `${filePath}.migrated`);
      return data;
    } catch {
      return null;
    }
  };

  // Migrate router_state.json
  const routerState = migrateFile('router_state.json') as {
    last_timestamp?: string;
    last_agent_timestamp?: Record<string, string>;
  } | null;
  if (routerState) {
    if (routerState.last_timestamp) {
      setRouterState('last_timestamp', routerState.last_timestamp);
    }
    if (routerState.last_agent_timestamp) {
      setRouterState(
        'last_agent_timestamp',
        JSON.stringify(routerState.last_agent_timestamp),
      );
    }
  }

  // Migrate sessions.json
  const sessions = migrateFile('sessions.json') as Record<
    string,
    string
  > | null;
  if (sessions) {
    for (const [folder, sessionId] of Object.entries(sessions)) {
      setSession(folder, sessionId);
    }
  }

  // Migrate registered_groups.json
  const groups = migrateFile('registered_groups.json') as Record<
    string,
    RegisteredGroup
  > | null;
  if (groups) {
    for (const [jid, group] of Object.entries(groups)) {
      try {
        setRegisteredGroup(jid, group);
      } catch (err) {
        logger.warn(
          { jid, folder: group.folder, err },
          'Skipping migrated registered group with invalid folder',
        );
      }
    }
  }
}
