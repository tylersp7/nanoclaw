---
name: add-client-followup
description: Automated client follow-up system. Reads CRM tracking files, identifies leads needing follow-up based on timing rules, drafts personalized follow-up messages, and notifies you of pending actions.
---

# Add Client Follow-up Task

This skill sets up an automated follow-up system that monitors your CRM, identifies leads and clients that need attention, and drafts personalized follow-up messages for your review.

## What It Does

- Reads `/workspace/crm/leads.json` on a schedule (default: daily at 10am)
- Identifies leads that were contacted 3+ days ago with no response
- Flags proposals sent 7+ days ago that haven't been accepted
- Catches active projects approaching deadlines
- Drafts follow-up messages using templates and conversation context
- Notifies you with a summary of pending follow-ups
- Stores drafts in `/workspace/crm/follow-ups/` for review before sending

## How It Integrates

Leads found by monitors (Reddit, HN, GitHub, n8n) emit `<signal type="LEAD_FOUND">` tags. Those leads should be added to `/workspace/crm/leads.json` by the lead pipeline or manually. This follow-up task picks up from there, ensuring no lead falls through the cracks.

---

## Setup Steps

### Step 1: Explain the Concept

Tell the user:

> I'll set up an automated follow-up system for your leads and clients. Here's what it does:
>
> **Monitors your CRM and identifies:**
> - Leads contacted 3+ days ago with no response (gentle check-in)
> - Proposals sent 7+ days ago without acceptance (add value, address concerns)
> - Active projects approaching deadlines (proactive update)
>
> **For each, it will:**
> - Draft a personalized follow-up message using templates
> - Save drafts to `/workspace/crm/follow-ups/` for your review
> - Send you a summary notification of pending follow-ups
>
> No messages are auto-sent unless you explicitly configure it. You always review first.

### Step 2: Ask User Preferences

**USER ACTION REQUIRED**

Ask the user:

> Let me configure the follow-up system for you. Please tell me your preferences:
>
> 1. **Check frequency** — How often should I check for needed follow-ups?
>    - Daily at 10am (recommended)
>    - Twice daily at 9am and 4pm
>    - Custom schedule
>
> 2. **Days before first follow-up** — How many days after initial contact with no reply? (default: 3)
>
> 3. **Maximum follow-ups per lead** — How many times to follow up before stopping? (default: 3)
>
> 4. **Tone preference** — What tone for follow-up messages?
>    - Professional (default)
>    - Friendly
>    - Casual
>
> 5. **Auto-send or draft only?**
>    - Draft only — I review and send manually (recommended)
>    - Auto-send — Messages sent automatically (use with caution)

Wait for the user to provide preferences before continuing. Use defaults for anything they don't specify.

### Step 3: Create CRM Directory Structure

Create the CRM directory and initial files:

```bash
mkdir -p /workspace/crm/proposals
mkdir -p /workspace/crm/follow-ups
mkdir -p /workspace/crm/templates
```

Create the initial `leads.json` if it doesn't already exist:

```bash
if [ ! -f /workspace/crm/leads.json ]; then
cat > /workspace/crm/leads.json << 'EOF'
{
  "version": 1,
  "leads": []
}
EOF
fi
```

**Lead Schema** — Each lead in the `leads` array should follow this structure:

```json
{
  "id": "lead-<timestamp>-<random>",
  "name": "Contact name or handle",
  "contact": "Email, Reddit username, GitHub handle, etc.",
  "source": "reddit|hackernews|github|n8n|referral|manual",
  "source_url": "https://...",
  "status": "new|contacted|proposal_sent|active|closed_won|closed_lost",
  "topic": "Brief description of what they need",
  "first_contact_date": "2026-02-15T10:00:00",
  "last_contact_date": "2026-02-15T10:00:00",
  "last_reply_date": null,
  "follow_up_count": 0,
  "max_follow_ups": 3,
  "next_follow_up_date": null,
  "proposal_sent_date": null,
  "project_deadline": null,
  "score": 8,
  "notes": "Any relevant context",
  "tags": ["automation", "n8n"]
}
```

### Step 4: Create Follow-up Templates

Create the three follow-up templates:

