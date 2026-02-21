---
name: add-life-system
description: "Personal life operating system: daily accountability via WhatsApp (morning briefings, evening reflections, inbox capture, goal tracking) plus deep work reminders for SSH terminal sessions. Inspired by Carmack's .plan files and Franklin's systematic self-improvement."
---

# Add Life System

This skill sets up a personal accountability loop via WhatsApp, integrated with a plain-text life system at `~/Documents/tyler/`.

**Two modes:**
- **WhatsApp (Andy):** Daily briefings, evening reflections, quick inbox capture, goal nudges
- **SSH Terminal (Claude Code):** Deep interactive planning, morning routine, life plan updates, decision making

Andy handles the daily rhythm. Deep work happens in focused terminal sessions.

## Setup

### 1. Check Life System Files

Verify the life system directory exists on the host:

```bash
ls /workspace/project/../../../Documents/tyler/plan.md 2>/dev/null && echo "Life system: found" || echo "Life system: NOT found"
```

If not found, tell the user:

> The life system files need to be set up at ~/Documents/tyler/ on the host.
> Clone from: https://github.com/davidhariri/life-system
> Then customize plan.md, values.md, and goals.md with your own content.

### 2. Check If Templates Are Filled In

Read `plan.md` and check if it still has placeholder text:

```bash
cat /workspace/group/life-system/plan.md 2>/dev/null | head -20
```

If it's still template placeholders, tell the user:

> Your life plan still has placeholder text. Before we set up the daily loop, I'd recommend a deep work session to fill in:
>
> 1. `plan.md` — Your life chapters, 10-year vision, critical aspects
> 2. `reference/values.md` — Your mission, core values, principles
> 3. `journal/2026/goals.md` — Annual goals and theme
>
> SSH into your machine and run `cd ~/Documents/tyler && claude` for an interactive planning session. Say "morning" to start the full routine.
>
> Want me to set up the daily accountability tasks now anyway, or wait until the deep work is done?

### 3. Create Symlink in Group Directory

Create a symlink so Andy can access the life system files:

```bash
# The life system directory should be mounted or symlinked
ls /workspace/group/life-system/ 2>/dev/null || echo "Need to mount life-system"
```

**Important:** Tell the user they need to add the life system as an additional mount for the main group. This requires editing the registered group config to add:

```json
{
  "containerConfig": {
    "additionalMounts": [
      {
        "hostPath": "~/Documents/tyler",
        "containerPath": "life-system",
        "readonly": false
      }
    ]
  }
}
```

Write this update to the registered groups. The life system directory will appear at `/workspace/extra/life-system/` inside the container.

Also add the path to the host mount allowlist at `~/.config/nanoclaw/mount-allowlist.json`:

```bash
# Read current allowlist, add life-system path
```

### 4. Create Journal Helper

Create a daily journal creation script in the group directory:

```bash
cat > /workspace/group/create-journal.sh << 'SCRIPT'
#!/bin/bash
# Create today's journal entry from template if it doesn't exist
LIFE_DIR="${1:-/workspace/extra/life-system}"
TODAY=$(date +%Y-%m-%d)
YEAR=$(date +%Y)
MONTH=$(date +%m)
JOURNAL_DIR="$LIFE_DIR/journal/$YEAR/$MONTH"
JOURNAL_FILE="$JOURNAL_DIR/$TODAY.md"

if [ -f "$JOURNAL_FILE" ]; then
  echo "Journal already exists: $JOURNAL_FILE"
  cat "$JOURNAL_FILE"
  exit 0
fi

mkdir -p "$JOURNAL_DIR"

# Create annual goals file if it doesn't exist
GOALS_FILE="$LIFE_DIR/journal/$YEAR/goals.md"
if [ ! -f "$GOALS_FILE" ]; then
  cat > "$GOALS_FILE" << 'EOF'
# 2026 Goals

## Theme
_One word or phrase for the year._

## Annual Goals
- [ ] Goal 1
- [ ] Goal 2
- [ ] Goal 3

## Anti-Goals
_What I'm deliberately NOT doing this year._
-

## Becoming
_Who am I becoming this year?_
EOF
  echo "Created annual goals: $GOALS_FILE"
fi

# Carry forward incomplete todos from yesterday
YESTERDAY=$(date -v-1d +%Y-%m-%d 2>/dev/null || date -d "yesterday" +%Y-%m-%d)
YESTERDAY_FILE="$LIFE_DIR/journal/$(date -v-1d +%Y/%m 2>/dev/null || date -d yesterday +%Y/%m)/$YESTERDAY.md"
CARRIED=""
if [ -f "$YESTERDAY_FILE" ]; then
  CARRIED=$(grep '^\- \[ \]' "$YESTERDAY_FILE" | head -5)
fi

# Create from template
cat > "$JOURNAL_FILE" << EOF
# $TODAY

## Morning (Franklin: "What good shall I do this day?")
$CARRIED
- [ ]

## Log
-

## Evening (Franklin: "What good have I done today?")

EOF

echo "Created journal: $JOURNAL_FILE"
cat "$JOURNAL_FILE"
SCRIPT
chmod +x /workspace/group/create-journal.sh
```

### 5. Create Scheduled Tasks

#### Afternoon Briefing (Daily, 2:30 PM)

