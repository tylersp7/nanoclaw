---
name: add-vps-health-pipeline
description: Automated VPS health monitoring pipeline. Chains Slack alerts with SSH investigation and auto-remediation. Requires Slack integration.
---

# Add VPS Health Pipeline

This skill creates a multi-step pipeline that continuously monitors your VPS by chaining Slack alert reading, SSH-based investigation, and optional auto-remediation into a single coordinated workflow.

**How it works:**

1. **Step 0 (slack-check):** Reads configured Slack channels for alert/error messages from the last check window
2. **Step 1 (classify-and-investigate):** Parses alerts, SSHs into VPS to investigate each one, classifies severity
3. **Step 2 (remediate-and-report):** Optionally auto-fixes safe issues, sends a consolidated health report via WhatsApp

The pipeline uses `follow-up-detector` signals (`AUTO_REMEDIATE`, `ACTION_NEEDED`, `ESCALATE`) so issues get tracked and escalated properly even between runs.

## Prerequisites

### 1. Check Slack Integration

First, verify Slack is configured:

```bash
ls ~/.nanoclaw-slack/slack-credentials.json 2>/dev/null && echo "Slack: configured" || echo "Slack: NOT configured"
```

If Slack is not configured, tell the user:

> Slack integration is required for the VPS Health Pipeline. It reads your VPS alert channels for issues to investigate.
>
> Would you like me to set up Slack first? I can run `/add-slack` to get that configured.

Stop here and run `/add-slack` if needed. Do not proceed without Slack.

### 2. Check VPS/SSH Configuration

Verify VPS access is configured:

```bash
ls ~/.nanoclaw-vps/config.json 2>/dev/null && echo "VPS: configured" || echo "VPS: NOT configured"
```

If VPS config exists, list available servers:

```bash
cat ~/.nanoclaw-vps/config.json | node -e "
  const data = require('fs').readFileSync('/dev/stdin','utf8');
  const config = JSON.parse(data);
  Object.entries(config.servers || {}).forEach(([id, s]) => {
    console.log('  ' + id + ': ' + s.name + ' (' + s.host + ') [' + (s.sshMode || 'standard') + ']');
  });
"
```

If VPS config is missing, tell the user:

> I need VPS SSH access configured to investigate alerts. You'll need a config file at `~/.nanoclaw-vps/config.json` with your server details.
>
> Want me to help you create one? I need:
> - Server name (e.g., "beastmode")
> - Tailscale IP or hostname
> - SSH user and key path
> - Services to monitor (e.g., docker, n8n, nginx)

### 3. Verify SSH Relay

The SSH relay must be running for containers to reach the VPS. Check:

```bash
curl -s -o /dev/null -w "%{http_code}" http://192.168.64.1:19876/ 2>/dev/null || echo "Relay not reachable (may not be running yet — it starts with NanoClaw)"
```

The relay starts automatically when NanoClaw runs. No manual setup needed unless NanoClaw is not running.

---

## Setup Steps

### Step 1: List Available Slack Channels

Use the Slack tool to show which channels are available:

```bash
/workspace/project/container/tools/slack-reader.sh list-channels
```

Or if running on the host:

```bash
node -e "
const { listChannels } = require('./dist/slack-helper.js');
listChannels().then(channels => {
  channels.filter(c => c.isMember).forEach(c => console.log('  #' + c.name));
}).catch(err => console.error(err.message));
"
```

### Step 2: Ask User About Alert Channels

Ask the user:

> Which Slack channels should I monitor for VPS alerts? Here are the channels the bot has access to:
>
> [list channels from above]
>
> **Common choices:**
> - `#beastmode-alerts` - VPS system alerts
> - `#bugbounty` - Security scan results
> - `#asm-alerts` - Attack surface monitoring
>
> You can pick multiple channels. I'll check all of them each pipeline run.

Store the user's channel list for the pipeline prompt.

### Step 3: Ask About VPS Server Target

If there are multiple servers in the VPS config, ask:

> Which VPS server should I investigate when alerts come in?
>
> [list servers from config]
>
> Default: **beastmode**

If only one server, use that one automatically.

### Step 4: Ask About Remediation Preferences

Ask the user:

> How aggressive should auto-remediation be?
>
> **Option 1: Notify Only** (safest)
> - Investigate and classify issues via SSH
> - Send you a report with findings and recommended actions
> - Never take automatic action
>
> **Option 2: Safe Auto-Fix** (recommended)
> - Automatically restart crashed Docker containers
> - Automatically clear temp files / rotate logs when disk is high
> - Automatically restart failed systemd services
> - Notify you of what was fixed and what needs manual attention
>
> **Option 3: Aggressive Auto-Fix**
> - Everything in Option 2, plus:
> - Kill runaway processes using excessive CPU/memory
> - Prune unused Docker images/volumes
> - Force-restart services that are degraded but not fully down
> - Notify you after the fact

