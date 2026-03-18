/**
 * Agent Adapter Pattern for NanoClaw
 *
 * Abstracts agent invocation behind a pluggable adapter interface.
 * The default adapter wraps the existing container runner (Claude Code in containers).
 * Additional adapters can be added for other backends (Ollama, Codex, etc.).
 */

import { ChildProcess, execSync } from 'child_process';

import { ContainerOutput, runContainerAgent } from './container-runner.js';
import { CONTAINER_RUNTIME_BIN, stopContainer } from './container-runtime.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

// --- Adapter Interface ---

export interface AdapterInvokeOptions {
  /** The prompt/message to send to the agent */
  prompt: string;
  /** Group this invocation belongs to */
  group: RegisteredGroup;
  /** Reuse an existing session */
  sessionId?: string;
  /** Chat JID for routing responses */
  chatJid: string;
  /** Whether this is the main (elevated privilege) group */
  isMain: boolean;
  /** Whether this is a background scheduled task */
  isScheduledTask?: boolean;
  /** Assistant name for the agent */
  assistantName?: string;
}

export interface AdapterResult {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
  /** Token usage from this invocation (if tracked) */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
}

export interface AgentAdapter {
  /** Human-readable adapter name */
  readonly name: string;

  /**
   * Invoke the agent with the given options.
   * @param opts - Invocation options
   * @param onProcess - Called when the underlying process starts (for queue tracking)
   * @param onOutput - Called for each streaming output chunk
   */
  invoke(
    opts: AdapterInvokeOptions,
    onProcess: (proc: ChildProcess, containerName: string) => void,
    onOutput?: (output: ContainerOutput) => Promise<void>,
  ): Promise<AdapterResult>;

  /**
   * Cancel a running invocation by container/run name.
   * Optional — adapters that don't support cancellation omit this.
   */
  cancel?(runId: string): Promise<void>;

  /**
   * Check if this adapter is available/configured.
   * Returns false if prerequisites are missing.
   */
  isAvailable(): boolean;
}

// --- Claude Container Adapter (default) ---

/**
 * Default adapter that runs Claude Code inside containers.
 * Wraps the existing container-runner.ts logic.
 */
export class ClaudeContainerAdapter implements AgentAdapter {
  readonly name = 'claude-container';

  invoke(
    opts: AdapterInvokeOptions,
    onProcess: (proc: ChildProcess, containerName: string) => void,
    onOutput?: (output: ContainerOutput) => Promise<void>,
  ): Promise<AdapterResult> {
    return runContainerAgent(
      opts.group,
      {
        prompt: opts.prompt,
        sessionId: opts.sessionId,
        groupFolder: opts.group.folder,
        chatJid: opts.chatJid,
        isMain: opts.isMain,
        isScheduledTask: opts.isScheduledTask,
        assistantName: opts.assistantName,
      },
      onProcess,
      onOutput,
    );
  }

  cancel(containerName: string): Promise<void> {
    stopContainer(containerName);
    return Promise.resolve();
  }

  isAvailable(): boolean {
    try {
      execSync(`${CONTAINER_RUNTIME_BIN} system status`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
}

// --- Adapter Registry ---

const adapters = new Map<string, AgentAdapter>();
let defaultAdapter: AgentAdapter | null = null;

/**
 * Register an adapter. The first registered adapter becomes the default.
 */
export function registerAdapter(adapter: AgentAdapter): void {
  adapters.set(adapter.name, adapter);
  if (!defaultAdapter) {
    defaultAdapter = adapter;
  }
  logger.info({ adapter: adapter.name }, 'Agent adapter registered');
}

/**
 * Get an adapter by name, or the default adapter.
 */
export function getAdapter(name?: string): AgentAdapter {
  if (name) {
    const adapter = adapters.get(name);
    if (!adapter) {
      throw new Error(`Unknown agent adapter: ${name}`);
    }
    return adapter;
  }
  if (!defaultAdapter) {
    throw new Error('No agent adapters registered');
  }
  return defaultAdapter;
}

/**
 * Set the default adapter by name.
 */
export function setDefaultAdapter(name: string): void {
  const adapter = adapters.get(name);
  if (!adapter) {
    throw new Error(`Unknown agent adapter: ${name}`);
  }
  defaultAdapter = adapter;
  logger.info({ adapter: name }, 'Default agent adapter changed');
}

/**
 * List all registered adapters.
 */
export function listAdapters(): Array<{
  name: string;
  isDefault: boolean;
  isAvailable: boolean;
}> {
  return Array.from(adapters.entries()).map(([name, adapter]) => ({
    name,
    isDefault: adapter === defaultAdapter,
    isAvailable: adapter.isAvailable(),
  }));
}

/**
 * Initialize the adapter system with the default Claude container adapter.
 */
export function initAdapters(): void {
  registerAdapter(new ClaudeContainerAdapter());
}