```
schedule_task({
  "schedule_type": "cron",
  "schedule_value": "30 14 * * *",
  "prompt": "Morning briefing for the life system.\n\n1. Run /workspace/group/create-journal.sh /workspace/extra/life-system to ensure today's journal exists.\n2. Read yesterday's journal entry from /workspace/extra/life-system/journal/ (calculate yesterday's date, find the file).\n3. Read today's journal entry.\n4. Read the annual goals from /workspace/extra/life-system/journal/2026/goals.md.\n5. Read the inbox from /workspace/extra/life-system/inbox.md.\n6. Send a morning briefing via send_message with:\n   - Quick summary of yesterday (what got done, what didn't)\n   - Today's carried-forward todos\n   - Any inbox items that need attention\n   - Which annual goals haven't had activity recently\n   - Franklin's question: 'What good shall you do this day?'\n   - Keep it concise — this is a WhatsApp message, not a planning session.\n7. If there are more than 3 incomplete carried-forward items, flag it: 'You have X items piling up. Time to prune or do a deep work session.'"
})
```

#### Evening Reflection (Daily, 8:30 PM)

```
schedule_task({
  "schedule_type": "cron",
  "schedule_value": "30 20 * * *",
  "prompt": "Evening reflection for the life system.\n\n1. Read today's journal from /workspace/extra/life-system/journal/ (calculate today's date).\n2. Read the annual goals from /workspace/extra/life-system/journal/2026/goals.md.\n3. Check how many morning todos were completed vs incomplete.\n4. Send an evening message via send_message with:\n   - Franklin's question: 'What good have you done today?'\n   - Brief summary of what was logged today\n   - Completion rate on morning priorities\n   - If completion rate < 50%, gentle nudge: 'Tough day or overcommitted this morning?'\n   - One sentence connecting today to an annual goal (or noting disconnection)\n   - Keep it short and reflective, not judgmental."
})
```

#### Deep Work Reminder (Weekly, Sunday 7 PM)

```
schedule_task({
  "schedule_type": "cron",
  "schedule_value": "0 19 * * 0",
  "prompt": "Weekly deep work reminder for the life system.\n\n1. Read the annual goals from /workspace/extra/life-system/journal/2026/goals.md.\n2. Read this week's journal entries (Monday through Sunday) from /workspace/extra/life-system/journal/.\n3. Check the life plan from /workspace/extra/life-system/plan.md.\n4. Check for open decisions in /workspace/extra/life-system/decisions/.\n5. Send a message via send_message with:\n   - 'Weekly Planning Reminder'\n   - Summary of the week: how many days had journal entries, completion patterns\n   - Which annual goals got attention this week and which didn't\n   - Any open decisions that need resolution\n   - A nudge: 'SSH into your machine and run the /morning routine for a deeper planning session. Start of the week is a great time to recalibrate.'\n   - Command reminder: ssh [host] → cd ~/Documents/tyler → claude → say 'morning'\n6. If the life plan still has placeholder text, add: 'Your life plan still has placeholders. A 30-minute deep work session to fill it in would make these weekly check-ins much more powerful.'"
})
```

#### Monthly Review Reminder (1st of each month, 10 AM)

```
schedule_task({
  "schedule_type": "cron",
  "schedule_value": "0 10 1 * *",
  "prompt": "Monthly review reminder for the life system.\n\n1. Read the annual goals.\n2. Read the life plan.\n3. Scan all journal entries from last month.\n4. Send a message via send_message:\n   - 'Monthly Review Time'\n   - Progress on each annual goal (any completed? any stalled?)\n   - Patterns from journal: what kept coming up? what was avoided?\n   - 'This is a great time for a deep work session to review and adjust your goals.'\n   - 'SSH in: cd ~/Documents/tyler && claude → \"let\\'s do a monthly review\"'\n   - If any goals look abandoned (no activity in 2+ weeks), flag them specifically."
})
```

### 6. Update Group CLAUDE.md

Add this section to the group's CLAUDE.md:

```markdown
## Life System

Tyler uses a plain-text life operating system at `/workspace/extra/life-system/`. Structure:

- `plan.md` — 10-year life vision, life chapters, fears, relationships
- `journal/2026/goals.md` — Annual goals with theme
- `journal/2026/MM/YYYY-MM-DD.md` — Daily entries
- `inbox.md` — Quick capture (todos, ideas, someday items)
- `decisions/` — Structured decision records
- `people/` — Notes on individuals
- `research/` — Deep dive research docs
- `reference/values.md` — Mission, core values, principles
- `reference/habits.md` — Daily schedule, routines

**Your role:** Daily accountability partner via WhatsApp.
- Morning: send briefing with yesterday's recap, today's priorities, goal alignment
- Evening: send reflection prompt with completion check
- Anytime: capture inbox items when Tyler says "add to inbox: ..."
- When Tyler mentions a person, check `people/` for notes

**Inbox capture:** When Tyler says "add to inbox" or "remind me to" or "todo:", append to `/workspace/extra/life-system/inbox.md` with a timestamp.

**Journal logging:** When Tyler reports something noteworthy during the day, append a timestamped entry to today's journal Log section.

**Deep work nudges:** For complex planning, goal-setting, or decision-making, remind Tyler to SSH in for an interactive Claude Code session rather than trying to do it over WhatsApp.

**Wiki-links:** Files use `[[name]]` links. When you see one, search people/, research/, decisions/ for the matching .md file.
```

## Verification

Tell the user:

> Life system integration is set up! Here's what's active:
>
> *Daily Loop (WhatsApp):*
> - 7:30 AM — Morning briefing (yesterday's recap, today's priorities, goal check)
> - 8:30 PM — Evening reflection (Franklin's question, completion rate)
> - Anytime — Say "add to inbox: [thing]" and I'll capture it
>
> *Deep Work Reminders:*
> - Sundays 7 PM — Weekly planning nudge (SSH for /morning routine)
> - 1st of month — Monthly review reminder
>
> *Deep Work (SSH Terminal):*
> - `ssh [your-host]`
> - `cd ~/Documents/tyler && claude`
> - Say "morning" for the full interactive routine
>
> The daily WhatsApp loop keeps you accountable. The deep work sessions are where real planning happens. Both read the same files.
>
> Want me to run a test morning briefing now?
