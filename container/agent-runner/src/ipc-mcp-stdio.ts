/**
 * Stdio MCP Server for NanoClaw
 * Standalone process that agent teams subagents can inherit.
 * Reads context from environment variables, writes IPC files for the host.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';
import { isCalendarConfigured, listEvents, createEvent, findFreeTime } from './calendar-tools.js';

const IPC_DIR = '/workspace/ipc';
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
const TASKS_DIR = path.join(IPC_DIR, 'tasks');

// Context from environment variables (set by the agent runner)
const chatJid = process.env.NANOCLAW_CHAT_JID!;
const groupFolder = process.env.NANOCLAW_GROUP_FOLDER!;
const isMain = process.env.NANOCLAW_IS_MAIN === '1';

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);

  // Atomic write: temp file then rename
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);

  return filename;
}

const server = new McpServer({
  name: 'nanoclaw',
  version: '1.0.0',
});

server.tool(
  'send_message',
  `Send a message to the user or group immediately while you're still running. Use this for progress updates or to send multiple messages. You can call this multiple times. Note: when running as a scheduled task, your final output is NOT sent to the user — use this tool if you need to communicate with the user or group.

DESTINATION ROUTING: Optionally specify a named destination to send the message to a different channel (e.g., "reminders" for Telegram, "findings" for Slack). Read /workspace/ipc/destinations.json for available destinations. Omit to send to the current chat.`,
  {
    text: z.string().describe('The message text to send'),
    sender: z.string().optional().describe('Your role/identity name (e.g. "Researcher"). When set, messages appear from a dedicated bot in Telegram.'),
    destination: z.string().optional().describe('Named destination from destinations.json (e.g., "reminders", "findings"). Omit to send to current chat.'),
  },
  async (args) => {
    let targetJid = chatJid;

    // Resolve named destination to a JID
    if (args.destination) {
      const destFile = path.join(IPC_DIR, 'destinations.json');
      try {
        if (fs.existsSync(destFile)) {
          const destinations = JSON.parse(fs.readFileSync(destFile, 'utf-8')) as Array<{ name: string; targetJid: string }>;
          const dest = destinations.find(d => d.name === args.destination);
          if (dest) {
            targetJid = dest.targetJid;
          } else {
            const available = destinations.map(d => d.name).join(', ');
            return {
              content: [{ type: 'text' as const, text: `Unknown destination "${args.destination}". Available: ${available || 'none'}` }],
              isError: true,
            };
          }
        } else {
          return {
            content: [{ type: 'text' as const, text: `No destinations configured. Send without destination to use current chat.` }],
            isError: true,
          };
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error reading destinations: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }

    const data: Record<string, string | undefined> = {
      type: 'message',
      chatJid: targetJid,
      text: args.text,
      sender: args.sender || undefined,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(MESSAGES_DIR, data);

    const destNote = args.destination ? ` (→ ${args.destination})` : '';
    return { content: [{ type: 'text' as const, text: `Message sent${destNote}.` }] };
  },
);

server.tool(
  'schedule_task',
  `Schedule a recurring or one-time task. The task will run as a full agent with access to all tools.

CONTEXT MODE - Choose based on task type:
\u2022 "group": Task runs in the group's conversation context, with access to chat history. Use for tasks that need context about ongoing discussions, user preferences, or recent interactions.
\u2022 "isolated": Task runs in a fresh session with no conversation history. Use for independent tasks that don't need prior context. When using isolated mode, include all necessary context in the prompt itself.

If unsure which mode to use, you can ask the user. Examples:
- "Remind me about our discussion" \u2192 group (needs conversation context)
- "Check the weather every morning" \u2192 isolated (self-contained task)
- "Follow up on my request" \u2192 group (needs to know what was requested)
- "Generate a daily report" \u2192 isolated (just needs instructions in prompt)

MESSAGING BEHAVIOR - The task agent's output is sent to the user or group. It can also use send_message for immediate delivery, or wrap output in <internal> tags to suppress it. Include guidance in the prompt about whether the agent should:
\u2022 Always send a message (e.g., reminders, daily briefings)
\u2022 Only send a message when there's something to report (e.g., "notify me if...")
\u2022 Never send a message (background maintenance tasks)

SCHEDULE VALUE FORMAT (all times are LOCAL timezone):
\u2022 cron: Standard cron expression (e.g., "*/5 * * * *" for every 5 minutes, "0 9 * * *" for daily at 9am LOCAL time)
\u2022 interval: Milliseconds between runs (e.g., "300000" for 5 minutes, "3600000" for 1 hour)
\u2022 once: Local time WITHOUT "Z" suffix (e.g., "2026-02-01T15:30:00"). Do NOT use UTC/Z suffix.`,
  {
    prompt: z.string().describe('What the agent should do when the task runs. For isolated mode, include all necessary context here. For pipeline tasks, this is the overall description.'),
    schedule_type: z.enum(['cron', 'interval', 'once']).describe('cron=recurring at specific times, interval=recurring every N ms, once=run once at specific time'),
    schedule_value: z.string().describe('cron: "*/5 * * * *" | interval: milliseconds like "300000" | once: local timestamp like "2026-02-01T15:30:00" (no Z suffix!)'),
    context_mode: z.enum(['group', 'isolated']).default('group').describe('group=runs with chat history and memory, isolated=fresh session (include context in prompt)'),
    target_group_jid: z.string().optional().describe('(Main group only) JID of the group to schedule the task for. Defaults to the current group.'),
    pipeline_steps: z.array(z.object({
      name: z.string().describe('Short name for this step (e.g., "reddit-discover", "deduplicate")'),
      prompt: z.string().describe('What the agent should do. Use {prev_results} for all prior outputs or {step_N_output} for specific step output.'),
      skipIf: z.string().optional().describe('JS expression evaluated against `results` string. Step is skipped if truthy. E.g., "results.trim() === \'[]\'"'),
      timeout: z.number().optional().describe('Override default container timeout for this step (ms)'),
      context_mode: z.enum(['group', 'isolated']).optional().describe('Override task-level context mode for this step'),
      parallel_group: z.string().optional().describe('Steps with same parallel_group run concurrently. Leave empty for sequential execution.'),
    })).optional().describe('Pipeline steps for multi-step tasks. Steps run sequentially by default, or concurrently when sharing a parallel_group. Prior step outputs are available via template variables.'),
  },
  async (args) => {
    // Validate schedule_value before writing IPC
    if (args.schedule_type === 'cron') {
      try {
        CronExpressionParser.parse(args.schedule_value);
      } catch {
        return {
          content: [{ type: 'text' as const, text: `Invalid cron: "${args.schedule_value}". Use format like "0 9 * * *" (daily 9am) or "*/5 * * * *" (every 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'interval') {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [{ type: 'text' as const, text: `Invalid interval: "${args.schedule_value}". Must be positive milliseconds (e.g., "300000" for 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'once') {
      if (/[Zz]$/.test(args.schedule_value) || /[+-]\d{2}:\d{2}$/.test(args.schedule_value)) {
        return {
          content: [{ type: 'text' as const, text: `Timestamp must be local time without timezone suffix. Got "${args.schedule_value}" — use format like "2026-02-01T15:30:00".` }],
          isError: true,
        };
      }
      const date = new Date(args.schedule_value);
      if (isNaN(date.getTime())) {
        return {
          content: [{ type: 'text' as const, text: `Invalid timestamp: "${args.schedule_value}". Use local time format like "2026-02-01T15:30:00".` }],
          isError: true,
        };
      }
    }

    // Non-main groups can only schedule for themselves
    const targetJid = isMain && args.target_group_jid ? args.target_group_jid : chatJid;

    const data: Record<string, unknown> = {
      type: 'schedule_task',
      prompt: args.prompt,
      schedule_type: args.schedule_type,
      schedule_value: args.schedule_value,
      context_mode: args.context_mode || 'group',
      targetJid,
      createdBy: groupFolder,
      timestamp: new Date().toISOString(),
    };

    if (args.pipeline_steps) {
      data.pipeline_steps = args.pipeline_steps;
    }

    const filename = writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Task scheduled (${filename}): ${args.schedule_type} - ${args.schedule_value}` }],
    };
  },
);

