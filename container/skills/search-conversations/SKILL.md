---
name: search-conversations
description: Search past conversation archives using full-text search
---

# Search Conversations

You can search past conversation archives using full-text search. This is much faster than grepping through files manually.

## How to search

Write a JSON task file to the IPC directory:

```bash
echo '{"type":"search_conversations","query":"client proposal","limit":5}' > /workspace/ipc/tasks/search-$(date +%s).json
```

Then wait a moment and check for results:

```bash
cat /workspace/ipc/input/search-result-*.json 2>/dev/null
```

## Parameters

- **query** (required): The search query. Supports FTS5 syntax:
  - Simple words: `automation project` (matches documents containing both words)
  - Phrases: `"n8n workflow"` (matches exact phrase)
  - OR queries: `automation OR integration`
  - Prefix: `auto*` (matches words starting with "auto")
  - NOT: `automation NOT wordpress`
- **group_folder** (optional): Limit search to a specific group (e.g., `"main"`)
- **limit** (optional): Max results to return (default: 10, max: 50)

## Response format

Results are written to `/workspace/ipc/input/search-result-{timestamp}.json`:

```json
{
  "type": "search_conversations_result",
  "query": "client proposal",
  "results": [
    {
      "group_folder": "main",
      "filename": "2026-02-15-client-proposal-discussion.md",
      "title": "Client Proposal Discussion",
      "archived_at": "2026-02-15",
      "snippet": "...discussed the <mark>client</mark> <mark>proposal</mark> for the automation...",
      "rank": -5.2
    }
  ],
  "total": 1
}
```

## Tips

- Results are ranked by relevance (lower rank = better match)
- Snippets show context around matched terms with `<mark>` tags
- After finding relevant conversations, read the full file at `conversations/{filename}`
- The index updates automatically every 30 minutes
