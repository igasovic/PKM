# External API (Custom GPT Webhooks)

This document defines the **public ChatGPT-facing webhook surface**.

Scope:
- GPT/Custom GPT actions -> `n8n-hook.gasovic.com`
- n8n webhook contracts only

Out of scope:
- internal backend API contracts (`docs/api.md`)
- legacy MCP protocol details (`docs/archive/mcp_api.md`)

## Boundary

Supported public path:

```text
Custom GPT action
-> n8n webhook (public)
-> n8n routing/orchestration
-> pkm-server internal API
-> Postgres
```

Unsupported public path:

```text
Custom GPT -> pkm-server /mcp
Custom GPT -> pkm-server /db/*
```

## Base URL

- `https://n8n-hook.gasovic.com`

## Authentication

- External callers (Custom GPT actions) do not send backend admin secrets.
- Secret-bearing headers are added by n8n when it calls internal backend routes.

## Action schema

- Canonical OpenAPI schema for Custom GPT actions: `chatgpt/action_schema.yaml`

## Endpoints

### `POST /pkm/chatgpt/read`

Semantic read endpoint. n8n parses the command, routes to one backend read method, builds a context pack, and returns a normalized response.

Supported commands:
- `pull`
- `last`
- `continue`
- `find`
- `working_memory`

Minimal request examples:

```json
{ "cmd": "working_memory", "topic": "parenting" }
```

```json
{ "cmd": "continue", "query_text": "parenting bedtime resistance", "days": 30, "limit": 8 }
```

```json
{ "cmd": "pull", "entry_id": 1234 }
```

Success/no-result/failure all return a normalized envelope from WF11:

```json
{
  "http_status": 200,
  "ok": true,
  "action": "chatgpt_read",
  "method": "continue",
  "outcome": "success",
  "no_result": false,
  "context_pack_markdown": "...",
  "result": {
    "meta": {
      "method": "continue",
      "query_text": "parenting bedtime resistance",
      "days": 30,
      "limit": 8,
      "found": true,
      "row_count": 3
    },
    "rows": []
  },
  "error": null
}
```

Invalid input returns `ok=false`, `outcome=failure`, and an `error` object.

### `POST /pkm/chatgpt/wrap-commit`

Commit endpoint for wrap artifacts. n8n validates payload and forwards to internal backend capture flow.

Required request fields:
- `session_id`
- `resolved_topic_primary`

Example request:

```json
{
  "session_id": "chatgpt-session-001",
  "resolved_topic_primary": "parenting",
  "session_summary": "...",
  "key_insights": ["..."]
}
```

Response envelope:

```json
{
  "ok": true,
  "action": "chatgpt_wrap_commit",
  "outcome": "success",
  "result": {
    "meta": {
      "method": "wrap_commit",
      "session_id": "chatgpt-session-001",
      "topic_primary": "parenting"
    },
    "session_note": {},
    "working_memory": {}
  }
}
```

## Source-of-truth split

- `docs/external_api.md`: public webhook contracts for Custom GPT actions.
- `docs/api.md`: internal backend contracts used by n8n (`/db/read/*`, `/chatgpt/*`).
