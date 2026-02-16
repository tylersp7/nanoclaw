---
name: add-portfolio-pipeline
description: Set up the Portfolio Auto-Update Pipeline — chains GitHub activity monitoring with portfolio updates and optional LinkedIn posting. Turns your GitHub activity into social proof automatically.
---

# Add Portfolio Auto-Update Pipeline

This skill creates a multi-step pipeline that automatically turns your GitHub activity into social proof. It monitors your repos, extracts highlights, updates your portfolio files, and optionally drafts LinkedIn posts for your review.

**How it works:**

1. **Step 0 (github-activity-scan):** Scans configured GitHub repos for the past week's activity (stars, commits, PRs, releases, issues)
2. **Step 1 (extract-highlights):** Reviews the activity and extracts the most impressive/shareable highlights
3. **Step 2 (update-portfolio):** Updates portfolio files (README.md, HIGHLIGHTS.md, stats.json) with highlights
4. **Step 3 (post-to-linkedin):** Optionally drafts a LinkedIn post about the top highlight for user review (NEVER auto-posts)

The pipeline uses `skipIf` conditions so empty weeks skip gracefully without wasting compute.

## Prerequisites

### 1. Check GitHub Integration

Verify GitHub is configured:

```bash
ls ~/.nanoclaw-github/credentials.json 2>/dev/null && echo "GitHub: configured" || echo "GitHub: NOT configured"
```

If GitHub is not configured, tell the user:

> GitHub integration is required for the Portfolio Auto-Update Pipeline. It needs access to your repos to scan activity.
>
> Would you like me to set up GitHub first? I can run `/add-github-monitor` to get that configured.

Stop here and run `/add-github-monitor` if needed. Do not proceed without GitHub.

### 2. Check LinkedIn Integration (Optional)

If the user wants LinkedIn posting, verify it's configured:

```bash
ls ~/.nanoclaw-linkedin/session.json 2>/dev/null && echo "LinkedIn: configured" || echo "LinkedIn: NOT configured"
```

LinkedIn is optional. If not configured, the pipeline works fine without it — step 3 is simply skipped.

---

## Setup Steps

### Step 1: Explain the Pipeline

Tell the user:

> This pipeline automatically turns your GitHub activity into social proof. It monitors your repos, extracts highlights, updates your portfolio, and optionally posts to LinkedIn.
>
> **What it does each run:**
> 1. Scans your GitHub repos for the past week's activity
> 2. Extracts the most impressive highlights (new stars, merged PRs, releases, milestones)
> 3. Updates your portfolio files with professional formatting
> 4. Optionally drafts a LinkedIn post for your review (never auto-posts)

### Step 2: Ask Preferences

Ask the user:

> Let me configure the pipeline for you. I need a few preferences:
>
> **1. Which GitHub repos should I highlight?**
> - All your public repos (default)
> - Specific repos only (list them, e.g., `tylersp7/nanoclaw, tylersp7/vps_bugbounty`)
>
> **2. Portfolio format:**
> - README updates in your portfolio directory (default)
> - Personal site integration (provide site repo)
> - Both
>
> **3. LinkedIn posting:**
> - Disabled (default) — pipeline works without LinkedIn
> - Enabled — drafts posts for your review (requires `/add-linkedin-monitor` setup)
>
> **4. Schedule:**
> - Weekly on Monday at 8am (default — `0 8 * * 1`)
> - Biweekly
> - Custom cron expression

Wait for user to provide preferences.

### Step 3: Create Portfolio Config

Write the config file based on user preferences:

```bash
cat > /workspace/group/portfolio-config.json << 'CONFIGEOF'
{
  "repos": ["user/repo1", "user/repo2"],
  "portfolio_path": "/workspace/group/portfolio/",
  "linkedin_enabled": false,
  "highlight_types": ["new_stars", "merged_prs", "releases", "milestones"]
}
CONFIGEOF
```

