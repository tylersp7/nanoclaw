---
name: add-job-board-scraper
description: Monitor Upwork, Fiverr, and Freelancer for automation/n8n projects. Uses RSS feeds and web scraping to find jobs matching your skills. High volume of opportunities, early application alerts.
---

# Add Job Board Scraper

This skill adds automated job board monitoring for Upwork, Fiverr, and Freelancer. It uses RSS feeds and public APIs to find automation/n8n projects, score them for relevance, and alert you to high-quality leads.

## What It Monitors

**Upwork:**
- RSS feeds for job searches (no login required)
- Filter by: keywords, budget, recency
- Best source for quality clients

**Fiverr:**
- Search results for buyer requests
- Gig marketplace for automation services
- Note: Fiverr blocks most automated access; may require agent-browser for full results

**Freelancer:**
- Public API for active project listings
- Budget and skill data available
- High volume of automation projects

---

## Setup Steps

### Step 1: Ask Which Platforms to Monitor

**USER ACTION REQUIRED**

Tell the user:

> I'll set up job board monitoring for freelance platforms. Which platforms do you want to monitor?
>
> 1. **Upwork** - Best for quality clients, uses RSS feeds
> 2. **Fiverr** - Buyer requests (may need browser automation)
> 3. **Freelancer** - Public API, high volume
> 4. **All platforms** (recommended)
>
> Default: All platforms

Wait for the user to respond. Store their choice.

### Step 2: Ask for Search Keywords

Tell the user:

> What keywords should I search for? Provide a comma-separated list.
>
> **Default keywords:** n8n, automation, workflow, zapier alternative, make.com alternative, API integration
>
> You can also add your own like: Python, VPS, Docker, security, webhook, scraping
>
> Just say "default" to use the defaults, or provide your custom list.

Wait for the user to respond. Store their keywords.

### Step 3: Ask for Budget Minimum

Tell the user:

> What's your minimum budget threshold? Jobs below this amount will be filtered out.
>
> - $100 (include everything)
> - $200 (filter out micro-tasks)
> - $500 (recommended - quality projects only)
> - $1000 (premium projects only)
> - Custom amount
>
> Default: $500

Wait for the user to respond. Store the budget minimum.

### Step 4: Configure Schedule

Tell the user:

> How often should I check for new jobs?
>
> - Every 1 hour (aggressive - best for early applications)
> - Every 2 hours (recommended)
> - Every 4 hours (moderate)
> - Every 6 hours (light monitoring)
> - Custom cron expression
>
> Default: Every 2 hours (`0 */2 * * *`)
>
> Tip: Applying early dramatically increases response rates. On Upwork, being in the first 5 applicants gives a 3x better response rate.

Wait for the user to respond. Store the schedule.

### Step 5: Create the Scheduled Task

Based on the user's choices, create the scheduled task. Substitute their actual choices for the placeholders below.

The scheduled task prompt should use the `job-board-scraper.sh` tool and emit `<signal type="LEAD_FOUND">` for high-scoring matches.

**For "All platforms" (default):**

```
schedule_task({
  prompt: "Job Board Scraper: Search all freelance platforms for new opportunities.\n\n## Instructions\n\n1. Run the job board scraper for all configured platforms:\n```bash\n/workspace/project/container/tools/job-board-scraper.sh all \"KEYWORDS\"\n```\n\nReplace KEYWORDS with: USER_KEYWORDS_HERE\n\n2. Parse the JSON output. Each job has: title, url, description, budget, budget_amount, platform, posted_date, match_score\n\n3. Filter results:\n   - Only include jobs with match_score >= 7\n   - Only include jobs with budget_amount >= MIN_BUDGET_HERE (or budget_amount == 0 meaning unspecified)\n   - Skip any jobs previously reported (check recent messages)\n\n4. For each qualifying job (score 7+), emit a signal:\n<signal type=\"LEAD_FOUND\">{\"title\": \"JOB_TITLE\", \"url\": \"JOB_URL\", \"source\": \"PLATFORM\", \"score\": MATCH_SCORE, \"budget\": \"BUDGET\", \"summary\": \"Brief description\"}</signal>\n\n5. Send a summary message with:\n   - Total jobs found across all platforms\n   - Number that passed filters\n   - Top matches with: title, platform, budget, score, URL\n   - For score 9+ jobs, note them as \"Apply ASAP - early applicants get 3x response rate\"\n\n6. If no jobs found matching criteria, do NOT send a message (skip silently).\n\nOutput format for pipeline compatibility:\n```json\n[{\"title\": \"...\", \"url\": \"...\", \"platform\": \"...\", \"budget\": \"...\", \"budget_amount\": 0, \"posted_date\": \"...\", \"match_score\": 0}]\n```",
  schedule_type: "cron",
  schedule_value: "CRON_EXPRESSION_HERE"
})
```

**For individual platforms**, use the same prompt but replace `all` with the specific platform (`upwork`, `fiverr`, or `freelancer`).

**Replace these placeholders:**
- `USER_KEYWORDS_HERE` with the user's keywords from Step 2
- `MIN_BUDGET_HERE` with the user's budget from Step 3
- `CRON_EXPRESSION_HERE` with the cron expression from Step 4 (default: `0 */2 * * *`)

### Step 6: Update Group Memory

Add to the group's CLAUDE.md:

```markdown
## Job Board Scraping

