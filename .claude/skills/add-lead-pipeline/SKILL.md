---
name: add-lead-pipeline
description: Set up the Lead Pipeline Supervisor — a multi-step pipeline that runs all monitors, deduplicates leads, qualifies them, and sends a unified summary. Replaces running monitors separately.
---

# Add Lead Pipeline Supervisor

This skill creates a unified lead generation pipeline that chains all your active monitors into a single coordinated workflow. Instead of each monitor running independently, the pipeline:

1. Runs all configured monitors in sequence
2. Deduplicates leads across sources
3. Scores and qualifies leads
4. Generates proposals for high-scoring leads
5. Sends a single consolidated summary

## Prerequisites

At least one monitor must already be configured:
- `/add-reddit-monitor` - Reddit freelance opportunities
- `/add-hn-monitor` - HackerNews "Who's Hiring" threads
- `/add-github-monitor` - GitHub issues and repo activity
- `/add-n8n-monitor` - n8n community help requests
- `/add-job-board-scraper` - Upwork, Fiverr, Freelancer job boards

If none are configured yet, tell the user they need at least one monitor first and offer to set one up.

## Setup Steps

### Step 1: Check Which Monitors Are Active

Read the group's CLAUDE.md and check for monitor configuration files:

```bash
# Check for monitor configs
ls ~/.nanoclaw-github/ 2>/dev/null && echo "GitHub: configured"
ls /workspace/group/reddit-config.json 2>/dev/null && echo "Reddit: configured"
ls /workspace/group/hn-config.json 2>/dev/null && echo "HN: configured"
ls /workspace/group/n8n-config.json 2>/dev/null && echo "n8n: configured"
```

Also check for existing monitor scripts:
```bash
ls /workspace/group/reddit-monitor.sh 2>/dev/null
ls /workspace/group/hn-monitor.sh 2>/dev/null
ls /workspace/group/github-monitor.sh 2>/dev/null
ls /workspace/group/n8n-monitor.sh 2>/dev/null
ls /workspace/project/container/tools/job-board-scraper.sh 2>/dev/null && echo "Job boards: configured"
```

### Step 2: Ask the User About Schedule

Ask the user:

> I'll set up the Lead Pipeline Supervisor. This runs all your active monitors as a coordinated pipeline instead of separately.
>
> **How often should the pipeline run?**
> - 3x daily at 9am, 1pm, 6pm (recommended for active job hunting)
> - 2x daily at 9am and 5pm (moderate)
> - Once daily at 9am (light monitoring)
> - Custom schedule
>
> **What's your minimum lead score threshold?** (1-10, default: 7)
> Leads scoring below this won't generate proposals or CRM entries.

### Step 3: Create the Pipeline Task

Based on which monitors are active, build the pipeline steps. Only include steps for configured monitors.

Use the `schedule_task` tool with `pipeline_steps`:

