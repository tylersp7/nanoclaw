---
name: session-context
description: Persistent session context across compactions
---

# Session Context

A rolling context file is maintained at `/workspace/group/session-context.md`.

This file contains summaries of recent conversation sessions, including:
- Key facts and outcomes
- Decisions made
- Pending action items
- Topics discussed

The file is automatically updated when conversation context is compacted. Read it when you need to recall what was discussed in earlier parts of a long conversation or in recent previous sessions.

It complements the conversation summaries in `conversations/summaries/` which provide more detailed per-session breakdowns.
