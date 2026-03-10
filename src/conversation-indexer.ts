import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';
import {
  getConversationIndexStats,
  indexConversation,
  isConversationIndexed,
} from './db.js';
import { logger } from './logger.js';

const INDEX_INTERVAL = 30 * 60 * 1000; // 30 minutes

/**
 * Parse a conversation archive file to extract title and date.
 *
 * Files follow the pattern: {date}-{name}.md
 * First line is typically "# Title"
 */
function parseConversationFile(
  filename: string,
  content: string,
): { title: string; archivedAt: string } {
  // Extract title from first heading line
  let title = filename.replace(/\.md$/, '');
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      title = trimmed.slice(2).trim();
      break;
    }
  }

  // Extract date from filename (e.g., 2026-02-12-conversation-0229.md)
  const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  const archivedAt = dateMatch ? dateMatch[1] : '';

  return { title, archivedAt };
}

/**
 * Index all conversations for a specific group folder.
 * Skips files that are already indexed with the same size.
 */
export function indexGroupConversations(groupFolder: string): number {
  const conversationsDir = path.join(GROUPS_DIR, groupFolder, 'conversations');

  if (!fs.existsSync(conversationsDir)) {
    return 0;
  }

  let indexed = 0;
  let files: string[];
  try {
    files = fs.readdirSync(conversationsDir).filter((f) => f.endsWith('.md'));
  } catch (err) {
    logger.error({ err, groupFolder }, 'Error reading conversations directory');
    return 0;
  }

  for (const filename of files) {
    const filePath = path.join(conversationsDir, filename);

    try {
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;

      // Skip if already indexed with same size
      if (isConversationIndexed(groupFolder, filename, fileSize)) {
        continue;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const { title, archivedAt } = parseConversationFile(filename, content);

      indexConversation(
        groupFolder,
        filename,
        title,
        content,
        archivedAt,
        fileSize,
      );
      indexed++;
    } catch (err) {
      logger.error(
        { err, groupFolder, filename },
        'Error indexing conversation file',
      );
    }
  }

  return indexed;
}

/**
 * Scan all group folders and index their conversations.
 */
function indexAllConversations(): void {
  let groupFolders: string[];
  try {
    groupFolders = fs.readdirSync(GROUPS_DIR).filter((f) => {
      try {
        return fs.statSync(path.join(GROUPS_DIR, f)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch (err) {
    logger.error({ err }, 'Error reading groups directory');
    return;
  }

  let totalIndexed = 0;
  for (const groupFolder of groupFolders) {
    const count = indexGroupConversations(groupFolder);
    totalIndexed += count;
  }

  if (totalIndexed > 0) {
    const stats = getConversationIndexStats();
    logger.info({ totalIndexed, stats }, 'Conversation indexing complete');
  }
}

/**
 * Start the conversation indexer.
 * Runs an initial index on startup, then re-indexes periodically.
 */
export function startConversationIndexer(): void {
  logger.info('Starting conversation indexer');

  // Initial index
  indexAllConversations();

  // Periodic re-index
  setInterval(() => {
    indexAllConversations();
  }, INDEX_INTERVAL);

  logger.info(
    { intervalMinutes: INDEX_INTERVAL / 60000 },
    'Conversation indexer started',
  );
}