Replace the `repos` array with the user's chosen repos. If "all repos", use `["*"]` as a wildcard. Set `linkedin_enabled` based on the user's choice.

Also create the portfolio directory:

```bash
mkdir -p /workspace/group/portfolio
```

### Step 4: Create the Pipeline Task

Use the `schedule_task` tool. Substitute the user's repos, LinkedIn preference, and schedule into the pipeline below.

**Template variables:**
- `REPOS_LIST` — JSON array of repos or `["*"]` for all
- `LINKEDIN_ENABLED` — `true` or `false`
- `SCHEDULE` — cron expression (default: `0 8 * * 1`)

```
schedule_task({
  prompt: "Portfolio Auto-Update Pipeline: Scan GitHub activity, extract highlights, update portfolio, optionally draft LinkedIn post.",
  schedule_type: "cron",
  schedule_value: "SCHEDULE",
  context_mode: "isolated",
  pipeline_steps: [
    {
      "name": "github-activity-scan",
      "prompt": "You are a GitHub activity scanner. Your job is to scan configured repos for the past week's activity.\n\nFirst, read the portfolio config:\n```bash\ncat /workspace/group/portfolio-config.json\n```\n\nThen scan each configured repo using the GitHub monitoring tool and direct API calls. For each repo:\n\n1. Check stars/forks (current count and any recent changes):\n```bash\n/workspace/project/container/tools/github-monitor.sh repo-activity OWNER/REPO\n```\n\n2. Check recent commits (past 7 days):\n```bash\n/workspace/project/container/tools/portfolio-updater.sh scan USERNAME\n```\n\n3. If the config has `[\"*\"]` for repos, first list all repos:\n```bash\n/workspace/project/container/tools/github-monitor.sh my-repos\n```\nThen scan the top 10 most recently updated ones.\n\nFor each repo, also check for merged PRs and releases using curl with the GitHub token:\n```bash\nTOKEN=$(cat /workspace/extra/.nanoclaw-github/credentials.json 2>/dev/null | node -e \"process.stdin.on('data',d=>console.log(JSON.parse(d).token))\" 2>/dev/null)\nif [ -n \"$TOKEN\" ]; then\n  # Recent merged PRs\n  curl -sH \"Authorization: token $TOKEN\" \"https://api.github.com/repos/OWNER/REPO/pulls?state=closed&sort=updated&direction=desc&per_page=10\" | node -e \"process.stdin.on('data',d=>{const prs=JSON.parse(d).filter(p=>p.merged_at&&new Date(p.merged_at)>new Date(Date.now()-7*86400000));console.log(JSON.stringify(prs.map(p=>({title:p.title,number:p.number,merged_at:p.merged_at}))))})\"\n  # Recent releases\n  curl -sH \"Authorization: token $TOKEN\" \"https://api.github.com/repos/OWNER/REPO/releases?per_page=5\" | node -e \"process.stdin.on('data',d=>{const r=JSON.parse(d).filter(r=>new Date(r.published_at)>new Date(Date.now()-7*86400000));console.log(JSON.stringify(r.map(r=>({tag:r.tag_name,name:r.name,published_at:r.published_at}))))})\"\nfi\n```\n\nOutput a JSON summary of all activity found:\n```json\n{\"repos\": [{\"name\": \"owner/repo\", \"stars\": N, \"stars_gained\": N, \"forks\": N, \"commits\": N, \"prs_merged\": [{\"title\": \"...\", \"number\": N}], \"releases\": [{\"tag\": \"...\", \"name\": \"...\"}], \"notable_issues\": [{\"title\": \"...\", \"number\": N, \"state\": \"...\"}]}]}\n```\n\nIf no repos have any meaningful activity (0 commits, 0 PRs, 0 releases, 0 star changes), output: {\"repos\": []}\n\nDo NOT use send_message. Wrap diagnostic output in <internal> tags.",
      "context_mode": "isolated"
    },
    {
      "name": "extract-highlights",
      "prompt": "You are a highlight extraction agent. Your job is to review GitHub activity and extract the most impressive, shareable highlights.\n\nHere is the GitHub activity scan from the previous step:\n\n{prev_results}\n\nReview all the activity and extract highlights worth sharing. Focus on:\n- Significant milestones (star counts reaching round numbers: 10, 25, 50, 100, 250, 500, 1000)\n- Interesting merged PRs (new features, major fixes)\n- New releases (especially with meaningful changelogs)\n- Community engagement (new contributors, issue discussions)\n- Productivity streaks (many commits in a week)\n\nFor each highlight, write:\n- A 1-2 sentence description suitable for a portfolio\n- A social media post version (suitable for LinkedIn — professional, authentic, not salesy)\n- An importance score 1-10\n\nOutput JSON:\n```json\n{\"highlights\": [{\"type\": \"milestone|pr_merged|release|community|productivity\", \"repo\": \"owner/repo\", \"title\": \"Short title\", \"description\": \"1-2 sentence portfolio description\", \"social_post\": \"LinkedIn-ready post (2-3 sentences, include relevant hashtags)\", \"importance\": 8}]}\n```\n\nSort by importance descending. Only include highlights scoring 5 or above.\n\nIf no meaningful highlights exist, output: {\"highlights\": []}\n\nDo NOT use send_message. Wrap diagnostic output in <internal> tags.",
      "skipIf": "results.includes('\"repos\": []') || results.includes('\"repos\":[]')",
      "context_mode": "isolated"
    },
    {
      "name": "update-portfolio",
      "prompt": "You are a portfolio management agent. Your job is to update the portfolio files with the latest highlights.\n\nHere are the highlights extracted from GitHub activity:\n\n{prev_results}\n\nRead the current portfolio config:\n```bash\ncat /workspace/group/portfolio-config.json\n```\n\nRead any existing portfolio files:\n```bash\ncat /workspace/group/portfolio/README.md 2>/dev/null || echo 'No existing README'\ncat /workspace/group/portfolio/HIGHLIGHTS.md 2>/dev/null || echo 'No existing highlights'\ncat /workspace/group/portfolio/stats.json 2>/dev/null || echo 'No existing stats'\n```\n\nNow update (or create) three files:\n\n**1. `/workspace/group/portfolio/README.md`** — Project showcase\n- Professional header with name and tagline\n- Section for each active repo with description, tech stack, and key metrics\n- Recent achievements section with the latest highlights\n- Skills/technologies section derived from repo languages and topics\n- Keep any existing content that's still relevant, update metrics\n\n**2. `/workspace/group/portfolio/HIGHLIGHTS.md`** — Activity log\n- Chronological log of highlights, newest first\n- Each entry has: date, repo, type, description\n- Keep ALL previous entries (append new ones at top)\n- Group by month\n- Format: `### YYYY-MM-DD — Repo Name\\n**Type:** description`\n\n**3. `/workspace/group/portfolio/stats.json`** — Aggregate stats\n- Total stars across all repos\n- Total forks across all repos\n- Total commits this week\n- Total PRs merged this week\n- Number of active repos\n- Last updated timestamp\n- Historical data (append current week's stats to array)\n\nWrite all three files using bash. Format everything professionally.\n\nAfter updating, output a summary of what changed:\n```json\n{\"updated_files\": [\"README.md\", \"HIGHLIGHTS.md\", \"stats.json\"], \"highlights_added\": N, \"total_highlights\": N}\n```\n\nDo NOT use send_message. Wrap verbose file contents in <internal> tags.",
      "skipIf": "results.includes('\"highlights\": []') || results.includes('\"highlights\":[]')",
      "context_mode": "isolated"
    },
    {
      "name": "post-to-linkedin",
      "prompt": "You are a LinkedIn content drafting agent. Your job is to draft a professional LinkedIn post about the top highlight for the user to review.\n\n**IMPORTANT: This is draft-only. NEVER auto-post. The user must review and approve before posting.**\n\nFirst, check if LinkedIn posting is enabled:\n```bash\ncat /workspace/group/portfolio-config.json | node -e \"process.stdin.on('data',d=>{const c=JSON.parse(d);console.log(c.linkedin_enabled?'ENABLED':'DISABLED')})\"\n```\n\nIf DISABLED, output: {\"linkedin_status\": \"disabled\", \"action\": \"skipped\"}\nAnd skip the rest.\n\nIf ENABLED, review the highlights from previous steps:\n\n{prev_results}\n\nDraft a professional LinkedIn post about the top highlight (highest importance score). Guidelines:\n- Keep it authentic and conversational, NOT salesy or boastful\n- Focus on the technical achievement, lesson learned, or milestone reached\n- 3-5 sentences maximum\n- Include 3-5 relevant hashtags (#opensource, #automation, #devtools, etc.)\n- Include a call to action (e.g., \"Check it out:\", \"Star the repo:\", link to project)\n- Write as if the user is posting (first person)\n\nAlso draft an alternative shorter version (1-2 sentences) in case the user prefers brevity.\n\nSend the draft to the user for review via send_message:\n\n```\nPortfolio Update + LinkedIn Draft\n\nYour portfolio has been updated with this week's GitHub highlights.\n\n---\nLinkedIn Post Draft (for your review):\n\n[full draft here]\n\n---\nShorter version:\n\n[short draft here]\n\n---\nReply 'post' to approve, 'edit' to modify, or 'skip' to skip LinkedIn this week.\n```\n\nOutput: {\"linkedin_status\": \"draft_sent\", \"highlight_used\": \"title of highlight\"}",
      "skipIf": "results.includes('\"highlights\": []') || results.includes('\"highlights\":[]') || results.includes('\"linkedin_enabled\":false') || results.includes('\"linkedin_enabled\": false')",
      "context_mode": "isolated"
    }
  ]
})
```

**Before calling schedule_task**, replace all template variables:
- Replace `REPOS_LIST` in the config with the user's chosen repos
- Replace `LINKEDIN_ENABLED` with `true` or `false`
- Replace `SCHEDULE` with the user's chosen cron expression (default: `0 8 * * 1`)
- In the `github-activity-scan` step, replace `OWNER/REPO` references with the user's actual repos, or keep the wildcard logic if they chose "all repos"
- In the `github-activity-scan` step, replace `USERNAME` with the user's GitHub username

### Step 5: Verify Setup

Tell the user:

> Portfolio Auto-Update Pipeline is set up! Here's the configuration:
>
> **Schedule:** [cron expression in human-readable form, e.g., "Every Monday at 8am"]
> **Monitored repos:** [list repos or "all public repos"]
> **Portfolio directory:** `/workspace/group/portfolio/`
> **LinkedIn posting:** [enabled/disabled]
>
> **What happens each run:**
> 1. Scans your GitHub repos for the past week's activity (stars, commits, PRs, releases)
> 2. Extracts the most impressive highlights worth sharing
> 3. Updates portfolio files: `README.md` (showcase), `HIGHLIGHTS.md` (activity log), `stats.json` (aggregate stats)
> 4. [If LinkedIn enabled] Drafts a LinkedIn post and sends it to you for review
>
> **Smart skipping:**
> - If no activity is found, the pipeline stops after step 1 (no wasted compute)
> - If no meaningful highlights exist, portfolio update and LinkedIn steps are skipped
> - If LinkedIn is disabled, step 4 is always skipped
>
> **Portfolio files:**
> Your portfolio is maintained at `/workspace/group/portfolio/` with:
> - `README.md` — Professional project showcase (auto-updated)
> - `HIGHLIGHTS.md` — Chronological activity log
> - `stats.json` — Aggregate metrics over time
>
> **Management commands:**
> - `list_tasks` — See the pipeline task and status
> - `pause_task <task_id>` — Pause the pipeline
> - `resume_task <task_id>` — Resume the pipeline
> - `cancel_task <task_id>` — Remove the pipeline

### Step 6: Offer Test Run

Ask the user:

> Want me to trigger a test run now? I'll create a one-time pipeline execution to verify everything works end-to-end.

If yes, create the same pipeline with `schedule_type: "once"` and `schedule_value` set to 1 minute from now (use ISO timestamp format).

---

## Portfolio Updater Tool

The pipeline uses the `portfolio-updater.sh` container tool for common operations:

```bash
# Scan GitHub activity for past week
/workspace/project/container/tools/portfolio-updater.sh scan [username]

