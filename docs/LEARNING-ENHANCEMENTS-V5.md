# Learning Enhancements V5 — Intentionality & Proactive Behavior

Fifth round. V1-V4 built comprehensive data collection, feedback loops, and agent activation. V5 adds intentionality (goal tracking) and proactive behavior (insight surfacing).

## Status

| # | Enhancement | Status | Key Files |
|---|-------------|--------|-----------|
| 23 | Goal tracking | Done | `src/goal-tracker.ts`, `container/skills/goal-tracking/SKILL.md` |
| 24 | Proactive insights | Done | `src/proactive-insights.ts`, `container/skills/proactive-insights/SKILL.md` |

## 23. Goal Tracking

**Problem**: Andy has rich learning data but no sense of *purpose*. Conversations happen, patterns emerge, but there's no framework for tracking whether things are actually moving toward the user's objectives.

**Solution**: Per-group `goals.md` where users set objectives with deadlines. Andy tracks progress from conversation data, scorecard metrics, and quality trends. Goals can be set conversationally ("I want to reduce VPS alerts to under 2 per week") and Andy updates progress automatically.

**Implementation**:
- `src/goal-tracker.ts`: Host-side module that scans learning artifacts for goal-relevant metrics
- Goals stored in `groups/{name}/goals.md` with machine-readable JSON block
- Goal types: metric-based (trackable number), milestone-based (done/not done), habit-based (recurring behavior)
- Progress updated on `session:end` hook by scanning recent conversations and metrics
- Container skill teaches agent to read goals, update progress, and suggest new goals

## 24. Proactive Insights

**Problem**: Andy sees patterns (peak hours, recurring topics, failure clusters, quality trends) but only reports when asked. Valuable observations go unnoticed.

**Solution**: Lightweight insight generator that scans learning artifacts for notable changes and queues brief observations for the agent to mention during natural conversation pauses.

**Implementation**:
- `src/proactive-insights.ts`: Host-side module that detects notable changes
- Insight types: trend changes, milestone reached, anomaly detected, recommendation
- Insights written to `groups/{name}/pending-insights.md` for the agent to pick up
- Agent reads pending insights at session start, mentions relevant ones naturally
- Insights consumed after delivery (not repeated)
- Max 3 pending insights at a time to avoid information overload