```bash
cat > /workspace/crm/templates/initial-followup.md << 'TMPL_EOF'
# Template: Initial Follow-up
Use when: Lead was contacted 3+ days ago, no response yet.
Tone: {{tone}}

---

Subject: Following up on {{topic}}

Hi {{name}},

I wanted to follow up on our conversation about {{topic}} from {{days_ago}} days ago.

{{personalized_context}}

Would you like to continue discussing this? I'm happy to {{next_step}}.

Best regards
TMPL_EOF
```

```bash
cat > /workspace/crm/templates/proposal-followup.md << 'TMPL_EOF'
# Template: Proposal Follow-up
Use when: Proposal sent 7+ days ago, no acceptance or response.
Tone: {{tone}}

---

Subject: Re: Proposal for {{project_name}}

Hi {{name}},

I sent over a proposal for {{project_name}} about {{days_ago}} days ago and wanted to check if you had any questions or concerns.

{{value_add}}

I'm flexible on timeline and scope — happy to adjust the proposal if needed.

Best regards
TMPL_EOF
```

```bash
cat > /workspace/crm/templates/final-followup.md << 'TMPL_EOF'
# Template: Final Follow-up
Use when: Multiple follow-ups sent, this is the last attempt (14+ days).
Tone: {{tone}}

---

Subject: Quick check-in — {{topic}}

Hi {{name}},

I know things get busy! Just a quick note about {{topic}}.

If the timing isn't right, no worries at all. I'll be here whenever you're ready to move forward.

{{alternative_offer}}

All the best
TMPL_EOF
```

### Step 5: Copy Templates to Container Tools

Also install the templates in the container tools directory so they're available across all groups:

```bash
cp /workspace/crm/templates/initial-followup.md /workspace/project/container/tools/templates/followup-initial.md
cp /workspace/crm/templates/proposal-followup.md /workspace/project/container/tools/templates/followup-proposal.md
cp /workspace/crm/templates/final-followup.md /workspace/project/container/tools/templates/followup-final.md
```

### Step 6: Create the Scheduled Task

Use the `schedule_task` tool with the user's chosen schedule and preferences.

**Default configuration** (adjust based on user input):
- Schedule: `0 10 * * *` (daily at 10am)
- Days before first follow-up: 3
- Max follow-ups per lead: 3
- Tone: professional
- Auto-send: false (draft only)

```
schedule_task({
  prompt: `Client Follow-up Task: Check CRM for leads needing follow-up and draft messages.

INSTRUCTIONS:
1. First, check your current calendar capacity:
   \`\`\`bash
   /workspace/project/container/tools/calendar-checker.sh availability 7
   \`\`\`
   Parse the JSON output to get available_hours, capacity, and slots.

2. Read /workspace/crm/leads.json

3. Get today's date and check each lead against these rules:
   - Status "contacted": If (today - last_contact_date) >= DAYS_BEFORE_FOLLOWUP days AND last_reply_date is null AND follow_up_count < MAX_FOLLOWUPS → needs initial follow-up
   - Status "proposal_sent": If (today - proposal_sent_date) >= 7 days AND last_reply_date is null AND follow_up_count < MAX_FOLLOWUPS → needs proposal follow-up
   - Status "contacted" or "proposal_sent": If follow_up_count >= (MAX_FOLLOWUPS - 1) → needs final follow-up (last attempt)
   - Status "active": If project_deadline exists and (deadline - today) <= 3 days → flag for deadline reminder

4. Calendar-aware prioritization:
   - If capacity is "full": Only follow up with leads scoring 9+ or with imminent deadlines (<=2 days). Skip lower-priority leads until capacity improves.
   - If capacity is "low": Follow up with leads scoring 7+ but deprioritize leads scoring below 7. Note limited availability in follow-up drafts.
   - If capacity is "medium" or "high": Normal follow-up processing for all qualifying leads.
   - For leads with a project_deadline: Cross-reference with calendar events. If the deadline is approaching and you have conflicting events, flag it prominently in the summary.

5. For each lead needing follow-up (filtered by capacity rules above):
   a. Read the appropriate template from /workspace/crm/templates/
   b. Draft a personalized message using the lead's context, topic, notes, and any conversation history
   c. Replace template placeholders with actual values
   d. Set tone to: TONE_PREFERENCE
   e. Save the draft to /workspace/crm/follow-ups/YYYY-MM-DD-<lead-id>.md with the lead name, contact info, and the drafted message

6. Update leads.json: increment follow_up_count, set next_follow_up_date for each processed lead

7. Send a summary notification via send_message:
   - Calendar summary: "You have X hours available this week (capacity: high/medium/low/full)"
   - Any deadline conflicts detected between calendar events and project deadlines
   - How many leads were checked
   - How many need follow-up (and how many were skipped due to capacity)
   - Brief list of drafted follow-ups (name, topic, which follow-up number)
   - Path to review drafts: /workspace/crm/follow-ups/
   - If AUTO_SEND is false: "Review drafts and let me know which to send"
   - If AUTO_SEND is true: actually send each drafted message (use send_message)

8. If no leads need follow-up, send a brief "All caught up — you have X hours available this week" message

CONFIGURATION:
- Days before first follow-up: DAYS_BEFORE_FOLLOWUP
- Max follow-ups per lead: MAX_FOLLOWUPS
- Tone: TONE_PREFERENCE
- Auto-send: AUTO_SEND

If /workspace/crm/leads.json doesn't exist or is empty, send a message: "No leads in CRM yet. Leads from monitors will be added automatically, or add them manually to /workspace/crm/leads.json"

If calendar-checker.sh fails (no credentials), proceed without capacity filtering but note in the summary: "Calendar integration not configured — follow-ups not capacity-filtered. Run /add-calendar-integration to enable."`,
  schedule_type: "cron",
  schedule_value: "0 10 * * *",
  context_mode: "group"
})
```

**Important:** Replace these placeholders in the prompt with the user's actual preferences:
- `DAYS_BEFORE_FOLLOWUP` → user's chosen days (default: 3)
- `MAX_FOLLOWUPS` → user's chosen max (default: 3)
- `TONE_PREFERENCE` → user's chosen tone (default: professional)
- `AUTO_SEND` → true or false based on user's choice (default: false)

Also replace the schedule_value `"0 10 * * *"` with the user's chosen schedule.

### Step 7: Update Group CLAUDE.md

Add to the group's CLAUDE.md:

```markdown
## Client Follow-up System

