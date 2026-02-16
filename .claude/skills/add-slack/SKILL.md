---
name: add-slack
description: Add Slack integration to NanoClaw. Can be configured as a tool (agent reads messages when triggered from WhatsApp), monitor mode (periodic channel checks with alerts), or interactive mode (agent can post and react). Perfect for monitoring VPS events from BeastMode and Auto Blogger.
---

# Add Slack Integration

This skill adds Slack capabilities to NanoClaw for monitoring VPS alerts and events. It can be configured in three modes:

1. **Tool Mode** - Agent can read Slack messages/channels when asked from WhatsApp
2. **Monitor Mode** - Agent periodically checks channels and alerts you about important events
3. **Interactive Mode** - Agent can post messages and react (full two-way communication)

## Initial Questions

Ask the user:

> How do you want to use Slack with NanoClaw?
>
> **Option 1: Tool Mode** (Recommended Start)
> - Andy reads Slack when you ask (e.g., "@Andy check #bugbounty for critical findings")
> - No automated polling, only on-demand
> - Simplest setup
>
> **Option 2: Monitor Mode** (Best for VPS Monitoring)
> - Everything in Tool Mode, plus:
> - Andy automatically checks channels on a schedule
> - Alerts you via WhatsApp when important events happen
> - Great for monitoring #bugbounty, #beastmode-alerts, etc.
>
> **Option 3: Interactive Mode** (Full Control)
> - Everything in Monitor Mode, plus:
> - Andy can post messages to Slack
> - Can react with emojis, create threads
> - Two-way communication with your team

Store their choice and proceed to the appropriate section.

---

## Prerequisites (All Modes)

### 1. Check Existing Slack Setup

First, check if Slack is already configured:

```bash
ls -la ~/.nanoclaw-slack/ 2>/dev/null || echo "No Slack config found"
```

If `slack-credentials.json` exists, skip to "Verify Slack Access" below.

### 2. Create Slack Config Directory

```bash
mkdir -p ~/.nanoclaw-slack
chmod 700 ~/.nanoclaw-slack
```

### 3. Slack App Setup

**USER ACTION REQUIRED**

Tell the user:

> I need you to create a Slack app and get the credentials. I'll walk you through it:
>
> 1. Open https://api.slack.com/apps in your browser
> 2. Click **Create New App**
> 3. Choose **From scratch**
> 4. App Name: **NanoClaw** (or anything you prefer)
> 5. Workspace: Select your workspace (where BeastMode/Auto Blogger alerts go)
> 6. Click **Create App**

Wait for user confirmation, then continue:

> 7. Now we need to add permissions. In the left sidebar, click **OAuth & Permissions**
> 8. Scroll down to **Scopes** → **Bot Token Scopes**
> 9. Add these scopes (click **Add an OAuth Scope** for each):

For **Tool Mode**, add:
```
channels:history    - Read messages from public channels
channels:read       - View basic channel info
groups:history      - Read messages from private channels (optional)
groups:read         - View private channel info (optional)
users:read          - Get user information
```

For **Monitor Mode**, add the same as Tool Mode plus:
```
chat:write          - Send messages (for alerts/summaries)
```

For **Interactive Mode**, add all of the above plus:
```
reactions:write     - Add emoji reactions
reactions:read      - View emoji reactions
files:read          - Read file info (if monitoring file uploads)
```

Wait for user confirmation, then continue:

> 10. Scroll to the top of the **OAuth & Permissions** page
> 11. Click **Install to Workspace**
> 12. Click **Allow**
> 13. You'll see a **Bot User OAuth Token** that starts with `xoxb-`
> 14. Copy this token (click **Copy**)

Wait for user to paste the token, then save it:

```bash
cat > ~/.nanoclaw-slack/slack-credentials.json << 'EOF'
{
  "botToken": "PASTE_TOKEN_HERE",
  "mode": "tool",
  "workspace": "your-workspace-name"
}
EOF
chmod 600 ~/.nanoclaw-slack/slack-credentials.json
```

Replace `PASTE_TOKEN_HERE` with the token user provided, and set the mode appropriately.

### 4. Invite Bot to Channels

**USER ACTION REQUIRED**

