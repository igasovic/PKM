# External API (Custom GPT Webhooks)

## Purpose
- define the authoritative public webhook surface used by ChatGPT / Custom GPT actions
- keep public webhook contracts separate from internal backend contracts

## Authoritative For
- public request and response contracts exposed via `n8n-hook.gasovic.com`
- public-path boundary and authentication expectations

## Not Authoritative For
- internal backend endpoint contracts; use `docs/api.md` and the relevant `docs/api_*.md` file
- runtime topology and service exposure; use `docs/service_dependency_graph.md`

## Read When
- changing ChatGPT / Custom GPT action behavior
- reviewing public webhook contract drift
- planning any change that crosses the public/private boundary

## Update When
- public webhook paths or envelopes change
- public auth, action schema, or deprecation status changes

This document defines the **public ChatGPT-facing webhook surface**.

Scope:
- GPT/Custom GPT actions -> `n8n-hook.gasovic.com`
- n8n webhook contracts only

Out of scope:
- internal backend API contracts (`docs/api.md`, relevant `docs/api_*.md`)
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
Custom GPT -> pkm-server /db/*
```

## Base URL

- `https://n8n-hook.gasovic.com/webhook`

## Authentication

- External callers (Custom GPT actions) do not send backend admin secrets.
- Secret-bearing headers are added by n8n when it calls internal backend routes.

## Action schema

- Canonical OpenAPI schema for Custom GPT actions: `chatgpt/action_schema.yaml`

## Status Semantics
- Handled action responses return normalized JSON envelopes from n8n.
- Validation or no-result outcomes are represented inside the envelope (`ok`, `outcome`, `error`, `no_result`) rather than requiring callers to infer meaning from transport status alone.
- Unhandled webhook/runtime failures may still surface as non-2xx transport errors.

## Error Envelope

Handled failures use the normalized action shape:

```json
{
  "ok": false,
  "action": "chatgpt_read",
  "outcome": "failure",
  "error": {
    "code": "invalid_input",
    "message": "..."
  }
}
```

Current status guidance:
- `200`: handled success, no-result, or normalized business/input failure
- `4xx` / `5xx`: transport-level webhook failure, misrouting, or unhandled runtime failure

## Endpoints

| Endpoint | Purpose | Caller | Auth model |
|---|---|---|---|
| `POST /webhook/pkm/chatgpt/read` | semantic read orchestration | ChatGPT / Custom GPT action | public caller; n8n adds internal secrets downstream |
| `POST /webhook/pkm/chatgpt/wrap-commit` | wrap artifact commit orchestration | ChatGPT / Custom GPT action | public caller; n8n adds internal secrets downstream |

### `POST /webhook/pkm/chatgpt/read`

Semantic read endpoint. n8n parses the command, routes to one backend read method, builds a context pack, and returns a normalized response.

Request fields:

| Field | Required | Notes |
|---|---|---|
| `cmd` | yes | one of `pull`, `last`, `continue`, `find`, `working_memory` |
| `topic` | conditional | required for `working_memory` |
| `query_text` | conditional | required for semantic query methods such as `continue` / `find` |
| `days` | no | optional retrieval window |
| `limit` | no | optional result limit |
| `entry_id` | conditional | required for `pull` |

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

Response fields:

| Field | Present when | Notes |
|---|---|---|
| `http_status` | success envelope | normalized status for callers |
| `ok` | always | action success boolean |
| `action` | always | `chatgpt_read` |
| `method` | success envelope | routed read method |
| `outcome` | always | `success`, `no_result`, or `failure` |
| `no_result` | success envelope | explicit no-result marker |
| `context_pack_markdown` | success / no-result | rendered context pack |
| `result` | success / no-result | backend/n8n result payload |
| `error` | failure or normalized validation issue | compact error object |

### `POST /webhook/pkm/chatgpt/wrap-commit`

Commit endpoint for wrap artifacts. n8n validates payload and forwards to internal backend capture flow.

Request fields:

| Field | Required | Notes |
|---|---|---|
| `session_id` | yes | primary session identifier |
| `resolved_topic_primary` | yes | normalized topic key for working memory |
| `session_summary` | no | optional summary artifact input |
| `key_insights` | no | optional list of insights |
| `topic_patch` | no | optional explicit topic-state patch (question/action status operations) |
| other wrap fields | no | forwarded when accepted by the workflow/backend contract |

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

Response fields:

| Field | Present when | Notes |
|---|---|---|
| `ok` | always | action success boolean |
| `action` | always | `chatgpt_wrap_commit` |
| `outcome` | always | `success` or `failure` |
| `result.meta` | success | method/session/topic metadata |
| `result.session_note` | success | persisted session-note artifact summary |
| `result.working_memory` | success | persisted working-memory artifact summary |
| `error` | failure | compact error object |

## Source-of-truth split

- `docs/external_api.md`: public webhook contracts for Custom GPT actions.
- `docs/api.md`: internal API index and shared conventions.
- `docs/api_read_write.md`: internal `/db/read/*` and related read/write contracts used by n8n.
- `docs/api_control.md`: internal `/chatgpt/*` and related control-plane contracts used by n8n.

## Versioning and Deprecation
- Keep public contract changes explicit in this file when paths, envelopes, or auth expectations change.
- When a public path is deprecated, document the replacement path and transition status here at the same time.
