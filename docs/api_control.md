# Backend API: Control and Debug

## Purpose
- define internal control, diagnostic, and admin-facing backend routes
- keep shared runtime and debug semantics close to the endpoints that use them

## Authoritative For
- run correlation semantics used by backend APIs
- health, internal ChatGPT action, config, and debug endpoint contracts

## Not Authoritative For
- public webhook contracts; use `docs/external_api.md`
- backend env/config ownership; use `docs/backend_runtime_env.md` and `docs/config_operations.md`

## Read When
- changing or reviewing health, debug, or internal ChatGPT action routes
- checking how run correlation or debug auth works

## Update When
- debug or config routes change
- internal ChatGPT action endpoints move or change auth/shape

## Related Docs
- `docs/api.md`
- `docs/external_api.md`
- `docs/database_schema.md`
- `docs/backend_runtime_env.md`

## Endpoint Map

| Endpoint family | Auth | Primary callers | Schema touched | Typical tests |
|---|---|---|---|---|
| Health | none | operators, probes | none | `test/server/control.api-contract.test.js`, `test/server.test.js` |
| Internal ChatGPT actions | admin secret | n8n ChatGPT workflows | `pkm.entries` | `test/server/chatgpt.api-contract.test.js`, `test/server/n8n.wf11-route-read-request.test.js` |
| Config and debug | mixed; debug routes require admin secret | operators, debug UI, WF99 | `runtime_config`, `pipeline_events`, `failure_packs` | `test/server/control.api-contract.test.js`, `test/server/config-module-compat.test.js`, `test/server/failure-pack.api-contract.test.js` |

## Run ID Correlation

- Preferred header: `X-PKM-Run-Id: <run_id>`
- Optional body field: `run_id` (used if header is not provided)
- Response header: `X-PKM-Run-Id` is always returned.

`run_id` is propagated through backend pipelines, LangGraph nodes, Postgres `pipeline_events`, and Braintrust metadata.

## Health

### `GET /health`
Returns a simple liveness check.

Response:
```json
{ "status": "ok" }
```

### `GET /ready`
Returns a readiness check.

Response:
```json
{ "status": "ready" }
```

### `GET /version`
Returns service name + version.

Response:
```json
{ "name": "pkm-backend", "version": "0.1.0" }
```

## ChatGPT Integration

### Read Path Used By ChatGPT n8n Workflow
n8n `11 ChatGPT Read Router` performs semantic routing and calls existing internal routes directly:
- `POST /db/read/pull`
- `POST /db/read/continue`
- `POST /db/read/last`
- `POST /db/read/find`
- `POST /chatgpt/working_memory`

The workflow then builds the context pack in n8n and returns that response to ChatGPT.

### `POST /chatgpt/working_memory`
Internal backend action route for topic-keyed working-memory retrieval.

Headers:
- `x-pkm-admin-secret: <secret>` (required)

Body:
```json
{
  "topic": "parenting"
}
```

Response:
```json
{
  "action": "chatgpt_read",
  "method": "pull_working_memory",
  "outcome": "success",
  "result": {
    "meta": {
      "method": "pull_working_memory",
      "topic": "parenting",
      "topic_key": "parenting",
      "found": true
    },
    "row": {
      "found": true
    }
  }
}
```

Notes:
- For node/provider-specific diagnostics, `pack.failure` may include additional optional fields.
- Telegram node parse failures may include:
  - `error_description`: raw Telegram API description when available
  - `telegram_error`: object with provider diagnostics (for example `is_markdownv2_parse_error`, `reserved_character`)
Notes:
- The backend query returns exactly one row.
- `result.meta.found` and `result.row.found` indicate hit/miss.
- On topic miss, `found=false` and the row contains empty/null content fields.

### `POST /chatgpt/wrap-commit`
Internal backend action route used by n8n `05 ChatGPT Wrap Commit`.

Headers:
- `x-pkm-admin-secret: <secret>` (required)

Body:
- same structured wrap payload contract previously used by `pkm.wrap_commit`.
- required:
  - `session_id`
  - `resolved_topic_primary`

Response:
```json
{
  "action": "chatgpt_wrap_commit",
  "outcome": "success",
  "result": {
    "meta": {
      "method": "wrap_commit",
      "session_id": "sess-123",
      "topic_primary": "parenting",
      "topic_key": "parenting"
    },
    "session_note": {},
    "working_memory": {},
    "artifacts": {}
  }
}
```

## Config

### `GET /config`
Returns the retrieval/scoring config as JSON (static; does not include test mode state).

Response:
```json
{
  "version": "v1",
  "db": { "is_test_mode": false, "schema_prod": "pkm", "schema_test": "pkm_test" },
  "failure_pack": {
    "schema_version": "failure-pack.v1",
    "redaction_ruleset_version": "v1",
    "sidecar_root_relative": "debug/failures",
    "inline_max_bytes": 65536
  },
  "distill": {
    "max_entries_per_run": 25,
    "direct_chunk_threshold_words": 5000
  },
  "scoring": {},
  "qualityThresholds": {},
  "metadataPaths": {}
}
```

