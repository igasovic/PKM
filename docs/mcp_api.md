# PKM MCP API

ChatGPT-facing MCP surface for PKM.

This surface is intentionally separate from the generic backend API in `docs/api.md`.
`/mcp` exposes only approved `pkm.*` tools and does not proxy generic `/db/*` endpoints.

Base URL: `http://<host>:<port>`

## Transport

### Endpoint
- `POST /mcp`

### Auth
- v1 testing mode: no auth required on `/mcp`.

### Request modes

`/mcp` supports:
- plain MCP envelope (`action` + `params`)
- JSON-RPC 2.0 envelope (`jsonrpc`, `id`, `method`, `params`)
- SSE streaming transport when requested with:
  - `Accept: text/event-stream`, or
  - request body `{"transport":"sse", ...}`

SSE event sequence:
- `meta`
- `result` (or `error`)
- `done`

### Discovery request

Plain:
```json
{
  "action": "tools/list"
}
```

JSON-RPC:
```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "method": "tools/list",
  "params": {}
}
```

### Tool call request

Plain:
```json
{
  "action": "tools/call",
  "params": {
    "name": "pkm.last",
    "arguments": {
      "q": "ai",
      "days": 90,
      "limit": 10
    }
  }
}
```

JSON-RPC:
```json
{
  "jsonrpc": "2.0",
  "id": "req-2",
  "method": "tools/call",
  "params": {
    "name": "pkm.last",
    "arguments": {
      "q": "ai",
      "days": 90,
      "limit": 10
    }
  }
}
```

## Tools

Approved toolset:
- `pkm.last`
- `pkm.find`
- `pkm.continue`
- `pkm.pull`
- `pkm.pull_working_memory`
- `pkm.wrap_commit`

### `pkm.last`
Input:
- `q` (required string)
- `days` (optional positive integer)
- `limit` (optional positive integer)

Output (`result` in tool-call envelope):
```json
{
  "meta": {
    "method": "last",
    "q": "ai",
    "days": 90,
    "limit": 10,
    "hits": 1
  },
  "rows": [
    {
      "entry_id": 90,
      "content_type": "newsletter",
      "author": "Author",
      "title": "Title",
      "created_at": "2026-03-24T00:00:00.000Z",
      "topic_primary": "ai",
      "topic_secondary": "coding",
      "keywords": ["ai", "codex"],
      "gist": "...",
      "distill_summary": "...",
      "distill_why_it_matters": "...",
      "excerpt": "...",
      "url": "https://...",
      "snippet": "..."
    }
  ]
}
```

### `pkm.find`
Same response shape as `pkm.last`, with `meta.method = "find"`.

### `pkm.continue`
Same response shape as `pkm.last`, with `meta.method = "continue"`.

### `pkm.pull`
Input:
- `entry_id` (required positive integer)
- `shortN` (optional positive integer)
- `longN` (optional positive integer)

Output:
```json
{
  "meta": {
    "method": "pull",
    "entry_id": 90,
    "shortN": 320,
    "longN": 1800,
    "found": true
  },
  "row": {
    "entry_id": 90,
    "content_type": "newsletter",
    "author": "Author",
    "title": "Title",
    "created_at": "2026-03-24T00:00:00.000Z",
    "topic_primary": "ai",
    "topic_secondary": "coding",
    "keywords": ["ai", "codex"],
    "gist": "...",
    "distill_summary": "...",
    "distill_why_it_matters": "...",
    "excerpt": "...",
    "excerpt_long": "...",
    "clean_text": "...",
    "url": "https://..."
  }
}
```

### `pkm.pull_working_memory`
Input:
- `topic` (required string)

Output:
```json
{
  "meta": {
    "method": "pull_working_memory",
    "topic": "parenting",
    "topic_key": "parenting",
    "found": true
  },
  "row": {
    "entry_id": 102,
    "created_at": "2026-03-24T00:00:00.000Z",
    "topic_primary": "parenting",
    "topic_secondary": "overload management",
    "topic_secondary_confidence": 0.92,
    "title": "Working Memory: parenting",
    "gist": "...",
    "distill_summary": "...",
    "distill_why_it_matters": "...",
    "excerpt": "...",
    "working_memory_text": "## Topic: parenting\n...",
    "content_hash": "sha256...",
    "metadata": {}
  }
}
```

Rule:
- `working_memory_text` is canonical stored text and is not summarized.

### `pkm.wrap_commit`
Input (minimum required):
- `session_id` (required string)
- `resolved_topic_primary` (required string)

Optional:
- `resolved_topic_secondary`
- `topic_secondary_confidence` (`0..1`)
- `chat_title`
- `session_summary`
- `context_used[]`
- `key_insights[]`
- `decisions[]`
- `tensions[]`
- `open_questions[]`
- `next_steps[]`
- `working_memory_updates[]`
- `why_it_matters` (string or string[])
- `gist`
- `excerpt`
- `source_entry_refs[]` (positive integers)

Output:
```json
{
  "meta": {
    "method": "wrap_commit",
    "session_id": "sess-123",
    "topic_primary": "parenting",
    "topic_key": "parenting"
  },
  "session_note": {
    "entry_id": 101,
    "id": "uuid",
    "created_at": "2026-03-24T00:00:00.000Z",
    "action": "inserted",
    "title": "Session: Parenting reset",
    "topic_primary": "parenting",
    "topic_secondary": "overload management",
    "topic_secondary_confidence": 0.92,
    "idempotency_key_primary": "chatgpt:sess-123",
    "idempotency_key_secondary": "sha256..."
  },
  "working_memory": {
    "entry_id": 102,
    "id": "uuid",
    "created_at": "2026-03-24T00:00:00.000Z",
    "action": "updated",
    "title": "Working Memory: parenting",
    "topic_primary": "parenting",
    "topic_secondary": "overload management",
    "topic_secondary_confidence": 0.92,
    "idempotency_key_primary": "wm:parenting",
    "idempotency_key_secondary": "sha256..."
  },
  "artifacts": {
    "session_markdown": "# Session\n...",
    "working_memory_markdown": "## Topic: parenting\n..."
  }
}
```

Rules:
- one MCP write call persists both artifacts
- `capture_text` stores canonical markdown for both rows
- session notes and working-memory artifacts are written as ChatGPT-authored entries with direct field mapping and do not trigger T1/T2 enrichment flow

## Error contract

Plain envelope errors return HTTP `4xx/5xx`:
```json
{
  "error": "bad_request",
  "message": "session_id is required",
  "error_code": "missing_session_id",
  "field": "session_id"
}
```

JSON-RPC errors return HTTP `200` with `error`:
```json
{
  "jsonrpc": "2.0",
  "id": "req-2",
  "error": {
    "code": -32602,
    "message": "session_id is required",
    "data": {
      "error_code": "missing_session_id",
      "field": "session_id"
    }
  }
}
```
