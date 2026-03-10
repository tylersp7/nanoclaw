# Auto-Optimizer

Automatically optimize scheduled tasks and agent behavior based on learning data. Can be run as a monthly scheduled task or on-demand when the user asks to "optimize", "clean up tasks", or "tune performance".

## Data Sources

Read these files from `/workspace/group/` before making any changes:

1. **task-scorecard.md** — Primary source for task optimization decisions
2. **failure-patterns.md** — Identifies recurring issues that need addressing
3. **skill-effectiveness.md** — Guides which skills to recommend
4. **lessons.md** — Informs approach adjustments

## Optimization Actions

### 1. Task Cleanup (from task-scorecard.md)
- **Pause** tasks with >80% suppression rate and at least 5 runs
  - Use IPC: write `{"type": "pause_task", "taskId": "<id>"}` to `/workspace/ipc/tasks/`
  - Always explain WHY the task is being paused
- **Adjust intervals** for tasks that run too frequently with low value
  - Use IPC: write `{"type": "update_task", "taskId": "<id>", "updates": {"schedule_value": "<new_cron>"}}` to `/workspace/ipc/tasks/`
- **Keep** tasks with value score > 0.5 — they're earning their keep
- Never pause tasks the user explicitly asked to keep running

### 2. Failure Pattern Response (from failure-patterns.md)
- For patterns with >5 occurrences: suggest concrete fixes
  - timeout patterns → recommend breaking tasks into smaller steps
  - auth patterns → flag credential review needed
  - rate_limit patterns → suggest adding delays to relevant tasks
  - network patterns → check DNS and connectivity settings
- Report which patterns are new vs recurring

### 3. Schedule Optimization
- If task-scorecard shows tasks clustering at the same time, suggest spreading them out
- If certain hours have higher success rates (from user-profile.md), suggest moving tasks there
- Consolidate tasks that do similar work (flag duplicates)

### 4. Skill Recommendations (from skill-effectiveness.md)
- Suggest trying unused skills that match current task types
- Flag underperforming skills that tasks rely on heavily

## Output Format

After making changes, report:

```
## Optimization Report — {date}

### Actions Taken
- Paused: {task_id} — {reason}
- Adjusted: {task_id} — {old_schedule} → {new_schedule}, reason: {reason}

### Recommendations (manual action needed)
- {recommendation}

### No Changes Needed
- {task_id} — performing well (score: {score})
```

## Safety Rules
- NEVER pause more than 3 tasks in a single run
- NEVER modify tasks in the "main" category without explicit user approval
- Always explain changes before making them when running interactively
- When running as a scheduled task, make changes and report what was done
- If unsure about a change, recommend it instead of executing it