server.tool(
  'list_tasks',
  "List all scheduled tasks. From main: shows all tasks. From other groups: shows only that group's tasks.",
  {},
  async () => {
    const tasksFile = path.join(IPC_DIR, 'current_tasks.json');

    try {
      if (!fs.existsSync(tasksFile)) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const allTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));

      const tasks = isMain
        ? allTasks
        : allTasks.filter((t: { groupFolder: string }) => t.groupFolder === groupFolder);

      if (tasks.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const formatted = tasks
        .map(
          (t: { id: string; prompt: string; schedule_type: string; schedule_value: string; status: string; next_run: string }) =>
            `- [${t.id}] ${t.prompt.slice(0, 50)}... (${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`,
        )
        .join('\n');

      return { content: [{ type: 'text' as const, text: `Scheduled tasks:\n${formatted}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error reading tasks: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  },
);

server.tool(
  'pause_task',
  'Pause a scheduled task. It will not run until resumed.',
  { task_id: z.string().describe('The task ID to pause') },
  async (args) => {
    const data = {
      type: 'pause_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} pause requested.` }] };
  },
);

server.tool(
  'resume_task',
  'Resume a paused task.',
  { task_id: z.string().describe('The task ID to resume') },
  async (args) => {
    const data = {
      type: 'resume_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} resume requested.` }] };
  },
);

server.tool(
  'cancel_task',
  'Cancel and delete a scheduled task.',
  { task_id: z.string().describe('The task ID to cancel') },
  async (args) => {
    const data = {
      type: 'cancel_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} cancellation requested.` }] };
  },
);

server.tool(
  'register_group',
  `Register a new chat/group so the agent can respond to messages there. Main group only.

Use available_groups.json to find the JID for a group. The folder name must be channel-prefixed: "{channel}_{group-name}" (e.g., "whatsapp_family-chat", "telegram_dev-team", "discord_general"). Use lowercase with hyphens for the group name part.`,
  {
    jid: z.string().describe('The chat JID (e.g., "120363336345536173@g.us", "tg:-1001234567890", "dc:1234567890123456")'),
    name: z.string().describe('Display name for the group'),
    folder: z.string().describe('Channel-prefixed folder name (e.g., "whatsapp_family-chat", "telegram_dev-team")'),
    trigger: z.string().describe('Trigger word (e.g., "@Andy")'),
  },
  async (args) => {
    if (!isMain) {
      return {
        content: [{ type: 'text' as const, text: 'Only the main group can register new groups.' }],
        isError: true,
      };
    }

    const data = {
      type: 'register_group',
      jid: args.jid,
      name: args.name,
      folder: args.folder,
      trigger: args.trigger,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Group "${args.name}" registered. It will start receiving messages immediately.` }],
    };
  },
);

// --- Destination routing (main group only) ---

if (isMain) {
  server.tool(
    'set_destinations',
    `Configure named message destinations for routing output to different channels.
Each destination maps a name (e.g., "reminders", "findings") to a target JID (e.g., "tg:12345", "slack:C0123").
This persists across sessions. Use list_destinations to see current config.

JID formats:
• WhatsApp group: "120363...@g.us"
• WhatsApp DM: "1234567890@s.whatsapp.net"
• Telegram: "tg:<chat_id>"
• Slack: "slack:<channel_id>"`,
    {
      destinations: z.array(z.object({
        name: z.string().describe('Destination name (e.g., "reminders", "findings", "alerts")'),
        targetJid: z.string().describe('Target JID (e.g., "tg:12345", "slack:C0123ABC")'),
        description: z.string().optional().describe('What this destination is for'),
      })).describe('Array of named destinations'),
      target_group_jid: z.string().optional().describe('JID of the group to set destinations for. Defaults to the current group.'),
    },
    async (args) => {
      const targetJid = args.target_group_jid || chatJid;

      const data = {
        type: 'set_destinations',
        targetJid,
        destinations: args.destinations,
        groupFolder,
        timestamp: new Date().toISOString(),
      };

      const requestId = `dest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const resultDir = path.join(IPC_DIR, 'dest_results');

      writeIpcFile(TASKS_DIR, { ...data, requestId });

      // Poll for confirmation
      const resultFile = path.join(resultDir, `${requestId}.json`);
      let elapsed = 0;
      while (elapsed < 10000) {
        if (fs.existsSync(resultFile)) {
          try {
            const result = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
            fs.unlinkSync(resultFile);
            if (result.error) {
              return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
            }
            // Update local destinations.json immediately
            const destFile = path.join(IPC_DIR, 'destinations.json');
            fs.writeFileSync(destFile, JSON.stringify(args.destinations, null, 2));
            return {
              content: [{ type: 'text' as const, text: `Destinations configured for ${result.groupName || targetJid}:\n${args.destinations.map(d => `• ${d.name} → ${d.targetJid}${d.description ? ` (${d.description})` : ''}`).join('\n')}` }],
            };
          } catch (err) {
            return { content: [{ type: 'text' as const, text: `Failed to read result: ${err}` }], isError: true };
          }
        }
        await new Promise(resolve => setTimeout(resolve, 500));
        elapsed += 500;
      }

      return { content: [{ type: 'text' as const, text: 'Destination config request timed out.' }], isError: true };
    },
  );
}

// --- Google Calendar tools (only registered if credentials are mounted) ---
if (isCalendarConfigured()) {
  server.tool(
    'calendar_list_events',
    'List upcoming Google Calendar events in a date range. Returns event titles, times, attendees, and locations.',
    {
      start: z.string().describe('Start of range, ISO 8601 (e.g., "2026-02-27T00:00:00")'),
      end: z.string().describe('End of range, ISO 8601 (e.g., "2026-02-28T00:00:00")'),
      max_results: z.number().optional().describe('Max events to return (default: 20)'),
    },
    async (args) => {
      try {
        const result = await listEvents(args.start, args.end, args.max_results);
        return { content: [{ type: 'text' as const, text: result }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Calendar error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.tool(
    'calendar_create_event',
    'Create a Google Calendar event. Can include attendees (sends invites) and location.',
    {
      summary: z.string().describe('Event title'),
      start: z.string().describe('Start time, ISO 8601 (e.g., "2026-02-28T14:00:00")'),
      end: z.string().describe('End time, ISO 8601 (e.g., "2026-02-28T15:00:00")'),
      description: z.string().optional().describe('Event description/notes'),
      attendees: z.array(z.string()).optional().describe('Email addresses of attendees'),
      location: z.string().optional().describe('Event location'),
    },
    async (args) => {
      try {
        const result = await createEvent(args.summary, args.start, args.end, args.description, args.attendees, args.location);
        return { content: [{ type: 'text' as const, text: result }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Calendar error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.tool(
    'calendar_find_free_time',
    'Find available time slots on a given date. Checks your calendar and returns open slots of the requested duration.',
    {
      date: z.string().describe('Date to check, YYYY-MM-DD format (e.g., "2026-02-28")'),
      duration_minutes: z.number().optional().describe('Slot duration in minutes (default: 60)'),
      start_hour: z.number().optional().describe('Business hours start (default: 9)'),
      end_hour: z.number().optional().describe('Business hours end (default: 17)'),
    },
    async (args) => {
      try {
        const result = await findFreeTime(args.date, args.duration_minutes, args.start_hour, args.end_hour);
        return { content: [{ type: 'text' as const, text: result }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Calendar error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );
}

// --- Webhook management tools ---

server.tool(
  'enable_webhook',
  `Enable inbound webhooks for a group. Returns the webhook URL and secret for HMAC-SHA256 signing.

External services POST JSON to the webhook URL with:
- Body: { "text": "message content", "sender": "Service Name" }
- Header: X-Webhook-Signature: sha256=<hmac-of-body-with-secret>

The message gets delivered to the group's agent just like a regular chat message.`,
  {
    target_folder: z.string().optional().describe('(Main only) Group folder to enable webhooks for. Defaults to current group.'),
  },
  async (args) => {
    const targetFolder = isMain && args.target_folder ? args.target_folder : groupFolder;
    if (!isMain && targetFolder !== groupFolder) {
      return { content: [{ type: 'text' as const, text: 'Only the main group can enable webhooks for other groups.' }], isError: true };
    }

    const requestId = `wh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    writeIpcFile(TASKS_DIR, {
      type: 'enable_webhook',
      requestId,
      folder: targetFolder,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    // Poll for result
    const resultDir = path.join(IPC_DIR, 'webhook_results');
    const resultFile = path.join(resultDir, `${requestId}.json`);
    let elapsed = 0;
    while (elapsed < 10000) {
      if (fs.existsSync(resultFile)) {
        try {
          const result = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
          fs.unlinkSync(resultFile);
          return {
            content: [{
              type: 'text' as const,
              text: `Webhook enabled for "${result.groupFolder}".\n\nURL: http://<host>:9877/webhook/${result.groupFolder}\nSecret: ${result.secret}\n\nSend POST with JSON body {"text": "..."} and X-Webhook-Signature header.`,
            }],
          };
        } catch (err) {
          return { content: [{ type: 'text' as const, text: `Failed to read result: ${err}` }], isError: true };
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      elapsed += 500;
    }

    return { content: [{ type: 'text' as const, text: 'Webhook enable request timed out.' }], isError: true };
  },
);

// --- X/Twitter tools (main group only, uses IPC → host Playwright) ---

const X_RESULTS_DIR = path.join(IPC_DIR, 'x_results');

async function waitForXResult(requestId: string, maxWait = 120000): Promise<{ success: boolean; message: string }> {
  const resultFile = path.join(X_RESULTS_DIR, `${requestId}.json`);
  const pollInterval = 1000;
  let elapsed = 0;

  while (elapsed < maxWait) {
    if (fs.existsSync(resultFile)) {
      try {
        const result = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
        fs.unlinkSync(resultFile);
        return result;
      } catch (err) {
        return { success: false, message: `Failed to read result: ${err}` };
      }
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    elapsed += pollInterval;
  }

  return { success: false, message: 'Request timed out (120s)' };
}

if (isMain) {
  server.tool(
    'x_post',
    `Post a tweet to X (Twitter). Main group only.
The host machine will execute browser automation to post the tweet.
Content must be within X's 280 character limit.`,
    {
      content: z.string().max(280).describe('The tweet content to post (max 280 characters)'),
    },
    async (args) => {
      const requestId = `xpost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      writeIpcFile(TASKS_DIR, {
        type: 'x_post',
        requestId,
        content: args.content,
        groupFolder,
        timestamp: new Date().toISOString(),
      });
      const result = await waitForXResult(requestId);
      return { content: [{ type: 'text' as const, text: result.message }], isError: !result.success };
    },
  );

  server.tool(
    'x_like',
    'Like a tweet on X (Twitter). Main group only. Provide the tweet URL.',
    {
      tweet_url: z.string().describe('The tweet URL (e.g., https://x.com/user/status/123)'),
    },
    async (args) => {
      const requestId = `xlike-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      writeIpcFile(TASKS_DIR, {
        type: 'x_like',
        requestId,
        tweetUrl: args.tweet_url,
        groupFolder,
        timestamp: new Date().toISOString(),
      });
      const result = await waitForXResult(requestId);
      return { content: [{ type: 'text' as const, text: result.message }], isError: !result.success };
    },
  );

  server.tool(
    'x_reply',
    'Reply to a tweet on X (Twitter). Main group only. Provide the tweet URL and reply content.',
    {
      tweet_url: z.string().describe('The tweet URL (e.g., https://x.com/user/status/123)'),
      content: z.string().max(280).describe('The reply content (max 280 characters)'),
    },
    async (args) => {
      const requestId = `xreply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      writeIpcFile(TASKS_DIR, {
        type: 'x_reply',
        requestId,
        tweetUrl: args.tweet_url,
        content: args.content,
        groupFolder,
        timestamp: new Date().toISOString(),
      });
      const result = await waitForXResult(requestId);
      return { content: [{ type: 'text' as const, text: result.message }], isError: !result.success };
    },
  );

  server.tool(
    'x_retweet',
    'Retweet a tweet on X (Twitter). Main group only. Provide the tweet URL.',
    {
      tweet_url: z.string().describe('The tweet URL (e.g., https://x.com/user/status/123)'),
    },
    async (args) => {
      const requestId = `xretweet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      writeIpcFile(TASKS_DIR, {
        type: 'x_retweet',
        requestId,
        tweetUrl: args.tweet_url,
        groupFolder,
        timestamp: new Date().toISOString(),
      });
      const result = await waitForXResult(requestId);
      return { content: [{ type: 'text' as const, text: result.message }], isError: !result.success };
    },
  );

  server.tool(
    'x_quote',
    'Quote tweet on X (Twitter). Main group only. Retweet with your own comment.',
    {
      tweet_url: z.string().describe('The tweet URL (e.g., https://x.com/user/status/123)'),
      comment: z.string().max(280).describe('Your comment for the quote tweet (max 280 characters)'),
    },
    async (args) => {
      const requestId = `xquote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      writeIpcFile(TASKS_DIR, {
        type: 'x_quote',
        requestId,
        tweetUrl: args.tweet_url,
        comment: args.comment,
        groupFolder,
        timestamp: new Date().toISOString(),
      });
      const result = await waitForXResult(requestId);
      return { content: [{ type: 'text' as const, text: result.message }], isError: !result.success };
    },
  );
}

// Start the stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