Automated follow-up tracking is active. The system checks CRM daily for leads needing attention.

**CRM location:** `/workspace/crm/`
- `leads.json` — All tracked leads with status and dates
- `follow-ups/` — Drafted follow-up messages for review
- `templates/` — Follow-up message templates
- `proposals/` — Sent proposals

**Adding leads manually:**
To add a lead to the CRM, update `/workspace/crm/leads.json` with a new entry in the `leads` array. Required fields: id, name, contact, source, status, topic, first_contact_date, last_contact_date, follow_up_count.

**Lead statuses:** new → contacted → proposal_sent → active → closed_won/closed_lost

**Reviewing follow-up drafts:**
Check `/workspace/crm/follow-ups/` for pending drafts. Each file contains the lead info and drafted message. Tell me which ones to send or discard.
```

### Step 8: Verify Setup

Tell the user:

> Client Follow-up system is configured! Here's what's set up:
>
> **Schedule:** [their chosen schedule, e.g., "Daily at 10am"]
> **Follow-up timing:** [X] days after contact, max [Y] follow-ups per lead
> **Tone:** [their chosen tone]
> **Mode:** [Draft only / Auto-send]
>
> **CRM directory created at** `/workspace/crm/` with:
> - `leads.json` — Lead tracking (currently empty)
> - `templates/` — 3 follow-up templates (initial, proposal, final)
> - `follow-ups/` — Where drafts will be saved
> - `proposals/` — For sent proposals
>
> **How leads get into the CRM:**
> - Automatically from lead monitors (Reddit, HN, GitHub, n8n pipeline)
> - Manually — just tell me about a new lead and I'll add it
> - The `LEAD_FOUND` signal from monitors feeds into this system
>
> **What happens each day:**
> 1. Task checks all leads in the CRM
> 2. Identifies who needs a follow-up based on timing rules
> 3. Drafts personalized messages using templates
> 4. Sends you a summary with a list of pending follow-ups
> 5. You review drafts in `/workspace/crm/follow-ups/` and tell me which to send
>
> **Quick test:** Want me to add a sample lead so you can see how the follow-up drafts look? Or tell me about a real lead to track.
>
> **Manage the task:**
> - `list_tasks` — See the follow-up task and its status
> - `pause_task <id>` — Pause follow-up checks
> - `cancel_task <id>` — Remove the task entirely
