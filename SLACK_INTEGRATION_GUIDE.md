# Slack Integration for Andy - Quick Guide

**Status:** Skill created, ready to install
**Location:** `.claude/skills/add-slack/SKILL.md`

---

## 🚀 Quick Start

### 1. Install the Skill

Open Claude Code in the nanoclaw directory and run:

```
/add-slack
```

Claude will guide you through:
- Creating a Slack app in your workspace
- Choosing integration mode (Tool/Monitor/Interactive)
- Installing dependencies
- Setting up credentials
- Testing the connection

### 2. Choose Your Mode

**Tool Mode** (Recommended Start)
- Read Slack on-demand from WhatsApp
- No automated polling
- Example: `@Andy check #bugbounty for critical findings`

**Monitor Mode** (Best for VPS)
- Everything in Tool Mode + automated checking
- Schedule Andy to monitor channels
- Get WhatsApp alerts for important events

**Interactive Mode** (Full Control)
- Everything in Monitor Mode + posting
- Andy can post messages to Slack
- Can react with emojis, create threads

---

## 📱 Example Commands for Andy

### Basic Reading

```
@Andy list all Slack channels

@Andy check #bugbounty and show me the last 10 messages

@Andy read #beastmode-alerts from the past 2 hours

@Andy search for "critical" in #bugbounty
```

### VPS Monitoring Tasks

```
@Andy every 2 hours, check #bugbounty for critical or high severity findings and alert me if any are found

@Andy every day at 6pm, summarize all activity in #beastmode-alerts since 8am

@Andy every Monday at 9am, check #bugbounty for weekend activity and send me a summary

@Andy when you see "error" or "failed" in #beastmode-alerts, alert me immediately with details
```

### Advanced Monitoring

```
@Andy every 4 hours, check #bugbounty, #beastmode-alerts, and #asm-alerts. Filter for messages containing "critical", "error", or "failed" and send me a summary if anything important happened.

@Andy every day at 7am, create a security briefing from all VPS-related Slack channels (bugbounty, beastmode-alerts, asm-alerts) covering the past 24 hours. Include: new findings, error count, and any actions needed.
```

---

## 🎯 Recommended Setup for VPS Monitoring

After installing the skill, send these tasks to Andy:

### 1. Critical Findings Alert (Real-time)
```
@Andy every hour, check #bugbounty for any messages containing "critical" or "high" from the past hour. If found, alert me immediately with the finding details.
```

### 2. Error Monitor (Frequent)
```
@Andy every 30 minutes, check #beastmode-alerts for messages containing "error", "failed", or "exception" from the past 30 minutes. Alert me if any are found.
```

### 3. Daily Security Digest (Morning Brief)
```
@Andy every weekday at 8am, summarize activity from #bugbounty, #beastmode-alerts, and #asm-alerts from the past 24 hours. Include counts of findings by severity and any critical items that need attention.
```

### 4. Weekend Coverage (Monday Catchup)
```
@Andy every Monday at 9am, check all VPS Slack channels for activity since Friday 5pm. Give me a comprehensive weekend summary so I'm caught up.
```

### 5. ASM Alert Monitor (Periodic)
```
@Andy every 6 hours, check #asm-alerts for any new attack surface discoveries. If found, summarize what was discovered and whether it needs investigation.
```

---

## 🛠️ Technical Details

### How It Works

1. **Slack Bot** - NanoClaw app installed in your workspace
2. **OAuth Token** - Stored in `~/.nanoclaw-slack/slack-credentials.json`
3. **Container Access** - Andy can call Slack API from within containers
4. **Message Tracking** - Timestamps stored to avoid duplicate alerts

### Files Created

- `src/slack-helper.ts` - Slack API wrapper
- `container/tools/slack-reader.sh` - CLI tool for agents
- `~/.nanoclaw-slack/slack-credentials.json` - Credentials (secure)

### Permissions Required

**Minimum (Tool Mode):**
- `channels:history` - Read public channel messages
- `channels:read` - View channel info
- `users:read` - Get user names

**Monitor Mode adds:**
- `chat:write` - Send alerts/summaries

**Interactive Mode adds:**
- `reactions:write` - Add emoji reactions
- `reactions:read` - View reactions

---

## 🔐 Security Notes

- Bot token stored locally (never in code)
- Read-only by default (Tool Mode)
- Writing requires explicit mode selection
- Per-channel access controlled by Slack
- No message storage (read on-demand only)

---

## 🐛 Troubleshooting

### "Channel not found"
→ Invite bot to channel: `/invite @NanoClaw`

### "Missing scope" error
→ Go to Slack App settings → OAuth & Permissions → Add scope → Reinstall

### Messages not loading
→ Check bot is member of channel: `@Andy list Slack channels`

### Old messages appearing
→ Timestamps tracked automatically; check task definition

---

## 📊 Integration with VPS Systems

### BeastMode VPS
- Monitors: `#bugbounty`, `#beastmode-alerts`, `#asm-alerts`
- Findings posted automatically by BeastMode Python scripts
- Andy reads and summarizes for you

### Auto Blogger VPS
- Can add Slack notifications to blogger (optional)
- Monitor: `#auto-blogger-alerts` (if configured)
- Content publishing notifications

### Combined Monitoring
- Andy correlates events across both VPSes
- Cross-references Slack alerts with SSH checks
- Single WhatsApp interface for all monitoring

---

## 🎨 Customization Examples

### Filter by Severity

```
@Andy check #bugbounty and only show me critical and high severity findings
```

Implementation: Uses `filterBySeverity()` helper

### Trend Analysis

```
@Andy compare activity in #bugbounty from this week vs last week
```

Implementation: Andy reads messages from both periods and compares

### Smart Alerts

```
@Andy monitor #beastmode-alerts, but only alert me if the same error appears 3+ times in an hour (indicates a real problem, not a transient issue)
```

Implementation: Andy tracks error patterns before alerting

---

## 📈 Next Steps

1. **Install**: Run `/add-slack` in Claude Code
2. **Test**: Try basic read commands
3. **Schedule**: Set up 2-3 monitoring tasks
4. **Refine**: Adjust based on alert volume
5. **Expand**: Add more channels as needed

---

## 🔗 Related Documentation

- **NanoClaw Skills**: `.claude/skills/*/SKILL.md`
- **Andy VPS Tasks**: `ANDY_VPS_TASKS.md`
- **BeastMode Slack**: `vps_bugbounty/helpers/slack_helper.py`
- **Slack API**: https://api.slack.com/docs

---

**Ready to connect Andy to Slack?** Run `/add-slack` now! 🚀