```
schedule_task({
  prompt: "Lead Pipeline Supervisor: Run all monitors, deduplicate, qualify, and notify.",
  schedule_type: "cron",
  schedule_value: "0 9,13,18 * * *",  // or user's chosen schedule
  context_mode: "isolated",
  pipeline_steps: [
    // Include only steps for configured monitors:
    {
      name: "reddit-discover",
      prompt: "Run the Reddit monitor. Check configured subreddits for new posts matching our criteria. Output a JSON array of leads, each with: {title, url, source: 'reddit', subreddit, score_estimate, posted_at, summary}. If no new leads found, output an empty array: []",
      context_mode: "isolated"
    },
    {
      name: "hn-discover",
      prompt: "Run the HackerNews monitor. Check 'Who is Hiring' threads, 'Ask HN' posts, and Show HN for relevant automation/consulting opportunities. Output a JSON array of leads, each with: {title, url, source: 'hackernews', thread_type, score_estimate, posted_at, summary}. If no new leads found, output an empty array: []",
      context_mode: "isolated"
    },
    {
      name: "github-discover",
      prompt: "Run the GitHub monitor. Check configured repos for 'help wanted' issues, consulting opportunities, and relevant discussions. Output a JSON array of leads, each with: {title, url, source: 'github', repo, issue_number, score_estimate, posted_at, summary}. If no new leads found, output an empty array: []",
      context_mode: "isolated"
    },
    {
      name: "n8n-discover",
      prompt: "Run the n8n community monitor. Check the n8n forum and Discord for help requests and consulting opportunities. Output a JSON array of leads, each with: {title, url, source: 'n8n', channel, score_estimate, posted_at, summary}. If no new leads found, output an empty array: []",
      context_mode: "isolated"
    },
    // OPTIONAL: Uncomment the step below if /add-job-board-scraper is configured.
    // This searches Upwork, Fiverr, and Freelancer for freelance automation projects.
    // {
    //   name: "job-board-discover",
    //   prompt: "Run the job board scraper. Search configured freelance platforms for new automation/n8n projects.\n\n```bash\n/workspace/project/container/tools/job-board-scraper.sh all \"n8n,automation,workflow,API integration\"\n```\n\nParse the JSON output. Output a JSON array of leads, each with: {title, url, source: platform_name, budget, budget_amount, score_estimate: match_score, posted_at: posted_date, summary: description}. If no new leads found, output an empty array: []",
    //   context_mode: "isolated"
    // },
    {
      name: "deduplicate-and-qualify",
      prompt: "You are the lead qualification agent. Here are leads from multiple sources:\n\n{prev_results}\n\n1. Parse all JSON arrays from the step outputs above\n2. Deduplicate leads (same URL or very similar title/content)\n3. Score each lead 1-10 based on: budget signals, urgency, skill match (automation, n8n, Claude/AI), response feasibility\n4. Filter to only leads scoring >= THRESHOLD\n5. Output a JSON array of qualified leads with: {title, url, source, score, reasoning, posted_at}\n6. If no leads qualify, output: []\n\nFor each lead, emit a signal: <signal type=\"LEAD_FOUND\">{...lead data}</signal>",
      skipIf: "results.trim() === '[]' || results.trim() === ''",
      context_mode: "isolated"
    },
    {
      name: "add-to-crm-and-notify",
      prompt: "You are the CRM and notification agent. Here are the qualified leads:\n\n{prev_results}\n\nBEFORE processing leads, check your current capacity:\n```bash\n/workspace/project/container/tools/calendar-checker.sh capacity\n```\n\nCapacity-aware lead processing rules:\n- If capacity is \"full\" (<5h free this week): Do NOT generate proposals. Log all leads to CRM with status \"new\" and note \"deferred — at capacity\". Notify the user that leads were saved but proposals are deferred until calendar frees up.\n- If capacity is \"low\" (5-10h free): Only generate proposals for leads scoring 9+. For any proposals generated, add a timeline caveat: \"Note: My current schedule is tight — I can start in [X] days. Let me know if that works.\"\n- If capacity is \"medium\" or \"high\" (10h+ free): Normal proposal generation for leads scoring 8+.\n\nFor each qualified lead:\n1. Check if it's already in our CRM/tracking (check CLAUDE.md or tracking files)\n2. If new, add it to our lead tracking\n3. Generate proposals per the capacity rules above\n4. Send a consolidated summary via send_message with:\n   - Current capacity status (high/medium/low/full) and available hours this week\n   - Total leads found across all sources\n   - Number that qualified\n   - Top 3 leads with scores and one-line descriptions\n   - Any proposals generated (or note that proposals were deferred if at capacity)\n\nKeep the notification concise and actionable. Use <internal> tags for verbose analysis.",
      skipIf: "results.trim() === '[]' || results.trim() === ''",
      context_mode: "isolated"
    }
  ]
})
```

**Important:** Replace THRESHOLD in the deduplicate step prompt with the user's chosen minimum score.

### Step 4: Confirm Setup

Tell the user:

> Lead Pipeline Supervisor is set up! Here's what will happen:
>
> **Schedule:** [their chosen schedule]
> **Active monitors:** [list which ones, including job-board-scraper if configured]
> **Lead threshold:** [their chosen score]/10
>
> The pipeline will:
> 1. Run each monitor to discover leads (Reddit, HN, GitHub, n8n, Job Boards)
> 2. Skip empty sources automatically (no wasted compute)
> 3. Deduplicate and score all leads together
> 4. Generate proposals for high-scoring leads (8+)
> 5. Send you a single consolidated summary
>
> **Tips:**
> - Pipeline status is logged to `pipeline_run_logs` in the database
> - If a step fails, the pipeline resumes from where it left off on next run
> - Follow-up signals (LEAD_FOUND) trigger automatic proposal generation
> - Use `list_tasks` to see the pipeline task and its status
>
> To pause: `pause_task <task_id>`
> To resume: `resume_task <task_id>`
> To cancel: `cancel_task <task_id>`

### Step 5: Verify (Optional)

If the user wants to test it immediately, you can suggest:

> Want me to trigger a test run now? I can create a one-time pipeline run to verify everything works.

If yes, create the same pipeline with `schedule_type: "once"` and `schedule_value` set to 1 minute from now.
