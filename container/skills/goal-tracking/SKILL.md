# Goal Tracking

Your group maintains a `goals.md` file for tracking objectives and progress.

## Setting Goals
When the user mentions an objective, offer to add it as a goal:
- "I want to reduce VPS alerts" -> metric goal with target
- "Ship the new feature by Friday" -> milestone goal with deadline
- "Check HackerNews every Monday" -> habit goal

To add a goal, write a JSON task to IPC:
```json
{"type": "update_goals", "action": "add", "goal": {"id": "slug", "title": "...", "type": "metric", "target": "...", "deadline": "..."}}
```

Or simply update `/workspace/group/goals.md` directly by editing the goals-data JSON block.

## Tracking Progress
1. Read `/workspace/group/goals.md` to see current goals and progress
2. When work relates to a goal, mention the progress
3. When a goal is completed, celebrate and note it
4. If a goal is stalled (no progress in 14 days), suggest action

## When to Reference Goals
- At the start of sessions: check if any goals are near deadline
- After completing work: check if it advances any goals
- During weekly reflection: review all goal progress
- When the user seems unfocused: gently remind of active goals
