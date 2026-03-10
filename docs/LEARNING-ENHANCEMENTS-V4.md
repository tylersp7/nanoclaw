# Learning Enhancements V4 — Agent Activation & Quality Metrics

Fourth round of learning enhancements. V1-V3 built the data collection, injection, and feedback loop. V4 teaches the agent to actively use that infrastructure and adds quality metrics to refine the loop.

## Status

| # | Enhancement | Status | Key Files |
|---|-------------|--------|-----------|
| 18 | Learning dashboard skill | Done | `container/skills/learning-dashboard/SKILL.md` |
| 19 | Auto-optimizer skill | Done | `container/skills/auto-optimizer/SKILL.md` |
| 20 | Pre-flight check skill | Done | `container/skills/pre-flight-check/SKILL.md` |
| 21 | Learning metrics digest | Done | `src/learning-digest.ts`, `container/skills/learning-digest/SKILL.md` |
| 22 | Conversation quality score | Done | `src/quality-scorer.ts`, `container/skills/quality-trends/SKILL.md` |

## 18. Learning Dashboard Skill

**Problem**: Andy has 6+ learning artifacts per group (failure-patterns.md, lessons.md, task-scorecard.md, skill-effectiveness.md, session-context.md, user-profile.md) but no unified view. User has to ask about each one separately.

**Solution**: Container skill that teaches the agent to read all learning artifacts and synthesize a holistic status report. Answers: "which tasks should I pause?", "what keeps failing?", "what have I learned recently?", "how am I doing?"

**Implementation**: Skill file only — no host code needed. The skill instructs the agent to:
1. Read all 6 learning files from `/workspace/group/`
2. Synthesize findings into sections: Health Summary, Top Lessons, Problem Areas, Task Recommendations, Skill Usage
3. Flag actionable items (tasks to pause, patterns to address, unused skills to try)

## 19. Auto-Optimizer Skill

**Problem**: Task scorecard identifies low-value tasks but the agent doesn't act on recommendations without being prompted.

**Solution**: Container skill that teaches the agent to read scorecard data and execute optimizations via IPC. Can be run as a monthly scheduled task or on-demand.

**Implementation**: Skill file that instructs the agent to:
1. Read task-scorecard.md for tasks with >80% suppression rate
2. Read failure-patterns.md for recurring errors that could be addressed
3. Read skill-effectiveness.md for underperforming skills
4. Execute optimizations: pause low-value tasks via IPC `pause_task`, adjust schedules via `update_task`, recommend skill changes
5. Report what was changed and why

## 20. Pre-Flight Check Skill

**Problem**: Agent has failure patterns, lessons, and precedents but doesn't always consult them before starting complex work. The data is passive.

**Solution**: Container skill that establishes a "pre-flight checklist" habit. Before any complex task, the agent reads relevant learning artifacts and mentions findings.

**Implementation**: Skill file that instructs the agent to:
1. Before complex tasks, read: failure-patterns.md, lessons.md, skill-effectiveness.md
2. Check if the current task type matches any known failure patterns
3. Check if any lessons (approach/avoidance) are relevant
4. Check which skills are most effective for this type of work
5. Briefly mention relevant findings before proceeding (1-2 sentences, not verbose)
6. Skip the check for simple queries (greetings, quick questions)

## 21. Learning Metrics Digest

**Problem**: No visibility into whether the learning system itself is working. Are lessons accumulating? Are failure patterns shrinking? Are tasks getting more valuable over time?

**Solution**: Host-side module that generates a weekly metrics digest comparing learning indicators period-over-period. Runs as a scheduled lifecycle hook and writes a digest file.

**Implementation**:
- `src/learning-digest.ts`: Collects metrics from all learning artifacts across groups
- Metrics tracked:
  - Lesson count (total, new this week, pruned this week)
  - Failure pattern frequency (total occurrences, new patterns, resolved patterns)
  - Task scorecard trends (avg value score, suppression rate change, new follow-ups)
  - Skill effectiveness changes (success rate deltas, newly used skills)
  - Conversation volume (sessions this week, avg duration)
- Writes `groups/{name}/learning-digest.md` with period-over-period comparison
- Stores previous week's metrics in a JSON comment block for comparison
- Runs weekly via lifecycle hook or 7-day interval
- Capped at 2KB per group

## 22. Conversation Quality Score

**Problem**: Trajectory tagging marks outcome as success/error/incomplete but doesn't capture quality — was the response actually helpful? Did the user need to repeat themselves?

**Solution**: Heuristic quality scoring added to conversation archiving. Scores feed into trajectory metadata for better precedent recall and pattern analysis.

**Implementation**:
- `src/quality-scorer.ts`: Scoring functions called from the host side
- Quality signals (each 0-1, averaged for final score):
  - **Completion**: Did the conversation reach a natural end? (vs timeout/interrupt)
  - **Efficiency**: Message count relative to task complexity (fewer = better for simple tasks)
  - **Tool success**: Ratio of successful tool uses to total tool uses
  - **User satisfaction**: Presence of positive signals ("thanks", "perfect", "great") vs negative ("no", "wrong", "try again", "that's not what I")
  - **Follow-up absence**: No immediate follow-up message from user (indicates task was complete)
- Final score: 0.0-1.0, mapped to labels: excellent (>0.8), good (0.6-0.8), fair (0.4-0.6), poor (<0.4)
- Integrated into conversation archiving via lifecycle hooks
- Score written to trajectory YAML frontmatter as `quality_score` and `quality_label`
- Also written to `groups/{name}/quality-trends.md` with rolling 30-day average
