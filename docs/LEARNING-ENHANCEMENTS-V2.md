# Learning Enhancements V2

Second round of learning enhancements inspired by [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent).

## Status

| # | Enhancement | Status | Key Files |
|---|-------------|--------|-----------|
| 8 | Session summary injection | Done | `container/agent-runner/src/index.ts` (runQuery) |
| 9 | Context compression persistence | Done | `container/agent-runner/src/index.ts` (preCompactHook), `container/skills/session-context/` |
| 10 | Interruptible execution | Done | `src/group-queue.ts`, `src/index.ts`, agent-runner |
| 11 | File-based hook extensions | Done | `src/hook-loader.ts`, `groups/global/hooks/`, `container/skills/hook-extensions/` |
| 12 | Batch trajectory export | Done | `src/trajectory-export.ts`, `scripts/export-trajectories.ts` |

## 8. Session Summary Injection

**Problem**: New sessions start cold with no context from prior conversations.

**Solution**: On the first query of each container session, `runQuery()` calls `loadRecentSummaries()` to load the 5 most recent conversation summaries and injects them as `<context type="recent-sessions">` XML before the user prompt. Skipped for scheduled tasks (which have their own context) and follow-up IPC messages within the same session.

## 9. Context Compression Persistence

**Problem**: SDK compaction is opaque — when context overflows, useful information may be lost.

**Solution**: The pre-compaction hook now also maintains a rolling `session-context.md` in the group root. Each compaction appends a structured entry (key facts, decisions, action items, ~500 chars). File keeps the last 5 entries (<3KB total). Agent can read it to recall earlier conversation context. Companion skill at `container/skills/session-context/`.

## 10. Interruptible Execution

**Problem**: New messages queue behind the current agent run. User must wait for task completion.

**Solution**: Three-layer implementation:
1. **Host**: `isUrgentUserMessage()` detects `!urgent`, `!priority`, `!interrupt` prefixes. `queue.sendInterrupt()` writes `_interrupt` sentinel + message to IPC.
2. **Agent-runner**: `pollIpcDuringQuery()` checks for `_interrupt` before `_close`. When found, ends the MessageStream causing the SDK to finish the current turn.
3. **Query loop**: `main()` detects `interruptedDuringQuery`, drains the IPC message, and immediately starts a fresh query with it.

## 11. File-Based Hook Extensions

**Problem**: Adding learning behaviors requires code changes.

**Solution**: JSON hook files in `groups/{name}/hooks/` discovered at startup. Each specifies an event type and action. Actions: `log`, `write_file`, `append_file`, `ipc_task`. Template variables: `{groupFolder}`, `{chatJid}`, `{taskId}`, `{timestamp}`, `{date}`, `{success}`, `{durationMs}`. Global hooks in `groups/global/hooks/` fire for all groups. Path traversal guards prevent escape from group directory.

Example: `groups/global/hooks/session-activity-log.json` appends session end events to `activity-log.md`.

## 12. Batch Trajectory Export

**Problem**: Trajectory-tagged conversations can't be exported for training or analysis.

**Solution**: CLI script + library:
- `src/trajectory-export.ts`: Scans, filters, and exports conversations. Parses YAML frontmatter and markdown messages. Supports ShareGPT and JSONL formats.
- `scripts/export-trajectories.ts`: CLI with flags for `--format`, `--outcome`, `--topic`, `--group`, `--from`/`--to`, `--min-messages`, `--stats`.

Usage: `npx tsx scripts/export-trajectories.ts --outcome success --format sharegpt --output training.jsonl`
