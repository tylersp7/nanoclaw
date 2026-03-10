---
name: weekly-reflection
description: Weekly learning reflection and knowledge synthesis
---

# Weekly Learning Reflection

When triggered as a scheduled task for weekly reflection, follow this process:

## Step 1: Read Learning Artifacts

Start by reading the auto-generated learning data (skip any that don't exist):

```bash
# Quality trends — how are conversations going?
cat /workspace/group/quality-trends.md 2>/dev/null

# Learning digest — period-over-period metrics
cat /workspace/group/learning-digest.md 2>/dev/null

# Task scorecard — which tasks are earning their keep?
cat /workspace/group/task-scorecard.md 2>/dev/null

# Failure patterns — what keeps going wrong?
cat /workspace/group/failure-patterns.md 2>/dev/null

# Current lessons — what has the system learned so far?
cat /workspace/group/lessons.md 2>/dev/null

# Skill effectiveness — which tools work best?
cat /workspace/group/skill-effectiveness.md 2>/dev/null

# User profile — communication patterns
cat /workspace/group/user-profile.md 2>/dev/null
```

## Step 2: Review Recent Conversations

```bash
# List recent conversation files (last 7 days)
find /workspace/group/conversations -name "*.md" -mtime -7 | sort

# Read conversation summaries
ls /workspace/group/conversations/summaries/ 2>/dev/null | tail -20
```

## Step 3: Analyze and Synthesize

Compare learning artifacts against raw conversations to identify:

- **Trend changes**: Is quality improving or declining? Why?
- **Recurring failures**: Are the same error patterns appearing? Are recovery hints working?
- **Lesson validation**: Are approach lessons actually leading to better outcomes?
- **Task ROI**: Should any tasks be paused, adjusted, or consolidated?
- **Skill gaps**: Are there unused skills that could help with recurring problems?
- **User preference shifts**: Any changes in how the user communicates or what they want?

## Step 4: Update Intelligence Files

Based on findings, update the appropriate files:
- `client-intelligence.md` -- client patterns, communication preferences
- `infrastructure-intelligence.md` -- system patterns, common issues
- `content-intelligence.md` -- content themes, engagement patterns
- `workflow-architecture.md` -- process improvements

Only add HIGH-CONFIDENCE learnings (observed 2+ times).

## Step 5: Take Action

If the scorecard or failure patterns suggest concrete optimizations:
- Pause low-value tasks (>80% suppression) via IPC `pause_task`
- Adjust schedules via IPC `update_task` if timing is suboptimal
- Note these actions in the summary

## Step 6: Generate Weekly Summary

Use send_message to deliver a brief weekly reflection:

```
Weekly Reflection -- {date range}

**Health Check:**
- Quality score: {avg} ({trend})
- Lessons: {count} ({new this week})
- Failure patterns: {count} ({trend})

**Top Insights:**
- Insight 1 (from data)
- Insight 2

**Actions Taken:**
- Paused/adjusted tasks (if any)
- Updated intelligence files

**Focus for Next Week:**
- Area to improve based on lowest quality signal
```

Keep the summary under 500 words. Wrap verbose analysis in <internal> tags.