Store the user's choice as a remediation level: `notify-only`, `safe-auto-fix`, or `aggressive-auto-fix`.

### Step 5: Ask About Schedule

Ask the user:

> How often should the health pipeline run?
>
> - **Every 4 hours** (recommended — `0 */4 * * *`)
> - **Every 2 hours** (more aggressive — `0 */2 * * *`)
> - **Every hour** (high-frequency — `0 * * * *`)
> - **3x daily** at 8am, 2pm, 8pm — `0 8,14,20 * * *`
> - **Custom cron expression**

### Step 6: Create the Pipeline Task

Use the `schedule_task` tool. Substitute the user's channel list, server name, remediation level, and schedule into the pipeline below.

**Important template variables:**
- `CHANNELS_LIST` — comma-separated channel names the user chose (e.g., `beastmode-alerts,bugbounty`)
- `SERVER_NAME` — VPS server identifier from config (e.g., `beastmode`)
- `REMEDIATION_LEVEL` — one of `notify-only`, `safe-auto-fix`, `aggressive-auto-fix`
- `SCHEDULE` — cron expression the user chose

```
schedule_task({
  prompt: "VPS Health Pipeline: Check Slack alerts, investigate via SSH, remediate and report.",
  schedule_type: "cron",
  schedule_value: "SCHEDULE",
  context_mode: "isolated",
  pipeline_steps: [
    {
      "name": "slack-check",
      "prompt": "You are a VPS alert scanner. Your job is to check Slack channels for alerts and errors.\n\nCheck these Slack channels for alert messages from the last 4 hours: CHANNELS_LIST\n\nFor each channel, use the slack-reader tool:\n```bash\n/workspace/project/container/tools/slack-reader.sh filter-critical CHANNEL_NAME 100\n```\n\nAlso read the full recent history to catch warnings the filter might miss:\n```bash\n/workspace/project/container/tools/slack-reader.sh read-channel CHANNEL_NAME 50\n```\n\nScan all messages for these severity keywords:\n- CRITICAL: critical, fatal, emergency, panic, OOM, out of memory\n- HIGH: error, failed, failure, down, unreachable, refused, timeout, denied\n- MEDIUM: warning, degraded, high usage, disk space, slow, retry, restarting\n- LOW: notice, info, completed, recovered, resolved\n\nOutput a JSON array of alerts found. Each alert object must have:\n{\n  \"channel\": \"channel-name\",\n  \"message\": \"the alert text (first 300 chars)\",\n  \"severity\": \"critical|high|medium|low\",\n  \"timestamp\": \"message timestamp\",\n  \"keywords_matched\": [\"list\", \"of\", \"matched\", \"keywords\"]\n}\n\nIf no alerts are found in any channel, output exactly: []\n\nDo NOT use send_message. Only output the JSON array. Wrap any diagnostic commentary in <internal> tags.",
      "context_mode": "isolated"
    },
    {
      "name": "classify-and-investigate",
      "prompt": "You are a VPS health investigator. You have SSH access to the VPS via the SSH relay.\n\nHere are the alerts found by the Slack scanner:\n\n{prev_results}\n\nFor each alert with severity medium or higher, investigate via SSH. The VPS server name is SERVER_NAME.\n\nUse the SSH relay to run diagnostic commands:\n```bash\ncurl -s -X POST http://$SSH_RELAY_URL/exec \\\n  -H 'Content-Type: application/json' \\\n  -H \"Authorization: Bearer $SSH_RELAY_SECRET\" \\\n  -d '{\"serverName\": \"SERVER_NAME\", \"command\": \"YOUR_COMMAND_HERE\"}'\n```\n\nInvestigation commands to use based on alert type:\n- Container/service down: `docker ps -a --filter name=CONTAINER` and `docker logs --tail 50 CONTAINER 2>&1`\n- Disk space: `df -h` and `du -sh /var/log/* 2>/dev/null | sort -rh | head -10`\n- Memory/OOM: `free -m` and `dmesg | grep -i oom | tail -5`\n- CPU: `top -bn1 | head -20` or `ps aux --sort=-%cpu | head -10`\n- Service failure: `systemctl status SERVICE` and `journalctl -u SERVICE --since '4 hours ago' --no-pager | tail -30`\n- General: `uptime` and `journalctl -p err --since '4 hours ago' --no-pager | tail -20`\n\nFor each alert, produce a classification object:\n{\n  \"alert\": \"original alert summary\",\n  \"severity\": \"critical|high|medium|low\",\n  \"category\": \"container-down|disk-space|memory|cpu|service-failure|network|security|other\",\n  \"investigation_results\": \"what you found via SSH\",\n  \"recommended_action\": \"what should be done\",\n  \"auto_fixable\": true/false,\n  \"fix_command\": \"command to fix if auto_fixable (or null)\"\n}\n\nAfter outputting the classifications JSON array, emit follow-up signals:\n\n- For critical/high severity issues that ARE auto-fixable:\n  AUTO_REMEDIATE: [brief description of issue and fix]\n\n- For critical/high severity issues that are NOT auto-fixable:\n  ACTION_NEEDED: [brief description of issue]\n\n- For any critical security issues:\n  ESCALATE: [description]\n\nDo NOT use send_message in this step. Wrap verbose SSH output in <internal> tags.\nOutput the JSON array of classifications followed by any signals.",
      "skipIf": "results.trim() === '[]'",
      "context_mode": "isolated"
    },
    {
      "name": "remediate-and-report",
      "prompt": "You are the VPS health remediation and reporting agent.\n\nRemediation level: REMEDIATION_LEVEL\nVPS server: SERVER_NAME\n\nHere are the investigation results from the previous steps:\n\n{prev_results}\n\n## Remediation\n\nIf remediation level is 'notify-only':\n- Do NOT execute any fixes. Skip to the Report section.\n\nIf remediation level is 'safe-auto-fix':\n- For each item where auto_fixable is true, execute the fix via SSH relay:\n  ```bash\n  curl -s -X POST http://$SSH_RELAY_URL/exec \\\n    -H 'Content-Type: application/json' \\\n    -H \"Authorization: Bearer $SSH_RELAY_SECRET\" \\\n    -d '{\"serverName\": \"SERVER_NAME\", \"command\": \"FIX_COMMAND\"}'\n  ```\n- Safe fixes include: `docker restart CONTAINER`, `journalctl --vacuum-size=500M`, `rm -rf /tmp/old-files`, `systemctl restart SERVICE`\n- Do NOT run: kill -9, docker system prune, rm -rf on data dirs, or anything destructive\n- After each fix, verify it worked (e.g., check container is running, disk freed)\n\nIf remediation level is 'aggressive-auto-fix':\n- Everything in safe-auto-fix, plus:\n- Kill runaway processes: `kill -9 PID` for processes using >80% CPU for extended time\n- Prune Docker: `docker system prune -f` (without volumes)\n- Force restart degraded services\n\n## Report\n\nSend a consolidated health report via send_message. Format:\n\n```\nVPS Health Report - SERVER_NAME\nTIMESTAMP\n\n[For each issue found, one line each:]\nSEVERITY_ICON CATEGORY: Brief description - STATUS\n\nSeverity icons:\n  CRITICAL -> use word CRITICAL\n  HIGH -> use word HIGH  \n  MEDIUM -> use word MEDIUM\n  LOW -> use word LOW\n\nStatus values:\n  Fixed automatically\n  Needs attention\n  Monitoring\n  Resolved (was already recovered)\n\n---\nSummary: X issues found, Y auto-fixed, Z need attention\nNext check: [based on schedule]\n```\n\nIf NO issues were found (all steps returned empty), send a brief all-clear:\n```\nVPS Health Check - SERVER_NAME - All Clear\nNo alerts or issues detected in the last check window.\n```\n\nWrap any verbose diagnostic output in <internal> tags. Keep the user-facing message concise and actionable.",
      "skipIf": "results.trim() === '[]'",
      "context_mode": "isolated"
    }
  ]
})
```

**Before calling schedule_task**, replace all template variables:
- Replace every `CHANNELS_LIST` with the user's chosen channels (e.g., `beastmode-alerts,bugbounty,asm-alerts`). In the slack-check step, expand this into individual `slack-reader.sh` commands for each channel.
- Replace every `SERVER_NAME` with the server identifier from `~/.nanoclaw-vps/config.json` (e.g., `beastmode`)
- Replace every `REMEDIATION_LEVEL` with the user's choice
- Replace `SCHEDULE` with the user's chosen cron expression
- Adjust the "last 4 hours" window in the slack-check prompt to match the schedule interval (e.g., if running every 2 hours, say "last 2 hours")

### Step 7: Confirm Setup

Tell the user:

> VPS Health Pipeline is set up! Here's the configuration:
>
> **Schedule:** [cron expression in human-readable form]
> **Monitored channels:** [list channels]
> **Target VPS:** [server name]
> **Remediation level:** [their choice]
>
> **What happens each run:**
> 1. Reads [channels] for alerts/errors since last check
> 2. If alerts found, SSHs into [server] to investigate each one
> 3. Classifies severity and determines if auto-fixable
> 4. [Based on remediation level: "Sends you a report with findings and recommendations" / "Auto-fixes safe issues (container restarts, log rotation, disk cleanup) and reports what was done" / "Aggressively auto-fixes issues and reports after the fact"]
> 5. Sends a consolidated report via WhatsApp
>
> **Follow-up signals:**
> - Critical issues trigger `ESCALATE` for immediate notification
> - Actionable issues trigger `ACTION_NEEDED` for investigation
> - Auto-fixable issues trigger `AUTO_REMEDIATE` for automated resolution
>
> **Example notification:**
> ```
> VPS Health Report - BeastMode
> Feb 15, 2026 2:00 PM
>
> CRITICAL container-down: n8n container exited (OOM killed) - Fixed automatically
> HIGH disk-space: /var at 91% usage - Fixed automatically (cleared 2.1GB logs)
> MEDIUM cpu: Load average 4.2 on 2 cores - Monitoring
>
> ---
> Summary: 3 issues found, 2 auto-fixed, 1 monitoring
> Next check: 6:00 PM
> ```
>
> **Management commands:**
> - `list_tasks` - See the pipeline task and its status
> - `pause_task <task_id>` - Pause the pipeline
> - `resume_task <task_id>` - Resume the pipeline
> - `cancel_task <task_id>` - Remove the pipeline

### Step 8: Offer Test Run

Ask the user:

> Want me to trigger a test run now? I'll create a one-time pipeline execution to verify everything works end-to-end.

If yes, create the same pipeline with `schedule_type: "once"` and `schedule_value` set to 1 minute from now (use ISO timestamp format).

---

## Troubleshooting

### SSH Relay Not Available

If the relay at `192.168.64.1:19876` is not reachable from within the container:
- NanoClaw must be running (relay starts with it)
- The `SSH_RELAY_URL` and `SSH_RELAY_SECRET` env vars are injected automatically by container-runner
- Check that the bridge100 interface exists: `ifconfig bridge100` on the host

### Slack Returns No Messages

- Verify the bot is invited to the channels: `/invite @NanoClaw` in each Slack channel
- Check credentials: `cat ~/.nanoclaw-slack/slack-credentials.json`
- Test manually: `slack-reader.sh read-channel beastmode-alerts 10`

### SSH Commands Fail

- For Tailscale-mode servers, SSH goes through the relay (containers can't reach 100.x.x.x IPs directly)
- The relay uses the host's Tailscale connection, which must be active
- Test: `ssh root@100.113.34.39 uptime` from the host machine

### Pipeline Step Fails

- Pipeline state is saved between steps — if step 1 fails, it resumes from step 1 on next run
- Check pipeline logs: query `pipeline_run_logs` table in the SQLite database
- A stale pipeline (crashed mid-run) is automatically detected and resumed after 2x container timeout

### All-Clear Reports Are Noisy

If you're getting too many "All Clear" messages, the step 2 and 3 `skipIf` conditions handle this — when step 0 returns `[]`, steps 1 and 2 are skipped entirely, and no message is sent. If you still want an all-clear message on every run, remove the `skipIf` from step 2.

---

## Customization

### Adding More Channels Later

To add more Slack channels, update the pipeline task prompt. Use `list_tasks` to find the task ID, then `cancel_task` and recreate with the updated channel list.

### Changing Remediation Level

Cancel the existing pipeline task and recreate it with a different remediation level. The pipeline definition lives in the task's `pipeline_steps` field.

### Combining with Lead Pipeline

This pipeline runs independently from the Lead Pipeline Supervisor. They use separate schedules and don't interfere with each other. Both pipelines use `context_mode: "isolated"` so each step gets a clean container.

### Custom Alert Keywords

The severity keywords in step 0 can be customized. Edit the slack-check step prompt to add domain-specific keywords (e.g., "nuclei", "subfinder", "amass" for security scanning tools).

---

## Success Criteria

- Slack integration verified and channels accessible
- VPS SSH access confirmed (via relay for Tailscale servers)
- Pipeline task created with correct schedule
- Test run completes all 3 steps without errors
- Health report delivered via WhatsApp
- Follow-up signals (AUTO_REMEDIATE, ACTION_NEEDED) trigger correctly
- Auto-remediation executes fixes when enabled (verify with a known-fixable issue)
