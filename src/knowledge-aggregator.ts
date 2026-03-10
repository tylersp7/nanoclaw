import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';
import { getConversationIndexStats, searchConversations } from './db.js';
import { logger } from './logger.js';

const AGGREGATION_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
const STARTUP_DELAY = 2 * 60 * 1000; // 2 minutes (wait for indexer)
const GLOBAL_DIR = path.join(GROUPS_DIR, 'global');
const GLOBAL_CLAUDE_MD = path.join(GLOBAL_DIR, 'CLAUDE.md');
const MAX_OUTPUT_SIZE = 2000; // ~2KB cap for system prompt injection

export interface GlobalKnowledge {
  lastUpdated: string;
  crossGroupInsights: string[];
  sharedFacts: string[];
  activeTopics: Array<{ topic: string; groups: string[]; frequency: number }>;
}

/**
 * Read all user-profile.md files across groups and extract shared facts.
 */
function collectUserProfiles(): string[] {
  const facts: string[] = [];

  let groupFolders: string[];
  try {
    groupFolders = fs.readdirSync(GROUPS_DIR).filter((f) => {
      try {
        return (
          f !== 'global' && fs.statSync(path.join(GROUPS_DIR, f)).isDirectory()
        );
      } catch {
        return false;
      }
    });
  } catch {
    return facts;
  }

  for (const folder of groupFolders) {
    const profilePath = path.join(GROUPS_DIR, folder, 'user-profile.md');
    try {
      if (!fs.existsSync(profilePath)) continue;
      const content = fs.readFileSync(profilePath, 'utf-8');
      // Extract bullet points or key lines (skip headings and blank lines)
      const lines = content
        .split('\n')
        .map((l) => l.trim())
        .filter(
          (l) =>
            l.length > 0 &&
            !l.startsWith('#') &&
            !l.startsWith('---') &&
            !l.startsWith('*Auto-generated'),
        );

      for (const line of lines) {
        const cleaned = line.replace(/^[-*]\s*/, '').trim();
        if (cleaned.length > 10 && !facts.includes(cleaned)) {
          facts.push(cleaned);
        }
      }
    } catch (err) {
      logger.debug({ err, folder }, 'Error reading user profile');
    }
  }

  return facts;
}

/**
 * Get group activity stats from the conversation index.
 */
function getGroupActivity(): Map<string, number> {
  const activity = new Map<string, number>();
  try {
    const stats = getConversationIndexStats();
    for (const stat of stats) {
      if (stat.group_folder !== 'global') {
        activity.set(stat.group_folder, stat.count);
      }
    }
  } catch (err) {
    logger.debug({ err }, 'Error getting conversation index stats');
  }
  return activity;
}

/**
 * Search for common topics across all groups.
 * Uses a fixed set of likely cross-cutting terms.
 */
function findCrossGroupTopics(): Array<{
  topic: string;
  groups: string[];
  frequency: number;
}> {
  const topics: Array<{
    topic: string;
    groups: string[];
    frequency: number;
  }> = [];

  // Common topics to probe — these cover the typical NanoClaw use cases
  const probeTerms = [
    'vps',
    'n8n',
    'lead',
    'monitor',
    'deploy',
    'docker',
    'backup',
    'client',
    'proposal',
    'automation',
    'webhook',
    'pipeline',
    'health',
    'schedule',
  ];

  for (const term of probeTerms) {
    try {
      const results = searchConversations(term, undefined, 20);
      if (results.length === 0) continue;

      const groupSet = new Set<string>();
      for (const r of results) {
        if (r.group_folder !== 'global') {
          groupSet.add(r.group_folder);
        }
      }

      // Only include topics that appear in at least one group
      if (groupSet.size > 0) {
        topics.push({
          topic: term,
          groups: Array.from(groupSet).sort(),
          frequency: results.length,
        });
      }
    } catch {
      // FTS query error (e.g., reserved word) — skip silently
    }
  }

  // Sort by frequency descending, limit to top 10
  topics.sort((a, b) => b.frequency - a.frequency);
  return topics.slice(0, 10);
}

/**
 * Build cross-group insights by comparing activity and topics.
 */
function buildInsights(
  activity: Map<string, number>,
  topics: Array<{ topic: string; groups: string[]; frequency: number }>,
): string[] {
  const insights: string[] = [];

  // Identify most active groups
  const sorted = Array.from(activity.entries()).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 1) {
    const top = sorted.slice(0, 3).map(([g, c]) => `${g} (${c})`);
    insights.push(
      `Most active groups by conversation count: ${top.join(', ')}`,
    );
  }

  // Identify cross-group topics (appear in 2+ groups)
  const crossCutting = topics.filter((t) => t.groups.length >= 2);
  for (const t of crossCutting.slice(0, 5)) {
    insights.push(
      `"${t.topic}" discussed across groups: ${t.groups.join(', ')}`,
    );
  }

  return insights;
}

