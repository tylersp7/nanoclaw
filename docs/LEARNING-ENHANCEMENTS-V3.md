# Learning Enhancements V3 — Active Learning Loop

Third round of learning enhancements. The key insight: V1/V2 built rich data collection (trajectories, summaries, profiles, FTS5 index) but none of it feeds back into how the agent approaches new work. V3 closes the loop.

## Status

| # | Enhancement | Status | Key Files |
|---|-------------|--------|-----------|
| 13 | Failure pattern index | Done | `src/failure-patterns.ts`, `container/skills/failure-patterns/` |
| 14 | Pre-session trajectory recall | Done | `container/agent-runner/src/index.ts` (findRelevantPrecedents) |
| 15 | Task performance scorecard | Done | `src/task-scorecard.ts`, `src/task-scheduler.ts`, `container/skills/task-scorecard/` |
| 16 | Adaptive prompt lessons | Done | `src/adaptive-lessons.ts`, `container/skills/adaptive-lessons/` |
| 17 | Skill effectiveness tracking | Done | `src/skill-tracker.ts`, `container/skills/skill-effectiveness/` |

## 13. Failure Pattern Index

**Problem**: Failed tasks retry on schedule without understanding *why* they failed. Same errors repeat.

**Solution**: Periodic scanner reads archived conversations with `outcome: error` or `has_errors: true` in trajectory metadata. Extracts error categories using regex heuristics (timeout, auth failure, rate limit, missing resource, syntax error, network error). Builds `groups/{name}/failure-patterns.md` with categorized failure types, frequencies, last seen dates, and recovery hints. File is automatically available to agents via the group folder mount.

**Implementation**:
- `src/failure-patterns.ts`: Scanner that reads conversation archives, parses YAML frontmatter, categorizes errors, writes markdown summary
- Runs on lifecycle hook `learning:indexed` (after conversation indexing) and on a 12h interval
- Recovery hints are heuristic: e.g., "timeout" → "Consider breaking into smaller steps", "auth" → "Check credentials in .env"
- File capped at 3KB, keeps top 10 patterns by frequency

## 14. Pre-Session Trajectory Recall

**Problem**: Agent starts every session cold. Even with summary injection (#8), it never checks "have I done this before?"

**Solution**: Before the first query in a session, extract key terms from the incoming prompt and query the FTS5 conversation index for similar past sessions. If matches found, load their trajectory metadata (outcome, topics, duration) and inject as `<context type="relevant-precedents">` XML block. Successful precedents provide approach hints; failed ones provide warnings.

**Implementation**:
- Extends `runQuery()` in `container/agent-runner/src/index.ts`
- New function `findRelevantPrecedents(prompt, groupFolder)`: extracts top 3 non-stopword terms, queries FTS5 via IPC `search_conversations` task, loads trajectory metadata from matching files
- Injects max 3 precedents (prioritizing recent + matching outcome diversity)
- Only on first query of session (same gate as summary injection)
- Lightweight: reuses existing FTS5 infrastructure, no new indexes

## 15. Task Performance Scorecard

**Problem**: 26+ scheduled tasks run on fixed intervals with no visibility into ROI. Some consistently produce "nothing to report."

**Solution**: New SQLite table `task_metrics` tracks per-task performance: run count, success count, error count, suppressed count (nothing-to-report or duplicate), avg duration, follow-up generation count. Periodic job (every 24h) writes `groups/{name}/task-scorecard.md` with ranked task list showing ROI metrics. Agent can read this to recommend pausing low-value tasks.

**Implementation**:
- `src/task-scorecard.ts`: Metrics collection + scorecard generation
- New DB table `task_metrics` with columns: task_id, run_count, success_count, error_count, suppressed_count, total_duration_ms, followup_count, last_run
- Hooks into `task:end` lifecycle event to record metrics
- Also hooks into notification filtering in task-scheduler.ts to track suppression
- Scorecard: tasks ranked by "value score" = (success_count - suppressed_count) / run_count
- Flags tasks with >80% suppression rate as candidates for pause/removal

## 16. Adaptive Prompt Lessons

**Problem**: Weekly reflection skill exists but lessons don't propagate back into agent behavior automatically.

**Solution**: After each weekly reflection (detected via `task:end` for reflection tasks) and after knowledge aggregation runs, extract actionable lessons and write to `groups/{name}/lessons.md`. Container agent reads this at session start alongside CLAUDE.md. Lessons have timestamps and decay after 30 days unless reinforced. File stays under 2KB.

**Implementation**:
- `src/adaptive-lessons.ts`: Lesson extraction + management
- Scans recent conversation summaries for patterns: repeated errors, successful approaches, user preferences discovered
- Each lesson: `{date, category, text, reinforcement_count, last_seen}`
- Categories: "approach" (what works), "avoidance" (what fails), "preference" (user patterns)
- Runs on `learning:indexed` hook + weekly via knowledge aggregator
- Old lessons (>30 days, not reinforced) are pruned automatically
- Container reads `lessons.md` — no new IPC or mount changes needed (already in group folder)

## 17. Skill Effectiveness Tracking

**Problem**: 12+ container skills available but no data on which ones actually help vs waste context.

**Solution**: Track skill usage by scanning conversation archives for skill invocation markers (tool_use in trajectory metadata, skill file references in conversation text). Build per-skill stats: usage frequency, associated session success rate, typical task types. Write to `groups/{name}/skill-effectiveness.md` for agent reference.

**Implementation**:
- `src/skill-tracker.ts`: Skill usage analysis
- Scans trajectory metadata `has_tool_use` field + conversation text for skill references (`/workspace/.claude/skills/`, tool names)
- Correlates skill presence with session outcome (success/error/incomplete)
- Writes per-skill stats: times_used, success_rate, common_contexts, avg_session_duration
- Runs alongside knowledge aggregator (every 6h)
- Skills with <20% success rate flagged as "review needed"
- Output file capped at 2KB