### `GET /db/test-mode`
Returns the current test mode state.

Response:
```json
[
  { "is_test_mode": false }
]
```

### `POST /db/test-mode/toggle`
Toggles test mode and returns the resulting state.

Response:
```json
[
  { "is_test_mode": true }
]
```

### `POST /echo`
Internal utility/test route that echoes request content back to the caller.

Purpose:
- low-level request/JSON round-trip verification
- test helper for local backend smoke checks

Request:
- any body
- if `Content-Type: application/json`, backend parses JSON and returns structured payload

JSON response example:
```json
{
  "ok": true,
  "data": {
    "ping": true
  }
}
```

### `GET /debug/run/:run_id`
Returns pipeline transition events for one run id.

Headers:
- `x-pkm-admin-secret: <secret>` (required)

Query params:
- `limit` (optional, default `5000`)

Response:
```json
{
  "run_id": "n8n-12345",
  "rows": [
    {
      "run_id": "n8n-12345",
      "seq": 1,
      "step": "api.normalize.email",
      "direction": "start",
      "input_summary": {},
      "output_summary": {},
      "error": null
    }
  ]
}
```

### `GET /debug/run/last`
Returns events for the most recent `run_id` (same payload shape as `/debug/run/:run_id`).

Headers:
- `x-pkm-admin-secret: <secret>` (required)

Query params:
- `limit` (optional, default `5000`)

### `GET /debug/runs`
Returns recent run summaries from `pipeline_events`.

Headers:
- `x-pkm-admin-secret: <secret>` (required)

Query params:
- `limit` (optional, default `50`, max `200`)
- `before_ts` (optional ISO datetime, returns runs older than this timestamp)
- `has_error` (optional boolean: `true` or `false`)

Response:
```json
{
  "rows": [
    {
      "run_id": "2233",
      "started_at": "2026-02-22T05:10:01.000Z",
      "ended_at": "2026-02-22T05:10:05.000Z",
      "total_ms": 4000,
      "event_count": 14,
      "error_count": 0,
      "missing_end_count": 0
    }
  ],
  "limit": 50,
  "before_ts": null,
  "has_error": null
}
```

### `POST /debug/failures`
Upserts one failure pack by `run_id` (admin-only write path used by WF99).

Headers:
- `x-pkm-admin-secret: <secret>` (required)
- `X-PKM-Run-Id: <run_id>` (recommended)

Body:
- full `failure-pack.v1` envelope

Response:
```json
{
  "failure_id": "11111111-1111-4111-8111-111111111111",
  "run_id": "run-abc",
  "status": "captured",
  "upsert_action": "inserted"
}
```

### `GET /debug/failures/:failure_id`
Returns one persisted failure-pack row by `failure_id` (summary fields + `pack`).

Headers:
- `x-pkm-admin-secret: <secret>` (required)

### `GET /debug/failures/by-run/:run_id`
Returns one persisted failure-pack row by `run_id` (summary fields + `pack`).

Headers:
- `x-pkm-admin-secret: <secret>` (required)

### `GET /debug/failures`
Returns recent failure-pack summary rows.

Headers:
- `x-pkm-admin-secret: <secret>` (required)

Query params:
- `limit` (optional, default `20`, max `100`)
- `before_ts` (optional ISO datetime)
- `workflow_name` (optional contains filter)
- `node_name` (optional contains filter)
- `mode` (optional exact match)

Response:
```json
{
  "rows": [
    {
      "failure_id": "11111111-1111-4111-8111-111111111111",
      "run_id": "run-abc",
      "workflow_name": "WF 99 Error Handling",
      "node_name": "Normalize article",
      "error_message": "Request failed with status 500",
      "failed_at": "2026-03-28T20:00:00.000Z",
      "mode": "production",
      "status": "captured",
      "has_sidecars": true,
      "sidecar_root": "debug/failures/2026/03/28/run-abc/pack-sidecars"
    }
  ],
  "limit": 20,
  "before_ts": null,
  "workflow_name": null,
  "node_name": null,
  "mode": null
}
```

### `GET /debug/failure-bundle/:run_id`
Returns one merged diagnostic payload by `run_id`:
- failure summary
- stored failure pack
- pipeline trace rows from `/debug/run/:run_id` source data

Headers:
- `x-pkm-admin-secret: <secret>` (required)

Query params:
- `trace_limit` (optional, default `5000`)

Response:
```json
{
  "run_id": "run-abc",
  "failure": {
    "failure_id": "11111111-1111-4111-8111-111111111111",
    "workflow_name": "WF 99 Error Handling",
    "node_name": "Normalize article",
    "error_message": "Request failed with status 500",
    "failed_at": "2026-03-28T20:00:00.000Z",
    "mode": "production",
    "status": "captured"
  },
  "pack": {},
  "run_trace": {
    "run_id": "run-abc",
    "rows": []
  }
}
```