/**
 * Scan all groups and build a knowledge snapshot.
 */
export function aggregateKnowledge(): GlobalKnowledge {
  const sharedFacts = collectUserProfiles();
  const activity = getGroupActivity();
  const activeTopics = findCrossGroupTopics();
  const crossGroupInsights = buildInsights(activity, activeTopics);

  return {
    lastUpdated: new Date().toISOString(),
    crossGroupInsights,
    sharedFacts,
    activeTopics,
  };
}

/**
 * Write the global knowledge to groups/global/CLAUDE.md in a structured
 * format that non-main agents can use as system context.
 *
 * Preserves existing base content (assistant identity, instructions) and
 * appends the auto-generated knowledge section.
 */
export function writeGlobalKnowledge(knowledge: GlobalKnowledge): void {
  // Ensure directory exists
  fs.mkdirSync(GLOBAL_DIR, { recursive: true });

  // Read existing file to preserve the base content above the auto-generated section
  let baseContent = '';
  try {
    const existing = fs.readFileSync(GLOBAL_CLAUDE_MD, 'utf-8');
    const marker = '\n---\n\n# Global Knowledge Base';
    const markerIdx = existing.indexOf(marker);
    if (markerIdx !== -1) {
      baseContent = existing.substring(0, markerIdx);
    } else {
      baseContent = existing;
    }
  } catch {
    // File doesn't exist yet — no base content
  }

  // Build the knowledge section
  const lines: string[] = [];
  lines.push('---');
  lines.push('');
  lines.push('# Global Knowledge Base');
  lines.push('');
  lines.push(`Last updated: ${knowledge.lastUpdated}`);

  if (knowledge.crossGroupInsights.length > 0) {
    lines.push('');
    lines.push('## Cross-Group Insights');
    for (const insight of knowledge.crossGroupInsights) {
      lines.push(`- ${insight}`);
    }
  }

  if (knowledge.sharedFacts.length > 0) {
    lines.push('');
    lines.push('## Shared Facts');
    // Limit to keep output concise
    for (const fact of knowledge.sharedFacts.slice(0, 15)) {
      lines.push(`- ${fact}`);
    }
  }

  if (knowledge.activeTopics.length > 0) {
    lines.push('');
    lines.push('## Active Topics');
    for (const topic of knowledge.activeTopics) {
      const groupInfo = topic.groups
        .map((g) => {
          const label =
            topic.frequency > 5 && topic.groups[0] === g
              ? 'frequent'
              : 'occasional';
          return `${g} (${label})`;
        })
        .join(', ');
      lines.push(`- ${topic.topic}: ${groupInfo}`);
    }
  }

  lines.push('');
  lines.push(
    '*Auto-generated by NanoClaw knowledge aggregator. Do not edit manually.*',
  );
  lines.push('');

  const knowledgeSection = lines.join('\n');

  // Enforce size cap on the knowledge section
  const truncated =
    knowledgeSection.length > MAX_OUTPUT_SIZE
      ? knowledgeSection.substring(0, MAX_OUTPUT_SIZE) +
        '\n\n*[Truncated to fit size limit]*\n'
      : knowledgeSection;

  const output = baseContent.trimEnd() + '\n\n' + truncated;

  fs.writeFileSync(GLOBAL_CLAUDE_MD, output, 'utf-8');
  logger.info(
    {
      insights: knowledge.crossGroupInsights.length,
      facts: knowledge.sharedFacts.length,
      topics: knowledge.activeTopics.length,
      sizeBytes: output.length,
    },
    'Global knowledge base updated',
  );
}

/**
 * Run a single aggregation cycle.
 */
function runAggregation(): void {
  try {
    const knowledge = aggregateKnowledge();
    writeGlobalKnowledge(knowledge);
  } catch (err) {
    logger.error({ err }, 'Knowledge aggregation failed');
  }
}

/**
 * Start the knowledge aggregator.
 * Runs with a startup delay (so conversation indexer finishes first),
 * then repeats every 6 hours.
 */
export function startKnowledgeAggregator(): void {
  logger.info(
    {
      delayMinutes: STARTUP_DELAY / 60000,
      intervalHours: AGGREGATION_INTERVAL / 3600000,
    },
    'Knowledge aggregator scheduled',
  );

  // Delayed first run
  setTimeout(() => {
    runAggregation();

    // Periodic runs
    setInterval(() => {
      runAggregation();
    }, AGGREGATION_INTERVAL);
  }, STARTUP_DELAY);
}
