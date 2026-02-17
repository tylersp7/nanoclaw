export interface AdditionalMount {
  hostPath: string; // Absolute path on host (supports ~ for home)
  containerPath?: string; // Optional — defaults to basename of hostPath. Mounted at /workspace/extra/{value}
  readonly?: boolean; // Default: true for safety
}

/**
 * Mount Allowlist - Security configuration for additional mounts
 * This file should be stored at ~/.config/nanoclaw/mount-allowlist.json
 * and is NOT mounted into any container, making it tamper-proof from agents.
 */
export interface MountAllowlist {
  // Directories that can be mounted into containers
  allowedRoots: AllowedRoot[];
  // Glob patterns for paths that should never be mounted (e.g., ".ssh", ".gnupg")
  blockedPatterns: string[];
  // If true, non-main groups can only mount read-only regardless of config
  nonMainReadOnly: boolean;
}

export interface AllowedRoot {
  // Absolute path or ~ for home (e.g., "~/projects", "/var/repos")
  path: string;
  // Whether read-write mounts are allowed under this root
  allowReadWrite: boolean;
  // Optional description for documentation
  description?: string;
}

export interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number; // Default: 300000 (5 minutes)
}

export interface RegisteredGroup {
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  containerConfig?: ContainerConfig;
  requiresTrigger?: boolean; // Default: true for groups, false for solo chats
}

export interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
  is_bot_message?: boolean;
  media_path?: string;
}

export interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated';
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed';
  created_at: string;
  pipeline_steps?: string | null;  // JSON string of PipelineStep[]
  pipeline_state?: string | null;  // JSON string of PipelineState
}

// Pipeline step definition (stored as JSON in scheduled_tasks.pipeline_steps)
export interface PipelineStep {
  name: string;
  prompt: string;
  skipIf?: string;        // Expression evaluated against prior output
  timeout?: number;       // Override CONTAINER_TIMEOUT for this step
  context_mode?: 'group' | 'isolated';
  parallel_group?: string; // Steps with same parallel_group run concurrently
}

// Pipeline execution state (stored as JSON in scheduled_tasks.pipeline_state)
export interface PipelineState {
  run_id: string;
  current_step: number;
  completed_steps: number[];
  step_outputs: Record<number, string>;  // step index → output text
  started_at: string;
  status: 'running' | 'completed' | 'error' | 'paused';
  error?: string;
}

// Follow-up signal types
export type FollowUpSignal = 'LEAD_FOUND' | 'ACTION_NEEDED' | 'AUTO_REMEDIATE' | 'ESCALATE';

// Follow-up action definition
export interface FollowUpAction {
  signal: FollowUpSignal;
  pattern: RegExp;
  buildPrompt: (match: RegExpMatchArray, fullOutput: string) => string;
}

// Pipeline run log entry
export interface PipelineRunLogEntry {
  task_id: string;
  run_id: string;
  step_index: number;
  step_name: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  status: 'running' | 'success' | 'error' | 'skipped';
  input_summary?: string;
  output_summary?: string;
  error?: string;
}

// Follow-up queue entry
export interface FollowUpEntry {
  id?: number;
  source_task_id?: string;
  group_folder: string;
  chat_jid: string;
  signal: string;
  prompt: string;
  context?: string;
  status?: string;
  created_at: string;
  processed_at?: string;
}

export interface TaskRunLog {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}

// --- Channel abstraction ---

export interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
  // Optional: typing indicator. Channels that support it implement it.
  setTyping?(jid: string, isTyping: boolean): Promise<void>;
}

// Callback type that channels use to deliver inbound messages
export type OnInboundMessage = (chatJid: string, message: NewMessage) => void;

// Callback for chat metadata discovery.
// name is optional — channels that deliver names inline (Telegram) pass it here;
// channels that sync names separately (WhatsApp syncGroupMetadata) omit it.
export type OnChatMetadata = (chatJid: string, timestamp: string, name?: string) => void;
