import { WebClient } from '@slack/web-api';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface SlackCredentials {
  botToken: string;
  mode: 'tool' | 'monitor' | 'interactive';
  workspace: string;
}

let slackClient: WebClient | null = null;
let credentials: SlackCredentials | null = null;

function loadCredentials(): SlackCredentials {
  if (credentials) return credentials;

  const credPath = path.join(os.homedir(), '.nanoclaw-slack', 'slack-credentials.json');
  if (!fs.existsSync(credPath)) {
    throw new Error('Slack credentials not found. Run /add-slack to set up.');
  }

  credentials = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
  return credentials!;
}

function getClient(): WebClient {
  if (slackClient) return slackClient;

  const creds = loadCredentials();
  slackClient = new WebClient(creds.botToken);
  return slackClient;
}

export interface SlackMessage {
  user: string;
  username?: string;
  text: string;
  timestamp: string;
  channel: string;
  channelName?: string;
  thread_ts?: string;
  reactions?: Array<{ name: string; count: number }>;
}

async function getChannelId(channelName: string): Promise<string | null> {
  const client = getClient();
  const name = channelName.replace(/^#/, '');

  const publicResult = await client.conversations.list({
    types: 'public_channel',
    limit: 1000,
  });

  const publicChannel = publicResult.channels?.find(
    (c) => c.name === name || c.id === name
  );
  if (publicChannel) return publicChannel.id!;

  const privateResult = await client.conversations.list({
    types: 'private_channel',
    limit: 1000,
  });

  const privateChannel = privateResult.channels?.find(
    (c) => c.name === name || c.id === name
  );
  if (privateChannel) return privateChannel.id!;

  return null;
}

/**
 * Get messages from a Slack channel
 */
export async function getChannelMessages(
  channelName: string,
  limit: number = 50,
  oldest?: string
): Promise<SlackMessage[]> {
  const client = getClient();

  const channelId = await getChannelId(channelName);
  if (!channelId) {
    throw new Error(`Channel ${channelName} not found or bot not invited`);
  }

  const result = await client.conversations.history({
    channel: channelId,
    limit,
    oldest,
  });

  if (!result.ok || !result.messages) {
    throw new Error(`Failed to fetch messages: ${result.error}`);
  }

  const messages: SlackMessage[] = [];
  for (const msg of result.messages) {
    let username = msg.user;
    if (msg.user) {
      try {
        const userInfo = await client.users.info({ user: msg.user });
        username = userInfo.user?.real_name || userInfo.user?.name || msg.user;
      } catch (e) {
        // Ignore user info errors
      }
    }

    messages.push({
      user: msg.user || 'unknown',
      username,
      text: msg.text || '',
      timestamp: msg.ts || '',
      channel: channelId,
      channelName,
      thread_ts: msg.thread_ts,
      reactions: msg.reactions as Array<{ name: string; count: number }> | undefined,
    });
  }

  return messages;
}

/**
 * List all channels the bot has access to
 */
export async function listChannels(): Promise<Array<{ id: string; name: string; isMember: boolean }>> {
  const client = getClient();

  const result = await client.conversations.list({
    types: 'public_channel,private_channel',
    limit: 1000,
  });

  if (!result.ok || !result.channels) {
    throw new Error(`Failed to list channels: ${result.error}`);
  }

  return result.channels.map((c) => ({
    id: c.id!,
    name: c.name!,
    isMember: c.is_member || false,
  }));
}

/**
 * Get messages since a specific timestamp
 */
export async function getMessagesSince(
  channelName: string,
  sinceTimestamp: string
): Promise<SlackMessage[]> {
  return getChannelMessages(channelName, 100, sinceTimestamp);
}

/**
 * Post a message to a channel (Monitor/Interactive mode)
 */
export async function postMessage(
  channelName: string,
  text: string,
  threadTs?: string
): Promise<void> {
  const creds = loadCredentials();
  if (creds.mode === 'tool') {
    throw new Error('Posting messages requires Monitor or Interactive mode');
  }

  const client = getClient();
  const channelId = await getChannelId(channelName);

  if (!channelId) {
    throw new Error(`Channel ${channelName} not found`);
  }

  await client.chat.postMessage({
    channel: channelId,
    text,
    thread_ts: threadTs,
  });
}

/**
 * Filter messages by severity keywords (for VPS monitoring)
 */
export function filterBySeverity(
  messages: SlackMessage[],
  severities: string[] = ['critical', 'high', 'error', 'failed']
): SlackMessage[] {
  const keywords = severities.map((s) => s.toLowerCase());
  return messages.filter((msg) =>
    keywords.some((keyword) => msg.text.toLowerCase().includes(keyword))
  );
}

/**
 * Format messages for WhatsApp display
 */
export function formatMessagesForWhatsApp(messages: SlackMessage[]): string {
  if (messages.length === 0) return 'No messages found.';

  return messages
    .map((msg, i) => {
      const time = new Date(parseFloat(msg.timestamp) * 1000).toLocaleString();
      const reactions = msg.reactions
        ? ` [${msg.reactions.map((r) => `${r.name}:${r.count}`).join(', ')}]`
        : '';
      return `${i + 1}. *${msg.username || msg.user}* (${time})${reactions}\n   ${msg.text.substring(0, 200)}${msg.text.length > 200 ? '...' : ''}`;
    })
    .join('\n\n');
}
