---
name: hook-extensions
description: Custom lifecycle hook extensions
---

# Hook Extensions

Custom hooks can be added by creating JSON files in `/workspace/group/hooks/`.

## Hook Format

Each `.json` file defines a hook:

```json
{
  "name": "my-hook",
  "event": "session:end",
  "enabled": true,
  "action": {
    "type": "append_file",
    "path": "activity-log.md",
    "template": "- {date}: Session ended ({durationMs}ms)\n"
  }
}
```

## Events
- `session:start` -- Agent session started
- `session:end` -- Agent session completed
- `session:output` -- Agent sent output
- `task:start` -- Scheduled task started
- `task:end` -- Scheduled task completed
- `compaction:complete` -- Conversation compaction finished
- `learning:indexed` -- Learning content indexed

## Action Types
- `log` -- Log a message to the system log
- `write_file` -- Write/overwrite a file (relative to group folder)
- `append_file` -- Append to a file (relative to group folder)
- `ipc_task` -- Write an IPC task JSON file

## Template Variables
`{groupFolder}`, `{chatJid}`, `{taskId}`, `{timestamp}`, `{date}`, `{success}`, `{durationMs}`

## Scope

- Hooks in `groups/global/hooks/` fire for all groups.
- Hooks in `groups/{name}/hooks/` fire only for that group.
- Hooks are loaded once at startup (restart to pick up changes).
