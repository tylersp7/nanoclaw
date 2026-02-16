/**
 * Follow-up Detector
 * Scans agent output for structured signals and queues follow-up actions.
 *
 * Signal formats agents can emit:
 *   <signal type="LEAD_FOUND">{"title": "...", "score": 8, "source": "reddit"}</signal>
 *   ACTION_NEEDED: disk space at 92%
 *   AUTO_REMEDIATE: container n8n exited unexpectedly
 *   ESCALATE: critical security issue detected
 */
import { queueFollowUp } from './db.js';
import { logger } from './logger.js';
import { FollowUpAction, ScheduledTask } from './types.js';

const FOLLOW_UP_ACTIONS: FollowUpAction[] = [
  {
    signal: 'LEAD_FOUND',
    pattern: /<signal type="LEAD_FOUND">([\s\S]*?)<\/signal>/g,
    buildPrompt: (match: RegExpMatchArray) => {
      const data = match[1];
      return `A lead was found by a monitor task. Here is the lead data:

${data}

Your job:
1. Parse the lead data
2. If the lead score is >= 7, generate a tailored proposal draft
3. Add the lead to the CRM (use the CRM tools available)
4. Use send_message to notify with a summary including: source, title, score, and whether a proposal was generated

Keep the notification concise. Use <internal> tags for any verbose analysis.`;
    },
  },
  {
    signal: 'AUTO_REMEDIATE',
    pattern: /AUTO_REMEDIATE:\s*(.+?)(?:\n|$)/g,
    buildPrompt: (match: RegExpMatchArray) => {
      const issue = match[1].trim();
      return `An automated remediation was requested for: ${issue}

Your job:
1. Investigate the issue using available tools (SSH, logs, etc.)
2. Attempt to fix the issue automatically
3. If you can't fix it, escalate by using send_message to notify the user
4. Report what you did and the outcome via send_message

Wrap diagnostic output in <internal> tags. Only send the final status to the user.`;
    },
  },
  {
    signal: 'ACTION_NEEDED',
    pattern: /ACTION_NEEDED:\s*(.+?)(?:\n|$)/g,
    buildPrompt: (match: RegExpMatchArray) => {
      const issue = match[1].trim();
      return `An issue was detected that needs attention: ${issue}

Your job:
1. Investigate the issue
2. Determine severity (low/medium/high/critical)
3. If severity is high or critical, send an urgent notification via send_message
4. Otherwise, send a brief informational notification
5. Suggest remediation steps in the notification`;
    },
  },
  {
    signal: 'ESCALATE',
    pattern: /ESCALATE:\s*(.+?)(?:\n|$)/g,
    buildPrompt: (match: RegExpMatchArray) => {
      const issue = match[1].trim();
      return `URGENT ESCALATION: ${issue}

Your job:
1. Send an immediate notification via send_message with the full details
2. Prefix the message with "URGENT:" so it stands out
3. Include any available context about the issue
4. Suggest immediate actions the user should take`;
    },
  },
];

export function detectAndQueueFollowUps(
  output: string,
  task: ScheduledTask,
): number {
  if (!output) return 0;

  let queued = 0;

  for (const action of FOLLOW_UP_ACTIONS) {
    // Reset regex state for each action (global flag)
    action.pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = action.pattern.exec(output)) !== null) {
      const prompt = action.buildPrompt(match, output);

      queueFollowUp({
        source_task_id: task.id,
        group_folder: task.group_folder,
        chat_jid: task.chat_jid,
        signal: action.signal,
        prompt,
        context: match[0].slice(0, 500), // Store matched text for debugging
        created_at: new Date().toISOString(),
      });

      queued++;
      logger.info(
        { taskId: task.id, signal: action.signal },
        'Follow-up queued from signal',
      );
    }
  }

  return queued;
}