Monitor freelance platforms for automation projects using `job-board-scraper.sh`:

**Search all platforms:**
```bash
/workspace/project/container/tools/job-board-scraper.sh all "n8n,automation,workflow"
```

**Search specific platform:**
```bash
/workspace/project/container/tools/job-board-scraper.sh upwork "n8n,automation"
/workspace/project/container/tools/job-board-scraper.sh freelancer "workflow,API integration"
/workspace/project/container/tools/job-board-scraper.sh fiverr "automation"
```

**Set minimum budget:**
```bash
MIN_BUDGET=1000 /workspace/project/container/tools/job-board-scraper.sh all "n8n,automation"
```

Output: JSON array of scored jobs. Use when user asks about freelance opportunities or job board monitoring.

**Keywords:** USER_KEYWORDS_CONFIGURED
**Min budget:** $MIN_BUDGET_CONFIGURED
**Schedule:** SCHEDULE_CONFIGURED
```

Replace the placeholders with the user's actual configured values.

---

## Verification

After setup, test the scraper:

```bash
/workspace/project/container/tools/job-board-scraper.sh freelancer "automation,n8n"
```

Check the output is valid JSON with scored results. If `jq` is not installed in the container, install it:

```bash
apt-get update && apt-get install -y jq
```

Tell the user what you found and confirm the scheduled task is active.

---

## Scheduled Monitoring Tasks

### Primary Monitor (Every 2 Hours)

```
@Andy every 2 hours, search Upwork, Freelancer, and Fiverr for new jobs matching n8n, automation, API integration, and workflow. Score each 1-10. Only alert me for jobs scoring 7+ with budget $500+. For any lead scoring 7 or above, also emit a signal tag:
<signal type="LEAD_FOUND">{"title": "...", "url": "...", "source": "upwork", "score": 8, "budget": "$1000", "summary": "..."}</signal>
```

### Early Bird Alert (Fresh Jobs)

```
@Andy every morning at 7am, check all job boards for jobs posted in the last 12 hours. These are fresh opportunities with fewer applicants. Send me score 8+ matches immediately. For any lead scoring 7 or above, also emit a signal tag:
<signal type="LEAD_FOUND">{"title": "...", "url": "...", "source": "freelancer", "score": 9, "budget": "$2000", "summary": "..."}</signal>
```

### Weekly Platform Summary

```
@Andy every Sunday at 6pm, analyze all job board results from this week. Tell me: total opportunities found per platform, top 5 by score, most common skill requests, average budgets, and whether I should adjust keywords or budget filters. For any lead scoring 7 or above, also emit a signal tag:
<signal type="LEAD_FOUND">{"title": "...", "url": "...", "source": "upwork", "score": 8, "budget": "$1500", "summary": "..."}</signal>
```

---

## Pro Tips

### Upwork Success Strategy

**Apply Early:**
- Within first 5 applicants = 3x response rate
- Jobs get 20-50 proposals in first 24 hours
- Set up hourly alerts for best projects

**Profile Optimization:**
- Title: "n8n Automation Specialist | Workflow & API Integration Expert"
- Overview: Mention VPS, automation, API integration
- Portfolio: Add relevant project samples

### Budget Guidelines

**Fair pricing for automation work:**
- $500-1000 = Small automation project (single workflow)
- $1000-2000 = Medium complexity (multi-step, API integrations)
- $2000-5000 = Complex system integration (multiple platforms)
- $5000+ = Full automation infrastructure

### Platform Comparison

| Platform | Volume | Quality | Budget Range | Competition |
|----------|--------|---------|-------------|-------------|
| Upwork | High | Best | $200-$10k+ | Medium |
| Freelancer | High | Mixed | $100-$5k | High |
| Fiverr | Medium | Lower | $50-$2k | Medium |

---

## Success Criteria

- Can search each configured platform
- Results include: title, url, description, budget, match_score
- Scoring filters low-quality jobs
- Budget filtering removes micro-tasks
- Scheduled monitoring tasks running
- Signal emissions for pipeline integration

---

Tell the user:

> Job board scraping is set up!
>
> I'm now monitoring [PLATFORMS] for:
> **Keywords:** [KEYWORDS]
> **Min budget:** $[BUDGET]
> **Schedule:** [SCHEDULE]
>
> The scraper checks for automation/n8n projects and scores each one 1-10 for fit. You'll only get notified about quality matches (score 7+).
>
> Combined with your other monitors, you now have comprehensive lead coverage across freelance platforms, Reddit, HackerNews, and more.
>
> Want me to run a test search now to see what's available?
