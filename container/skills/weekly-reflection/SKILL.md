---
name: weekly-reflection
description: Weekly learning reflection and knowledge synthesis
---

# Weekly Learning Reflection

When triggered as a scheduled task for weekly reflection, follow this process:

## Step 1: Review Recent Conversations
Search recent conversation archives for patterns:
```bash
# List recent conversation files (last 7 days)
find /workspace/group/conversations -name "*.md" -mtime -7 | sort

# Read conversation summaries if available
ls /workspace/group/conversations/summaries/ 2>/dev/null | tail -20
```

## Step 2: Analyze Patterns
Look for:
- **Recurring topics**: What subjects come up repeatedly?
- **Successful interactions**: What worked well? (check frontmatter: outcome: success)
- **Failures/errors**: What went wrong? (check frontmatter: outcome: error)
- **User preferences**: Any implicit preferences in how requests are phrased?
- **Knowledge gaps**: Areas where you needed to research or were uncertain?

## Step 3: Extract Learnings
For each pattern found, create a structured learning:
- What was learned
- Evidence (which conversations)
- Confidence level (single instance vs repeated pattern)

## Step 4: Update Intelligence Files
Based on findings, update the appropriate files:
- `client-intelligence.md` — client patterns, communication preferences
- `infrastructure-intelligence.md` — system patterns, common issues
- `content-intelligence.md` — content themes, engagement patterns
- `workflow-architecture.md` — process improvements

Only add HIGH-CONFIDENCE learnings (observed 2+ times).

## Step 5: Generate Weekly Summary
Use send_message to deliver a brief weekly reflection summary:
- Top 3 patterns observed
- Key learnings added to intelligence files
- Suggested improvements for next week

Keep the summary under 500 words. Wrap verbose analysis in <internal> tags.

## Output Format
```
Weekly Reflection — {date range}

**Patterns Observed:**
- Pattern 1 (seen N times)
- Pattern 2

**Learnings Added:**
- Added to {file}: {brief description}

**Suggestions:**
- Suggestion 1
```
