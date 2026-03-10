# Learning Dashboard

Synthesize all learning artifacts into a unified status report. Use when the user asks "how am I doing?", "what have you learned?", "show me the dashboard", or wants an overview of agent performance and learning.

## Learning Artifacts

Read these files from `/workspace/group/` (skip any that don't exist):

1. **task-scorecard.md** — Per-task performance metrics (success rate, suppression rate, value score)
2. **failure-patterns.md** — Categorized error patterns with frequencies and recovery hints
3. **lessons.md** — Learned approach/avoidance/preference patterns from past conversations
4. **skill-effectiveness.md** — Which skills work well, which underperform, which are unused
5. **session-context.md** — Rolling context from recent compactions (key facts, decisions, action items)
6. **user-profile.md** — User communication patterns, peak hours, common topics

## Report Format

Synthesize findings into this structure (adapt based on what data exists):

### Health Summary
- Overall learning status: how many lessons, patterns, and metrics are tracked
- Trend direction: are things improving, stable, or degrading?

### Top Lessons Learned
- List the 3-5 most reinforced lessons (highest reinforcement count)
- Categorize as approach (what works) vs avoidance (what to avoid)

### Problem Areas
- Recurring failure patterns (top 3 by frequency)
- Include recovery hints from failure-patterns.md
- Note if any patterns are getting worse (higher count, recent lastSeen)

### Task Recommendations
- Tasks with >80% suppression rate → recommend pausing
- Tasks with high value score → recommend keeping or increasing frequency
- Tasks that haven't run recently → flag for review

### Skill Insights
- Most effective skills (high success rate)
- Underperforming skills (low success rate with multiple uses)
- Unused skills worth trying

### User Profile Summary
- Peak activity hours and days
- Common topics and preferences
- Any preference lessons that should guide behavior

## Guidelines
- Keep the report concise (under 500 words)
- Lead with actionable insights, not raw data
- If asked for specific areas (e.g., "which tasks should I pause?"), focus on that section
- If no learning data exists yet, explain that the system needs more conversations to build up data
- Offer to run optimizations (pause tasks, adjust schedules) if the user wants to act on recommendations
