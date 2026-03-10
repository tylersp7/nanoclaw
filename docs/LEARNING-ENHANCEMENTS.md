# Learning Enhancements

Inspired by [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent), these enhancements add self-improving learning capabilities to NanoClaw.

## Status

| # | Enhancement | Status | Key Files |
|---|-------------|--------|-----------|
| 1 | Weekly reflection scheduled task | Done | `src/learning-hooks.ts`, `container/skills/weekly-reflection/` |
| 2 | FTS5 search over conversation archives | Done | `src/db.ts`, `src/conversation-indexer.ts`, `container/skills/search-conversations/` |
| 3 | Conversation summary generation on compaction | Done | `container/agent-runner/src/index.ts` |
| 4 | User modeling (user-profile.md) | Done | `src/user-profile.ts`, `container/skills/user-profile/` |
| 5 | Trajectory tagging (success/failure metadata) | Done | `container/agent-runner/src/index.ts` |
| 6 | Cross-group knowledge aggregation | Done | `src/knowledge-aggregator.ts`, `container/skills/knowledge-aggregation/` |
| 7 | Lifecycle hooks system | Done | `src/lifecycle-hooks.ts` |

## Architecture

```
User Message → processGroupMessages()
                  ├─ hooks.emit('session:start')
                  ├─ runContainerAgent()
                  │     ├─ Agent runs in container with skills
                  │     ├─ Pre-compaction hook:
                  │     │     ├─ Archives full transcript (with YAML frontmatter)
                  │     │     └─ Generates conversation summary
                  │     └─ Output streamed back
                  ├─ hooks.emit('session:end')
                  ├─ updateProfileFromMessages()    ← user modeling
                  └─ indexGroupConversations()       ← FTS5 re-index (via learning hook)

Scheduled Tasks:
  ├─ Weekly reflection (Sundays 9 AM) → reviews conversations, updates intelligence files
  └─ Knowledge aggregation (every 6h) → scans all groups, writes global/CLAUDE.md

Startup:
  ├─ startConversationIndexer()   → indexes all conversations into FTS5
  ├─ registerLearningHooks()      → session:end triggers re-indexing
  └─ startKnowledgeAggregator()   → cross-group synthesis every 6h
```

## 1. Weekly Reflection Scheduled Task

**Problem**: Conversations are archived but never reviewed for patterns or lessons.

**Solution**: A scheduled task + skill that teaches the agent to review recent conversations, extract patterns, and update intelligence files. Host-side `learning-hooks.ts` re-indexes conversations after each session.

**Setup**: Run `setup-reflection-task.sh` from within a container, or create the task via the agent.

## 2. FTS5 Search Over Conversation Archives

**Problem**: 150K+ lines of archived conversations searchable only via grep.

**Solution**: SQLite FTS5 virtual table with porter stemming. Indexer runs on startup and every 30 minutes. Container agents search via IPC (`search_conversations` task type). Results include ranked snippets.

**Usage**: Agent writes `{"type":"search_conversations","query":"...","limit":5}` to IPC tasks directory.

## 3. Conversation Summary on Compaction

**Problem**: Pre-compaction hook archives raw transcripts but no structured summaries.

**Solution**: `generateConversationSummary()` extracts key facts, decisions, action items, and errors using heuristic regex patterns. Summaries written to `conversations/summaries/{date}-{name}.summary.md` (<1KB each). `loadRecentSummaries()` utility loads the most recent N summaries.

## 4. User Modeling

**Problem**: No persistent model of user preferences, communication patterns, or context.

**Solution**: `user-profile.md` per group with dual format: human-readable markdown + machine-parseable JSON. Auto-updated after each message batch. Tracks peak hours, active days, common topics, message length patterns, and session stats. Automatically available in containers via the group folder mount.

## 5. Trajectory Tagging

**Problem**: All conversations archived equally — no distinction between successes and failures.

**Solution**: YAML frontmatter on every archived conversation with: `message_count`, `has_tool_use`, `has_errors`, `topics` (top 5), `outcome` (success/error/incomplete), `duration_estimate`. Enables filtering and pattern analysis.

## 6. Cross-Group Knowledge Aggregation

**Problem**: Groups are fully isolated. Lessons learned in one group don't propagate.

**Solution**: Host-side aggregator runs every 6h. Scans all group profiles and conversation stats, probes FTS5 for cross-group topic frequency. Writes to `groups/global/CLAUDE.md` (2KB cap). Non-main groups mount this read-only. Preserves existing base content above the `---` delimiter.

## 7. Lifecycle Hooks System

**Problem**: Only pre-compaction hook exists. No broader event system for learning triggers.

**Solution**: Typed event emitter (`LifecycleHooks` singleton) with events: `session:start`, `session:end`, `session:output`, `task:start`, `task:end`, `compaction:complete`, `learning:indexed`. All emissions wrapped in try/catch. Used by learning-hooks.ts and available for future features.