Tell the user:

> Now invite the NanoClaw bot to the channels you want it to monitor:
>
> 1. Open Slack and go to each channel (#bugbounty, #beastmode-alerts, etc.)
> 2. Click the channel name at the top
> 3. Click **Integrations**
> 4. Click **Add apps**
> 5. Find **NanoClaw** and click **Add**
>
> Which channels did you add the bot to? (e.g., #bugbounty, #beastmode-alerts, #asm-alerts)

Store the channel list for later configuration.

---

## Installation

### 1. Install Slack SDK

```bash
cd /Users/tyler/dev/nanoclaw
npm install @slack/web-api
```

### 2. Create Slack Helper Module

Create the Slack integration module:

```typescript
// src/slack-helper.ts
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
  return credentials;
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

/**
 * Get messages from a Slack channel
 */
export async function getChannelMessages(
  channelName: string,
  limit: number = 50,
  oldest?: string
): Promise<SlackMessage[]> {
  const client = getClient();

  // Convert channel name to ID
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

  // Get user info for better display names
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
 * Get channel ID from name
 */
async function getChannelId(channelName: string): Promise<string | null> {
  const client = getClient();

  // Remove # if present
  const name = channelName.replace(/^#/, '');

  // Try public channels first
  const publicResult = await client.conversations.list({
    types: 'public_channel',
    limit: 1000,
  });

  const publicChannel = publicResult.channels?.find(
    (c) => c.name === name || c.id === name
  );
  if (publicChannel) return publicChannel.id!;

  // Try private channels
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
 * Search for messages matching a query
 */
export async function searchMessages(
  query: string,
  channelName?: string
): Promise<SlackMessage[]> {
  const client = getClient();

  let searchQuery = query;
  if (channelName) {
    searchQuery = `in:${channelName.replace(/^#/, '')} ${query}`;
  }

  const result = await client.search.messages({
    query: searchQuery,
    count: 50,
  });

  if (!result.ok || !result.messages?.matches) {
    throw new Error(`Search failed: ${result.error}`);
  }

  return result.messages.matches.map((msg: any) => ({
    user: msg.user || 'unknown',
    username: msg.username,
    text: msg.text || '',
    timestamp: msg.ts || '',
    channel: msg.channel?.id || '',
    channelName: msg.channel?.name,
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
 * Add a reaction to a message (Interactive mode)
 */
export async function addReaction(
  channelName: string,
  timestamp: string,
  emoji: string
): Promise<void> {
  const creds = loadCredentials();
  if (creds.mode !== 'interactive') {
    throw new Error('Reactions require Interactive mode');
  }

  const client = getClient();
  const channelId = await getChannelId(channelName);

  if (!channelId) {
    throw new Error(`Channel ${channelName} not found`);
  }

  await client.reactions.add({
    channel: channelId,
    timestamp,
    name: emoji.replace(/:/g, ''), // Remove colons if present
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
```

Save this to `src/slack-helper.ts`.

### 3. Export Slack Helper

Add to `src/index.ts` or create an exports file. The helper will be available for container agents to use.

### 4. Add Slack Tools to Container

Create a wrapper script that agents can call:

```bash
cat > /Users/tyler/dev/nanoclaw/container/tools/slack-reader.sh << 'EOF'
#!/bin/bash
# Slack reading tool for NanoClaw agents
# Usage: slack-reader.sh <command> [args...]

NANOCLAW_DIR="/workspace/project"

case "$1" in
  list-channels)
    node -e "
    const { listChannels } = require('$NANOCLAW_DIR/dist/slack-helper.js');
    listChannels().then(channels => {
      console.log('Available Slack channels:');
      channels.forEach(c => {
        console.log(\`  \${c.isMember ? '✓' : ' '} #\${c.name} (\${c.id})\`);
      });
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  read-channel)
    CHANNEL="$2"
    LIMIT="${3:-50}"
    node -e "
    const { getChannelMessages, formatMessagesForWhatsApp } = require('$NANOCLAW_DIR/dist/slack-helper.js');
    getChannelMessages('$CHANNEL', $LIMIT).then(msgs => {
      console.log(formatMessagesForWhatsApp(msgs));
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  search)
    QUERY="$2"
    CHANNEL="$3"
    node -e "
    const { searchMessages, formatMessagesForWhatsApp } = require('$NANOCLAW_DIR/dist/slack-helper.js');
    searchMessages('$QUERY', '$CHANNEL').then(msgs => {
      console.log(formatMessagesForWhatsApp(msgs));
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  filter-critical)
    CHANNEL="$2"
    LIMIT="${3:-100}"
    node -e "
    const { getChannelMessages, filterBySeverity, formatMessagesForWhatsApp } = require('$NANOCLAW_DIR/dist/slack-helper.js');
    getChannelMessages('$CHANNEL', $LIMIT).then(msgs => {
      const critical = filterBySeverity(msgs, ['critical', 'high', 'error', 'failed', 'alert']);
      console.log(formatMessagesForWhatsApp(critical));
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  since)
    CHANNEL="$2"
    TIMESTAMP="$3"
    node -e "
    const { getMessagesSince, formatMessagesForWhatsApp } = require('$NANOCLAW_DIR/dist/slack-helper.js');
    getMessagesSince('$CHANNEL', '$TIMESTAMP').then(msgs => {
      console.log(formatMessagesForWhatsApp(msgs));
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  *)
    echo "Usage: slack-reader.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  list-channels              - List all channels bot has access to"
    echo "  read-channel <channel> [limit]  - Read messages from channel"
    echo "  search <query> [channel]   - Search messages"
    echo "  filter-critical <channel> [limit] - Get only critical/error messages"
    echo "  since <channel> <timestamp>  - Get messages since timestamp"
    echo ""
    echo "Examples:"
    echo "  slack-reader.sh list-channels"
    echo "  slack-reader.sh read-channel bugbounty 20"
    echo "  slack-reader.sh filter-critical beastmode-alerts"
    echo "  slack-reader.sh search 'critical vulnerability' bugbounty"
    ;;
esac
EOF

chmod +x /Users/tyler/dev/nanoclaw/container/tools/slack-reader.sh
```

### 5. Update Container to Include Slack Tools

The container already mounts `/workspace/project`, so the compiled slack-helper will be available.

Add to `groups/main/CLAUDE.md` (or any group where you want Slack access):

```markdown
## Slack Integration

You have access to Slack via the `slack-reader.sh` tool:

**List channels:**
```bash
/workspace/project/container/tools/slack-reader.sh list-channels
```

**Read messages from a channel:**
```bash
/workspace/project/container/tools/slack-reader.sh read-channel bugbounty 50
```

**Filter for critical/error messages:**
```bash
/workspace/project/container/tools/slack-reader.sh filter-critical beastmode-alerts
```

**Search for specific content:**
```bash
/workspace/project/container/tools/slack-reader.sh search "high severity" bugbounty
```

Use these tools when the user asks about Slack channels or VPS alerts.
```

### 6. Rebuild Container

```bash
cd /Users/tyler/dev/nanoclaw
npm run build
./container/build.sh
```

---

## Verification

### Test Slack Access

Test from your terminal first:

```bash
cd /Users/tyler/dev/nanoclaw
node -e "
const { listChannels } = require('./dist/slack-helper.js');
listChannels().then(channels => {
  console.log('Available channels:');
  channels.forEach(c => console.log(\`  \${c.isMember ? '✓' : ' '} #\${c.name}\`));
}).catch(err => console.error('Error:', err.message));
"
```

### Test from WhatsApp

Send to Andy:

```
@Andy list all Slack channels you have access to
```

```
@Andy check the #bugbounty channel and show me the last 10 messages
```

```
@Andy search for "critical" in #beastmode-alerts
```

---

## Monitor Mode Setup

If user chose Monitor Mode, create scheduled tasks:

### 1. Critical Findings Monitor

```
@Andy every hour, check #bugbounty Slack channel for any messages containing "critical" or "high" from the past hour. If any are found, send me a WhatsApp alert with a summary.
```

### 2. Error Alert Monitor

```
@Andy every 30 minutes, check #beastmode-alerts for any messages containing "error" or "failed" from the past 30 minutes. Alert me immediately if any are found.
```

### 3. Daily Digest

```
@Andy every day at 6pm, read all messages from #bugbounty, #beastmode-alerts, and #asm-alerts since 8am. Summarize the activity and send me a digest of important events.
```

### 4. Weekend Summary

```
@Andy every Monday at 9am, check #bugbounty for any messages from the weekend (since Friday 5pm). Summarize any findings so I'm caught up for the week.
```

---

## Interactive Mode Setup

If user chose Interactive Mode, add posting capabilities:

Tell the user:

> In Interactive Mode, Andy can also post to Slack. Here are some examples:
>
> ```
> @Andy post a message to #bugbounty saying "Reviewing this week's findings, will respond by EOD"
> ```
>
> ```
> @Andy add a :eyes: reaction to the most recent critical finding in #bugbounty
> ```
>
> Andy can also auto-acknowledge findings:
> ```
> @Andy when you see a new critical or high severity finding in #bugbounty, automatically react with :eyes: emoji so the team knows I've seen it
> ```

---

## Troubleshooting

### Bot Not in Channel

If you get "Channel not found" errors:

1. Open Slack
2. Go to the channel
3. Type `/invite @NanoClaw`
4. Or: Channel settings → Integrations → Add apps → NanoClaw

### Permission Errors

If you get "missing_scope" errors:

1. Go back to https://api.slack.com/apps
2. Click your NanoClaw app
3. OAuth & Permissions → Scopes
4. Add the missing scope mentioned in the error
5. Reinstall the app to workspace

### Messages Not Loading

Check the timestamp format. Slack uses Unix timestamps:

```bash
# Get current timestamp
date +%s

# Use in commands
slack-reader.sh since bugbounty 1707552000
```

---

## Example VPS Monitoring Tasks

Here are complete tasks tailored for your VPS setup:

### BeastMode Findings Monitor

```
@Andy every 2 hours, check the #bugbounty Slack channel for any new findings. Filter for messages containing "critical", "high", "xss", "sql injection", or "rce". If any are found, send me a WhatsApp message with details including the URL, severity, and a brief description.
```

### Error Correlation

```
@Andy every 4 hours, check both #beastmode-alerts Slack channel and SSH into beastmode-vps-ts to check /opt/bugbounty/logs/ for errors. If you find errors in both Slack and the logs, correlate them and let me know if there's a pattern or if manual intervention is needed.
```

### Daily Security Brief

```
@Andy every day at 7am, check #bugbounty, #beastmode-alerts, and #asm-alerts for all activity from the past 24 hours. Create a brief security summary including: number of new findings, any critical issues, scan completion status, and recommended actions. Send this as a morning briefing.
```

### Weekend Coverage

```
@Andy every Saturday and Sunday at noon, check #bugbounty and #beastmode-alerts for any new messages since the last check. If there are any critical or high severity items, alert me immediately via WhatsApp. Otherwise, just keep track and summarize everything Monday morning.
```

---

## Configuration Storage

Slack configuration is stored in:
- **Credentials:** `~/.nanoclaw-slack/slack-credentials.json`
- **Last check timestamps:** Managed by scheduled tasks in NanoClaw DB

To update mode or credentials:

```bash
nano ~/.nanoclaw-slack/slack-credentials.json
```

---

## Success Criteria

✅ Bot installed in Slack workspace
✅ Bot invited to relevant channels
✅ Can list channels from Andy
✅ Can read messages from Andy
✅ Can search messages from Andy
✅ (Monitor Mode) Scheduled checks running
✅ (Interactive Mode) Can post messages

---

## Next Steps

1. Test the integration with a few channels
2. Set up 2-3 monitoring tasks for your most important channels
3. Adjust alert thresholds based on noise levels
4. Consider adding custom filters for your specific VPS events

Tell the user:

> Slack integration complete! 🎉
>
> Andy can now monitor your VPS alerts from Slack. Try asking:
> - "@Andy check #bugbounty for critical findings"
> - "@Andy what happened in #beastmode-alerts today?"
> - "@Andy search for 'xss' in #bugbounty"
>
> Ready to set up monitoring tasks? I can help you create scheduled checks for your VPS channels!
