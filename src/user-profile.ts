import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';
import { logger } from './logger.js';
import { NewMessage } from './types.js';

export interface UserProfile {
  lastUpdated: string;
  messagePatterns: {
    averageLength: 'short' | 'medium' | 'long';
    peakHours: number[]; // Hours of day (0-23) when most active
    activeDays: string[]; // Days of week
  };
  preferences: {
    responseStyle?: string; // "concise" | "detailed" | "technical"
    commonTopics: string[]; // Most discussed topics
    toolPreferences: string[]; // Tools user frequently requests
  };
  interactionStats: {
    totalMessages: number;
    totalSessions: number;
    lastInteraction: string;
    averageSessionMessages: number;
  };
}

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function defaultProfile(): UserProfile {
  return {
    lastUpdated: new Date().toISOString(),
    messagePatterns: {
      averageLength: 'medium',
      peakHours: [],
      activeDays: [],
    },
    preferences: {
      commonTopics: [],
      toolPreferences: [],
    },
    interactionStats: {
      totalMessages: 0,
      totalSessions: 0,
      lastInteraction: new Date().toISOString(),
      averageSessionMessages: 0,
    },
  };
}

function profilePath(groupFolder: string): string {
  return path.join(GROUPS_DIR, groupFolder, 'user-profile.md');
}

/**
 * Load user profile from the group's user-profile.md file.
 * Parses the machine-readable JSON block at the end of the file.
 */
export function loadUserProfile(groupFolder: string): UserProfile | null {
  const filePath = profilePath(groupFolder);
  if (!fs.existsSync(filePath)) return null;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    // Extract JSON from the fenced code block after the machine-readable marker
    const jsonMatch = content.match(
      /<!-- Machine-readable data below -->\s*```json\s*([\s\S]*?)```/,
    );
    if (!jsonMatch?.[1]) {
      logger.warn({ groupFolder }, 'user-profile.md missing JSON data block');
      return null;
    }
    return JSON.parse(jsonMatch[1].trim()) as UserProfile;
  } catch (err) {
    logger.warn({ groupFolder, err }, 'Failed to parse user-profile.md');
    return null;
  }
}

/**
 * Save user profile as a human-readable markdown file with embedded JSON.
 */
export function saveUserProfile(
  groupFolder: string,
  profile: UserProfile,
): void {
  const filePath = profilePath(groupFolder);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  profile.lastUpdated = new Date().toISOString();

  const peakHoursFormatted = profile.messagePatterns.peakHours
    .map(formatHour)
    .join(', ');

  const lines: string[] = [
    '# User Profile',
    '',
    `Last updated: ${profile.lastUpdated}`,
    '',
    '## Message Patterns',
    `- Average message length: ${profile.messagePatterns.averageLength}`,
    `- Peak hours: ${peakHoursFormatted || 'not enough data'}`,
    `- Active days: ${profile.messagePatterns.activeDays.join(', ') || 'not enough data'}`,
    '',
    '## Preferences',
    `- Response style: ${profile.preferences.responseStyle || 'not set'}`,
    `- Common topics: ${profile.preferences.commonTopics.join(', ') || 'none yet'}`,
    `- Tool preferences: ${profile.preferences.toolPreferences.join(', ') || 'none yet'}`,
    '',
    '## Interaction Stats',
    `- Total messages: ${profile.interactionStats.totalMessages.toLocaleString()}`,
    `- Total sessions: ${profile.interactionStats.totalSessions}`,
    `- Last interaction: ${profile.interactionStats.lastInteraction.split('T')[0]}`,
    `- Average session messages: ${profile.interactionStats.averageSessionMessages}`,
    '',
    '---',
    '<!-- Machine-readable data below -->',
    '```json',
    JSON.stringify(profile, null, 2),
    '```',
    '',
  ];

  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  logger.debug({ groupFolder }, 'User profile saved');
}

/**
 * Incrementally update profile stats from newly processed messages.
 * Merges into existing profile data rather than overwriting.
 */