# Extract highlights from most recent scan
/workspace/project/container/tools/portfolio-updater.sh highlights

# Update portfolio files from highlights
/workspace/project/container/tools/portfolio-updater.sh update

# Show portfolio stats
/workspace/project/container/tools/portfolio-updater.sh stats
```

---

## Customization

### Adding More Repos Later

Edit `/workspace/group/portfolio-config.json` to add repos to the `repos` array. Or set to `["*"]` to track all public repos.

### Changing Highlight Types

Edit the `highlight_types` array in the config. Options:
- `new_stars` — Star milestones
- `merged_prs` — Merged pull requests
- `releases` — New releases
- `milestones` — Star/fork round number milestones
- `community` — New contributors, issues
- `productivity` — Commit streaks

### Enabling LinkedIn Later

If you set up LinkedIn after creating this pipeline:
1. Run `/add-linkedin-monitor` to set up LinkedIn access
2. Edit `/workspace/group/portfolio-config.json` and set `"linkedin_enabled": true`
3. The next pipeline run will include the LinkedIn draft step

### Combining with Lead Pipeline

This pipeline runs independently from the Lead Pipeline Supervisor. It focuses on portfolio/social proof, not lead generation. Both can run on the same schedule without interference.

---

## Troubleshooting

### GitHub API Rate Limits

If scanning many repos, you might hit GitHub's API rate limit (5000 requests/hour with token). The tool uses authenticated requests which have generous limits. If you see rate limit errors:
- Reduce the number of monitored repos
- Switch from `["*"]` to specific repos
- Increase the schedule interval

### Empty Portfolio Updates

If the pipeline keeps skipping with "no activity":
- Verify your GitHub token is valid: `cat ~/.nanoclaw-github/credentials.json`
- Check that the repos in your config actually exist
- Try a manual scan: `github-monitor.sh repo-activity owner/repo`
- Reduce the `importance` threshold in the extract-highlights step (default: 5)

### LinkedIn Draft Not Sent

- Check that `linkedin_enabled` is `true` in `portfolio-config.json`
- Verify LinkedIn session is still valid: `ls ~/.nanoclaw-linkedin/session.json`
- The draft is only sent if there are highlights with importance >= 5
- LinkedIn step is skipped if ALL previous steps produced empty results

### Pipeline Step Fails

- Pipeline state is saved between steps — if step 1 fails, it resumes from step 1 on next run
- Check pipeline logs: query `pipeline_run_logs` table in the SQLite database
- A stale pipeline (crashed mid-run) is automatically detected and resumed after 2x container timeout

---

## Success Criteria

- GitHub integration verified and repos accessible
- Portfolio config created with correct repos and preferences
- Pipeline task created with correct schedule
- Portfolio directory exists at `/workspace/group/portfolio/`
- Test run completes steps 0-2 without errors (step 3 only if LinkedIn enabled)
- Portfolio files (README.md, HIGHLIGHTS.md, stats.json) created/updated
- LinkedIn draft delivered for review (if enabled)
- `skipIf` conditions work correctly for empty weeks
