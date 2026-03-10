import { hooks } from './lifecycle-hooks.js';
import { logger } from './logger.js';
import { indexGroupConversations } from './conversation-indexer.js';

/**
 * Register learning-related lifecycle hook listeners.
 * These run on the host side (not in containers) for lightweight tracking.
 */
export function registerLearningHooks(): void {
  // When a session ends, re-index that group's conversations
  // (catches newly archived transcripts from pre-compaction hook)
  hooks.on('session:end', (event) => {
    if (!event.success) return;
    try {
      // Small delay to let the pre-compaction hook finish writing
      setTimeout(() => {
        indexGroupConversations(event.groupFolder);
      }, 5000);
    } catch (err) {
      logger.debug(
        { err, group: event.groupFolder },
        'Post-session indexing failed',
      );
    }
  });

  // Log task completions for learning analytics
  hooks.on('task:end', (event) => {
    logger.debug(
      {
        taskId: event.taskId,
        group: event.groupFolder,
        success: event.success,
        durationMs: event.durationMs,
      },
      'Task completed (learning hook)',
    );
  });

  logger.info('Learning hooks registered');
}
