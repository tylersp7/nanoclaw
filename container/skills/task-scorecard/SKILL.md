# Task Scorecard

Your group maintains a `task-scorecard.md` in the group root with performance metrics for all scheduled tasks.

## When to use
- When the user asks about task performance or which tasks to keep/remove
- When recommending schedule changes
- When a task seems to consistently produce low-value output

## How to use
1. Read `/workspace/group/task-scorecard.md` if it exists
2. Tasks with >80% suppression rate are candidates for pausing
3. High value tasks (score > 0.5) are worth keeping or increasing frequency
4. Use the `update_task` or `pause_task` IPC commands to act on recommendations