export function updateProfileFromMessages(
  groupFolder: string,
  messages: NewMessage[],
): void {
  if (messages.length === 0) return;

  const profile = loadUserProfile(groupFolder) ?? defaultProfile();

  // Update total message count
  profile.interactionStats.totalMessages += messages.length;
  profile.interactionStats.lastInteraction = new Date().toISOString();

  // Track message hours and days
  const hourCounts = new Map<number, number>();
  const dayCounts = new Map<string, number>();
  let totalLength = 0;

  // Seed with existing peak hours and active days
  for (const h of profile.messagePatterns.peakHours) {
    hourCounts.set(h, (hourCounts.get(h) ?? 0) + 5); // Weight existing data
  }
  for (const d of profile.messagePatterns.activeDays) {
    dayCounts.set(d, (dayCounts.get(d) ?? 0) + 5);
  }

  for (const msg of messages) {
    // Skip bot messages — we only track human patterns
    if (msg.is_from_me || msg.is_bot_message) continue;

    const date = new Date(msg.timestamp);
    if (!isNaN(date.getTime())) {
      const hour = date.getHours();
      hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);

      const day = DAY_NAMES[date.getDay()];
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    }

    totalLength += msg.content.length;
  }

  // Compute average message length category
  const humanMessages = messages.filter(
    (m) => !m.is_from_me && !m.is_bot_message,
  );
  if (humanMessages.length > 0) {
    const avgLen = totalLength / humanMessages.length;
    if (avgLen < 50) {
      profile.messagePatterns.averageLength = 'short';
    } else if (avgLen < 200) {
      profile.messagePatterns.averageLength = 'medium';
    } else {
      profile.messagePatterns.averageLength = 'long';
    }
  }

  // Top 5 peak hours by frequency
  profile.messagePatterns.peakHours = [...hourCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([h]) => h)
    .sort((a, b) => a - b);

  // Active days sorted by frequency (descending)
  profile.messagePatterns.activeDays = [...dayCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([d]) => d);

  // Extract topics from message content (simple keyword detection)
  updateTopicsFromContent(
    profile,
    humanMessages.map((m) => m.content),
  );

  saveUserProfile(groupFolder, profile);
}

/**
 * Update profile after a session ends.
 */
export function updateProfileFromSession(
  groupFolder: string,
  sessionData: {
    durationMs: number;
    messageCount: number;
    topics: string[];
  },
): void {
  const profile = loadUserProfile(groupFolder) ?? defaultProfile();

  profile.interactionStats.totalSessions += 1;

  // Rolling average of messages per session
  const prevTotal =
    profile.interactionStats.averageSessionMessages *
    (profile.interactionStats.totalSessions - 1);
  profile.interactionStats.averageSessionMessages = Math.round(
    (prevTotal + sessionData.messageCount) /
      profile.interactionStats.totalSessions,
  );

  // Merge topics
  if (sessionData.topics.length > 0) {
    const existing = new Set(profile.preferences.commonTopics);
    for (const topic of sessionData.topics) {
      existing.add(topic);
    }
    // Keep most recent 20 topics
    profile.preferences.commonTopics = [...existing].slice(-20);
  }

  saveUserProfile(groupFolder, profile);
}

// --- Internal helpers ---

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

/** Known topic keywords mapped to normalized topic labels. */
const TOPIC_KEYWORDS: Record<string, string[]> = {
  deployment: ['deploy', 'deployment', 'release', 'rollout'],
  'vps-monitoring': ['vps', 'server', 'uptime', 'health check', 'monitoring'],
  'lead-generation': ['lead', 'prospect', 'outreach', 'pipeline'],
  infrastructure: ['docker', 'container', 'kubernetes', 'infra'],
  'web-search': ['search', 'research', 'look up', 'find out'],
  email: ['email', 'gmail', 'inbox', 'draft'],
  scheduling: ['schedule', 'task', 'cron', 'reminder'],
  coding: ['code', 'bug', 'fix', 'implement', 'refactor'],
  crm: ['crm', 'hubspot', 'deal', 'contact'],
  content: ['blog', 'post', 'article', 'content', 'write'],
};

function updateTopicsFromContent(profile: UserProfile, texts: string[]): void {
  const topicScores = new Map<string, number>();

  // Seed with existing topics
  for (const t of profile.preferences.commonTopics) {
    topicScores.set(t, topicScores.get(t) ?? 5);
  }

  const combined = texts.join(' ').toLowerCase();
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    for (const kw of keywords) {
      if (combined.includes(kw)) {
        topicScores.set(topic, (topicScores.get(topic) ?? 0) + 1);
      }
    }
  }

  // Keep top 10 topics by score
  profile.preferences.commonTopics = [...topicScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([t]) => t);
}
