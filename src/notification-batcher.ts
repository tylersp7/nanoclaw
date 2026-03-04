import { logger } from './logger.js';

export interface BatcherConfig {
  windowMs: number; // How long to wait before flushing (default: 30000 = 30s)
  maxMessages: number; // Max messages to batch before force-flush (default: 5)
  separator: string; // How to join batched messages (default: '\n\n---\n\n')
}

const DEFAULT_CONFIG: BatcherConfig = {
  windowMs: 30000,
  maxMessages: 5,
  separator: '\n\n---\n\n',
};

export class NotificationBatcher {
  private queues = new Map<string, string[]>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private sendFn: (jid: string, text: string) => Promise<void>,
    private config: BatcherConfig = DEFAULT_CONFIG,
  ) {}

  /**
   * Queue a message for the given jid.
   * Starts a batch timer on first message; force-flushes when maxMessages is reached.
   */
  send(jid: string, text: string): void {
    let queue = this.queues.get(jid);
    if (!queue) {
      queue = [];
      this.queues.set(jid, queue);
    }

    queue.push(text);

    // Force flush if we hit the max
    if (queue.length >= this.config.maxMessages) {
      this.flush(jid);
      return;
    }

    // Start timer on first message for this jid
    if (!this.timers.has(jid)) {
      const timer = setTimeout(() => this.flush(jid), this.config.windowMs);
      this.timers.set(jid, timer);
    }
  }

  /**
   * Force flush all pending messages (call on shutdown).
   */
  async flushAll(): Promise<void> {
    const jids = [...this.queues.keys()];
    await Promise.all(jids.map((jid) => this.flush(jid)));
  }

  /**
   * Flush queued messages for a specific chat.
   */
  private async flush(jid: string): Promise<void> {
    // Clear timer
    const timer = this.timers.get(jid);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(jid);
    }

    // Grab and clear queue
    const queue = this.queues.get(jid);
    this.queues.delete(jid);

    if (!queue || queue.length === 0) return;

    const merged = queue.join(this.config.separator);

    try {
      await this.sendFn(jid, merged);
      logger.debug(
        { jid, batchedCount: queue.length },
        'Flushed batched notifications',
      );
    } catch (err) {
      logger.error(
        { jid, batchedCount: queue.length, err },
        'Failed to flush batched notifications',
      );
    }
  }
}
