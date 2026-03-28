# PKM Backend API

Base URL: `http://<host>:<port>`

This service exposes a minimal JSON API intended for internal systems (e.g., n8n) to read/write entries in Postgres. All endpoints accept `application/json` and return JSON.

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

### `POST /mcp`
Legacy MCP endpoint.

Boundary rules:
- `/mcp` is no longer the supported ChatGPT integration path.
- ChatGPT integration now runs through GPT actions routed to n8n webhooks.

Current response:
- HTTP `410`
- payload:
```json
{
  "error": "legacy_disabled",
  "message": "/mcp is legacy and disabled for ChatGPT integration; use GPT actions routed through n8n webhooks"
}
```

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

## Normalization

All normalization endpoints derive `content_hash` from the returned `clean_text`:
- algorithm: SHA-256 over UTF-8 bytes of `clean_text`
- `content_hash = null` when `clean_text` is missing/blank

### `POST /normalize/telegram`
Normalizes a Telegram capture into a `pkm.entries`-compatible payload.
`source.system` is inferred by backend as `"telegram"` from this endpoint.

Body:
```json
{
  "text": "raw telegram message",
  "source": {
    "chat_id": "123",
    "message_id": "456"
  }
}
```

`url` is optional in input. Normalization extracts links from `text` and computes canonical URL internally.

Response:
```json
{
  "source": "telegram",
  "intent": "think",
  "content_type": "note",
  "capture_text": "...",
  "clean_text": "...",
  "content_hash": "3b066804f6d1d077173cfe4d06002e6a61e6f21c2b2e648417962115f1afcd8e",
  "retrieval_excerpt": "...",
  "clean_word_count": 10,
  "clean_char_count": 200,
  "extracted_char_count": 0,
  "link_count": 1,
  "link_ratio": 0.1,
  "boilerplate_heavy": false,
  "low_signal": false,
  "quality_score": 0.7,
  "idempotency_policy_key": "telegram_thought_v1",
  "idempotency_key_primary": "tg:123:456",
  "idempotency_key_secondary": "f8a9...",
  "metadata": { "retrieval": { "version": "v1" } }
}
```

### `POST /normalize/email`
Normalizes a raw IMAP text/plain payload into a `pkm.entries`-compatible payload.
`source.system` is inferred by backend as `"email"` from this endpoint.

Body:
```json
{
  "raw_text": "raw IMAP text/plain message",
  "from": "Sender Name <sender@example.com>",
  "subject": "Email subject line",
  "source": {
    "message_id": "<abc@example.com>",
    "date": "2026-02-12T10:00:00Z"
  }
}
```

Notes:
- `from` and `subject` are read from top-level request fields.
- Do not send `source.from_addr` or `source.subject` for `/normalize/email`.

Response:
```json
{
  "source": "email",
  "intent": "archive",
  "content_type": "newsletter",
  "capture_text": "...",
  "clean_text": "...",
  "content_hash": "3b066804f6d1d077173cfe4d06002e6a61e6f21c2b2e648417962115f1afcd8e",
  "retrieval_excerpt": "...",
  "clean_word_count": 10,
  "clean_char_count": 200,
  "extracted_char_count": 0,
  "link_count": 1,
  "link_ratio": 0.1,
  "boilerplate_heavy": false,
  "low_signal": false,
  "quality_score": 0.7,
  "idempotency_policy_key": "email_newsletter_v1",
  "idempotency_key_primary": "<abc@example.com>",
  "idempotency_key_secondary": "7c7d...",
  "metadata": { "retrieval": { "version": "v1" } }
}
```

### `POST /normalize/email/intent`
Detects email intent and returns the resulting `content_type` based on raw IMAP text/plain.

Body:
```json
{ "textPlain": "raw IMAP text/plain message" }
```

Response:
```json
{ "content_type": "newsletter" }
```

### `POST /normalize/webpage`
Normalizes extracted webpage/article text and recomputes retrieval excerpt + quality in one call.
Designed for update flows where output can be sent directly to `/db/update`.

Body:
```json
{
  "text": "raw extracted webpage text",
  "capture_text": "optional original capture text",
  "content_type": "newsletter",
  "url": "https://example.com/article",
  "url_canonical": "https://example.com/article",
  "excerpt": "optional excerpt override"
}
```

Notes:
- `text` is preferred input and is mapped to `extracted_text`.
- If `clean_text` is provided instead, it is used as the cleaning input.
- If cleaned text is empty, response includes `retrieval_update_skipped: true`.
- If `excerpt` is provided, it is used as excerpt override.

Response:
```json
{
  "extracted_text": "...",
  "extracted_len": 12000,
  "clean_text": "...",
  "content_hash": "3b066804f6d1d077173cfe4d06002e6a61e6f21c2b2e648417962115f1afcd8e",
  "clean_len": 9800,
  "retrieval_excerpt": "...",
  "clean_word_count": 1400,
  "clean_char_count": 9800,
  "extracted_char_count": 12000,
  "link_count": 12,
  "link_ratio": 0.008,
  "boilerplate_heavy": false,
  "low_signal": false,
  "quality_score": 0.82,
  "metadata": { "retrieval": { "version": "v1" } }
}
```

### `POST /normalize/notion`
Normalizes a Notion page payload into a `pkm.entries`-compatible payload.
`source.system` is inferred by backend as `"notion"` from this endpoint.

Body:
```json
{
  "id": "abc123",
  "updated_at": "2026-02-24T14:30:00.000Z",
  "content_type": "note",
  "title": "Idea title",
  "url": "https://example.com",
  "capture_text": "Rendered Notion page text"
}
```

Rules:
- `id` (or `page_id`) is required.
- `updated_at` is required and must come from Notion DB Last edited time property.
- `content_type` defaults to `note` only when missing/empty.
- allowed content types: `note|newsletter|correspondence|other`.
- request input does not require `notion{}` block.
- backend always resolves page content by `id` via Notion API block fetch.
- `capture_text` is optional override and is treated as the same body field used for normalization.
- Notion API collection requires `NOTION_API_TOKEN` in backend environment.
- if fetched blocks include unsupported block types, item is skipped with `skipped=true` and `skip_errors[]` (HTTP 200, non-fatal).

Response (normal case):
```json
{
  "source": "notion",
  "intent": "think",
  "content_type": "note",
  "title": "Idea title",
  "capture_text": "...",
  "clean_text": "...",
  "content_hash": "3b066804f6d1d077173cfe4d06002e6a61e6f21c2b2e648417962115f1afcd8e",
  "external_ref": {
    "notion": {
      "page_id": "abc123",
      "database_id": "db123",
      "page_url": "https://www.notion.so/..."
    }
  },
  "metadata": {
    "notion": {
      "updated_at": "2026-02-24T14:30:00.000Z"
    }
  },
  "idempotency_policy_key": "notion_note_v1",
  "idempotency_key_primary": "notion:abc123",
  "idempotency_key_secondary": null
}
```

Response (unsupported blocks):
```json
{
  "skipped": true,
  "skip_reason": "unsupported_block_type",
  "skip_errors": [
    {
      "source": "notion",
      "notion_page_id": "abc123",
      "block_type": "table",
      "block_id": "..."
    }
  ]
}
```

## Calendar

All calendar endpoints are admin-protected and require:
- `x-pkm-admin-secret: <secret>`

These endpoints are intended for n8n calendar workflows and do not mutate Google Calendar directly.

### `POST /telegram/route`
Classifies non-command Telegram text into calendar vs PKM routing intents.

Body:
```json
{
  "text": "Mila dentist tomorrow at 3:00p",
  "actor_code": "igor",
  "source": { "chat_id": "1509032341", "message_id": "777", "user_id": "111111111" },
  "run_id": "tg-route-123"
}
```

Response:
```json
{
  "route": "calendar_create",
  "confidence": 0.93,
  "request_id": "9f678f95-8f9f-4f31-8e53-b97f1d9fafe4"
}
```

Possible routes:
- `pkm_capture`
- `calendar_create`
- `calendar_query`
- `ambiguous`

Continuation rule:
- for non-structured text (not starting with `/`, `cal:`, or `pkm:`), router checks latest open calendar clarification request in chat
- if one exists, router forces `calendar_create` and returns the existing `request_id`
- structured inputs are never continuation-overridden

For `ambiguous`, response may include:
- `clarification_question`
- `access_denied_reason` (when route was downgraded by Telegram allowlist policy)

When calendar Telegram allowlist enforcement is enabled, disallowed routes are downgraded to
`ambiguous` with an access clarification message instead of returning `pkm_capture`/calendar routes.

### `POST /calendar/normalize`
Normalizes calendar-create intent and drives clarification flow state.

Behavior:
- uses `request_id` when supplied
- otherwise creates/uses request row keyed by Telegram idempotency key (`tgcal:<chat_id>:<message_id>`)
- continuation without `request_id` is intentionally not inferred here; router endpoint owns continuation selection

Body:
```json
{
  "raw_text": "Mila dentist tomorrow at 3:00p for 60 min at home",
  "actor_code": "igor",
  "source": { "chat_id": "1509032341", "message_id": "777", "user_id": "111111111" },
  "run_id": "cal-norm-123",
  "include_trace": false
}
```

`include_trace`:
- optional boolean
- when `true`, response includes `normalize_trace` (graph metadata for eval/debug)

Response (`needs_clarification`):
```json
{
  "request_id": "f12556d4-c454-4885-a89c-d61dc28db3fd",
  "status": "needs_clarification",
  "missing_fields": ["start_time"],
  "clarification_question": "I can add this, but I still need the start time.",
  "normalized_event": null,
  "warning_codes": [],
  "message": null,
  "request_status": "needs_clarification",
  "normalize_trace": {
    "llm_used": false,
    "llm_reason": "litellm_not_configured",
    "parse_status": "skipped",
    "status": "needs_clarification"
  }
}
```

Response (`ready_to_create`):
```json
{
  "request_id": "f12556d4-c454-4885-a89c-d61dc28db3fd",
  "status": "ready_to_create",
  "missing_fields": [],
  "clarification_question": null,
  "normalized_event": {
    "timezone": "America/Chicago",
    "title": "Mila dentist",
    "date_local": "2026-03-13",
    "start_time_local": "15:00",
    "end_date_local": "2026-03-13",
    "end_time_local": "16:00",
    "duration_minutes": 60,
    "people_codes": ["M"],
    "category_code": "MED",
    "location": "home",
    "subject_code": "[M][MED] 3:00p Mila dentist",
    "color_choice": {
      "logical_color": "purple",
      "google_color_id": "3",
      "telegram_marker": "purple"
    },
    "original_start": { "date_local": "2026-03-13", "time_local": "15:00" },
    "block_window": {
      "start_date_local": "2026-03-13",
      "start_time_local": "15:00",
      "end_date_local": "2026-03-13",
      "end_time_local": "16:00",
      "padded": false,
      "pad_before_minutes": 0,
      "pad_after_minutes": 0
    }
  },
  "warning_codes": [],
  "message": null,
  "request_status": "normalized"
}
```

Response (`rejected`):
```json
{
  "request_id": "f12556d4-c454-4885-a89c-d61dc28db3fd",
  "status": "rejected",
  "missing_fields": [],
  "clarification_question": null,
  "normalized_event": null,
  "warning_codes": [],
  "message": "All-day event creation is not supported in v1. Please provide a start time and duration.",
  "request_status": "ignored"
}
```

`rejected` may also be returned for access policy reasons (for example, sender not in calendar allowlist).

### `POST /calendar/finalize`
Persists final create outcome after n8n Google Calendar write.

Body:
```json
{
  "request_id": "3243fcdd-e81c-4c94-aa79-d8d8f99bb9dd",
  "success": true,
  "google_calendar_id": "family@group.calendar.google.com",
  "google_event_id": "abc123",
  "run_id": "cal-finalize-123"
}
```

Rules:
- `request_id` is required.
- status is taken from `status` / `final_status`, or mapped from `success`:
  - `success=true` -> `calendar_created`
  - `success=false` -> `calendar_failed`

Response:
```json
{
  "request_id": "3243fcdd-e81c-4c94-aa79-d8d8f99bb9dd",
  "status": "calendar_created",
  "google_calendar_id": "family@group.calendar.google.com",
  "google_event_id": "abc123",
  "finalize_action": "updated"
}
```

If request is missing:
```json
{ "error": "not_found", "message": "request not found" }
```

### `POST /calendar/observe`
Logs externally visible events observed by read/report workflows.

Body:
```json
{
  "run_id": "run-1",
  "items": [
    {
      "google_calendar_id": "family@group.calendar.google.com",
      "google_event_id": "evt-1",
      "observation_kind": "daily_report_seen",
      "source_type": "external_unknown",
      "event_snapshot": { "title": "External event" },
      "resolved_people": ["M"],
      "resolved_color": "purple",
      "was_reported": true
    }
  ]
}
```

Response:
```json
{
  "inserted": 1,
  "rows": [
    {
      "observation_id": "8f31011e-df9a-4ddf-b597-21eb14502b86",
      "run_id": "run-1",
      "google_calendar_id": "family@group.calendar.google.com",
      "google_event_id": "evt-1",
      "observation_kind": "daily_report_seen",
      "source_type": "external_unknown",
      "was_reported": true,
      "created_at": "2026-03-12T12:00:00.000Z"
    }
  ]
}
```

## Enrichment

### `POST /enrich/t1`
Runs Tier‑1 enrichment (topics/keywords/gist) for a given clean text.

Body:
```json
{
  "title": "Optional title",
  "author": "Optional author",
  "clean_text": "Required clean text"
}
```

Response:
```json
{
  "topic_primary": "ai",
  "topic_primary_confidence": 0.72,
  "topic_secondary": "model evals",
  "topic_secondary_confidence": 0.61,
  "keywords": ["evals", "benchmarks", "alignment", "robustness", "bias"],
  "gist": "One sentence summary.",
  "flags": { "boilerplate_heavy": false, "low_signal": false }
}
```

### `POST /enrich/t1/batch`
Creates a LiteLLM/OpenAI-compatible Batch job for Tier‑1 enrichment and persists mapping in Postgres.

Body:
```json
{
  "items": [
    {
      "custom_id": "entry_123",
      "title": "Optional title",
      "author": "Optional author",
      "content_type": "newsletter",
      "clean_text": "Required clean text"
    }
  ],
  "completion_window": "24h",
  "metadata": { "source": "n8n" }
}
```

Response:
```json
{
  "batch_id": "batch_abc123",
  "status": "validating",
  "schema": "pkm",
  "request_count": 1
}
```

Batch completion handling is internal to backend workers. External callers only enqueue via `/enrich/t1/batch`.

### `GET /status/batch`
Returns current batch job status for a stage (`t1` or `t2`).

Query params:
- `stage` optional (`t1` default, `t2` supported)
- `limit` optional, default `50`, max `200`
- `schema` optional (`pkm` or `pkm_test`), used only for `stage=t1`
- `include_terminal` optional boolean
  - `stage=t1` default `false`
  - `stage=t2` default `true`

Response:
```json
{
  "summary": {
    "jobs": 2,
    "in_progress": 1,
    "terminal": 1,
    "total_items": 1000,
    "processed": 700,
    "pending": 300,
    "ok": 650,
    "parse_error": 30,
    "error": 20
  },
  "jobs": [
    {
      "schema": "pkm",
      "batch_id": "batch_abc123",
      "status": "in_progress",
      "is_terminal": false,
      "model": "t1-batch",
      "request_count": 500,
      "counts": {
        "total_items": 500,
        "processed": 320,
        "ok": 300,
        "parse_error": 10,
        "error": 10,
        "pending": 180
      },
      "input_file_id": "file_in_123",
      "output_file_id": "file_out_123",
      "error_file_id": null,
      "metadata": {},
      "created_at": "2026-02-18T10:00:00.000Z",
      "updated_at": "2026-02-18T10:05:00.000Z"
    }
  ]
}
```

Notes:
- `stage=t2` status rows are sourced from durable Tier‑2 batch tables (`t2_batches`, `t2_batch_items`, `t2_batch_item_results`).
- For `stage=t2`, failed runs may include `metadata.error` with a compact run-level failure summary.
- For `stage=t2`, job metadata may include:
  - `execution_mode` (`batch` or `sync`)
  - `error_code_counts` (per-run failure-code aggregate map)
- For `stage=t2` dry-run jobs, `counts.pending` is `0` and planned work size is reported as `metadata.will_process_count`.

### `GET /status/batch/:batch_id`
Returns one batch by id for a stage (`t1` or `t2`), with aggregate counters and optional item-level statuses.

Query params:
- `stage` optional (`t1` default, `t2` supported)
- `schema` optional (`pkm` or `pkm_test`), used only for `stage=t1`
- `include_items` optional boolean, default `false`
- `items_limit` optional, default `200`, max `1000` (used only when `include_items=true`)

Response:
```json
{
  "schema": "pkm",
  "batch_id": "batch_abc123",
  "status": "in_progress",
  "is_terminal": false,
  "model": "t1-batch",
  "request_count": 500,
  "counts": {
    "total_items": 500,
    "processed": 320,
    "ok": 300,
    "parse_error": 10,
    "error": 10,
    "pending": 180
  },
  "input_file_id": "file_in_123",
  "output_file_id": "file_out_123",
  "error_file_id": null,
  "metadata": {},
  "created_at": "2026-02-18T10:00:00.000Z",
  "updated_at": "2026-02-18T10:05:00.000Z",
  "items": [
    {
      "custom_id": "entry_1",
      "status": "ok",
      "title": "Sample",
      "author": "Author",
      "content_type": "newsletter",
      "prompt_mode": "sampled",
      "has_error": false,
      "created_at": "2026-02-18T10:00:10.000Z",
      "updated_at": "2026-02-18T10:03:10.000Z"
    }
  ]
}
```

Notes:
- For `stage=t2`, failed runs may include `metadata.error` with a compact run-level failure summary.
- For `stage=t2` with `include_items=true`, item rows may include:
  - `entry_id`
  - `error_code`
  - `message`
  - `preserved_current_artifact`

Legacy aliases kept for backward compatibility:
- `GET /status/t1/batch` (equivalent to `GET /status/batch?stage=t1`)
- `GET /status/t1/batch/:batch_id` (equivalent to `GET /status/batch/:batch_id?stage=t1`)

## Tier-2 Distillation

### `POST /distill/sync`
Runs Tier‑2 distillation synchronously for one existing entry in production schema (`pkm`) and persists the validated artifact on success.

Headers:
- `x-pkm-admin-secret: <secret>` (required)

Body:
```json
{
  "entry_id": 12345
}
```

Notes:
- This endpoint is sync-only and does not enqueue async batch work.
- It requires existing usable `clean_text` on the target row.
- It applies Tier‑2 route selection (`direct` vs `chunked`) from backend config.
- On validation failure, response returns `status = "failed"` and artifact fields are `null`.
- Final persistence is guarded by currentness (`content_hash` must still match the generated artifact source hash).
  - If source content changed mid-run, response returns `error_code = "currentness_mismatch"` and no write is applied.
- If the row already has a current completed artifact (`distill_status=completed` and matching `distill_created_from_hash`),
  sync failures do not overwrite it; failure response includes `preserved_current_artifact: true`.

Response (success):
```json
{
  "entry_id": 12345,
  "status": "completed",
  "summary": "One-paragraph Tier-2 summary",
  "excerpt": "Optional grounded excerpt",
  "why_it_matters": "Why this should matter later.",
  "stance": "analytical"
}
```

Response (validation or generation failure):
```json
{
  "entry_id": 12345,
  "status": "failed",
  "summary": null,
  "excerpt": null,
  "why_it_matters": null,
  "stance": null,
  "error_code": "excerpt_not_grounded",
  "message": "Optional failure message (present for generation/runtime errors)."
}
```

### `POST /distill/plan`
Runs Tier‑2 control-plane selection for the active schema, persists eligibility outcomes (`skipped` / `not_eligible`) when enabled, and returns the selected workset.

Headers:
- `x-pkm-admin-secret: <secret>` (required)

Body (all fields optional):
```json
{
  "candidate_limit": 250,
  "persist_eligibility": true,
  "include_details": false
}
```

Notes:
- `candidate_limit` must be a positive integer when provided.
- `persist_eligibility` defaults to `true`.
- `include_details=true` runs the second pre-dispatch detail query and returns selected rows projected without `clean_text`.

Response:
```json
{
  "target_schema": "active",
  "candidate_count": 120,
  "decision_counts": {
    "proceed": 42,
    "skipped": 55,
    "not_eligible": 23
  },
  "persisted_eligibility": {
    "updated": 78,
    "groups": [
      { "status": "skipped", "reason_code": "missing_clean_text", "count": 55, "updated": 55 },
      { "status": "not_eligible", "reason_code": "wrong_content_type", "count": 23, "updated": 23 }
    ]
  },
  "selected_count": 25,
  "selected": [
    {
      "id": "00000000-0000-4000-8000-000000000000",
      "entry_id": 12345,
      "route": "direct",
      "chunking_strategy": "direct",
      "priority_score": 74,
      "clean_word_count": 1800,
      "distill_status": "pending",
      "created_at": "2026-03-01T00:00:00.000Z"
    }
  ]
}
```

### `POST /distill/run`
Runs one Tier‑2 batch cycle for production schema (`pkm`): control-plane planning plus async provider-batch enqueue (or planning-only in dry-run mode).

Headers:
- `x-pkm-admin-secret: <secret>` (required)

Body (all fields optional):
```json
{
  "execution_mode": "batch",
  "candidate_limit": 250,
  "max_sync_items": 25,
  "persist_eligibility": true,
  "dry_run": false
}
```

Notes:
- `execution_mode` supports:
  - `batch` (default): standard `/distill/run` execution path.
  - `sync`: explicit synchronous mode (use only when intentionally requested).
- `candidate_limit` and `max_sync_items` must be positive integers when provided.
- `dry_run=true` runs planning only and does not call Tier‑2 generation.
- This endpoint always targets production schema for execution.
- In non-dry-run mode, selected entries are enqueued into LiteLLM batch processing and marked `distill_status = queued` only after successful dispatch.
- Per-entry generation/validation/persistence runs asynchronously during collect cycles; inspect outcomes via `GET /status/batch?stage=t2` and `GET /status/batch/:batch_id?stage=t2`.
- Non-busy responses include `batch_id` for `/status/batch` lookup.
- If a run is requested while the Tier‑2 batch worker loop is already active, the response is:
  - `mode = "skipped"`
  - `reason = "worker_busy"`
  - no batch-history record is written for that skipped call.

Response:
```json
{
  "mode": "run",
  "execution_mode": "batch",
  "target_schema": "pkm",
  "batch_id": "t2_1739420000000_ab12cd",
  "batch_status": "validating",
  "processing_limit": 25,
  "candidate_count": 120,
  "decision_counts": {
    "proceed": 42,
    "skipped": 55,
    "not_eligible": 23
  },
  "persisted_eligibility": {
    "updated": 78,
    "groups": []
  },
  "planned_selected_count": 25,
  "processed_count": 0,
  "completed_count": 0,
  "failed_count": 0,
  "preserved_current_count": 0,
  "error_code_counts": {},
  "results": []
}
```

Notes:
- Batch-mode `processed_count` / `completed_count` / `failed_count` in `/distill/run` are enqueue-cycle counters, not final per-item completion.
- Final per-item outcomes are surfaced through status endpoints and include `error_code`, optional `message`, and `preserved_current_artifact` where applicable.

Response (worker busy):
```json
{
  "mode": "skipped",
  "target_schema": "pkm",
  "skipped": true,
  "reason": "worker_busy",
  "message": "Tier-2 batch worker is busy. Try again shortly."
}
```

Response (runtime failure, normalized):
```json
{
  "mode": "run",
  "execution_mode": "batch",
  "target_schema": "pkm",
  "batch_id": "t2_1739420000000_ab12cd",
  "processing_limit": 25,
  "candidate_count": 0,
  "decision_counts": {
    "proceed": 0,
    "skipped": 0,
    "not_eligible": 0
  },
  "persisted_eligibility": {
    "updated": 0,
    "groups": []
  },
  "planned_selected_count": 0,
  "processed_count": 0,
  "completed_count": 0,
  "failed_count": 1,
  "preserved_current_count": 0,
  "results": [],
  "error": "planner unavailable"
}
```

## Backlog Import

### `POST /import/email/mbox`
Imports a `.mbox` backlog file, normalizes each email synchronously, inserts idempotently, removes duplicate rows (`action = "skipped"`) from enrichment input, and enqueues the remaining rows to Tier‑1 Batch API.

Body:
```json
{
  "mbox_path": "backlog/emails_2026_02.mbox",
  "batch_size": 500,
  "insert_chunk_size": 200,
  "completion_window": "24h",
  "max_emails": 5000,
  "metadata": { "source": "n8n-wp4" }
}
```

Notes:
- `mbox_path` is required and must point to a `.mbox` file under `EMAIL_IMPORT_ROOT` (default `/data`).
- `batch_size` is Tier‑1 enqueue size and must be between `500` and `2000` (default `500`).
- `insert_chunk_size` controls DB insert chunking (default `200`).
- Source for inserted rows is set to `email-batch`.

Response:
```json
{
  "import_id": "email_backlog_1739420000000",
  "mbox_path": "backlog/emails_2026_02.mbox",
  "total_messages": 5000,
  "normalized_ok": 4987,
  "normalize_errors": 13,
  "inserted": 3100,
  "updated": 420,
  "skipped": 1467,
  "insert_errors": 0,
  "tier1_candidates": 3520,
  "tier1_batches": [
    { "batch_id": "batch_abc", "status": "validating", "schema": "pkm", "request_count": 500 }
  ],
  "tier1_enqueued_items": 3520,
  "errors": []
}
```

Worker controls (optional env vars):
- `T1_BATCH_WORKER_ENABLED` (`true` by default)
- `T1_BATCH_SYNC_INTERVAL_MS` (`60000` default)
- `T1_BATCH_SYNC_LIMIT` (`20` default)

### Batch persistence tables
Batch APIs require these tables in both schemas (`pkm` and `pkm_test`) so restart recovery works in test mode and prod mode.

```sql
CREATE TABLE IF NOT EXISTS pkm.t1_batches (
  batch_id text PRIMARY KEY,
  status text,
  model text,
  input_file_id text,
  output_file_id text,
  error_file_id text,
  request_count int,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pkm.t1_batch_items (
  batch_id text NOT NULL,
  custom_id text NOT NULL,
  title text,
  author text,
  content_type text,
  prompt_mode text,
  prompt text,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (batch_id, custom_id)
);

CREATE TABLE IF NOT EXISTS pkm.t1_batch_item_results (
  batch_id text NOT NULL,
  custom_id text NOT NULL,
  status text NOT NULL,
  response_text text,
  parsed jsonb,
  error jsonb,
  raw jsonb,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (batch_id, custom_id)
);

CREATE TABLE IF NOT EXISTS pkm.t2_batches (
  batch_id text PRIMARY KEY,
  status text,
  model text,
  request_type text,
  input_file_id text,
  output_file_id text,
  error_file_id text,
  request_count int,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pkm.t2_batch_items (
  batch_id text NOT NULL,
  custom_id text NOT NULL,
  entry_id bigint NOT NULL,
  content_hash text,
  route text,
  chunking_strategy text,
  request_type text,
  title text,
  author text,
  content_type text,
  prompt_mode text,
  prompt text,
  retry_count int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (batch_id, custom_id)
);

CREATE TABLE IF NOT EXISTS pkm.t2_batch_item_results (
  batch_id text NOT NULL,
  custom_id text NOT NULL,
  status text NOT NULL,
  response_text text,
  parsed jsonb,
  error jsonb,
  raw jsonb,
  applied boolean DEFAULT false,
  applied_at timestamptz,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (batch_id, custom_id)
);
```

Migration scripts:
- `scripts/db/migrations/2026-03-08_tier2_distill_entries.sql`
- `scripts/db/migrations/2026-03-09_tier2_batch_tables.sql`

## Insert / Update

### `POST /db/insert`
Builds and executes a SQL `INSERT` using a **generic JSON input** that matches `docs/database_schema.md`.
The backend validates and sanitizes fields and builds SQL.

Body:
```json
{
  "table": "\"pkm\".\"entries\"",
  "columns": ["source", "intent"],
  "values": ["'telegram'::text", "'archive'::text"],
  "returning": ["id", "created_at"]
}
```

**Simple input (recommended for n8n)**

```json
{
  "input": {
    "source": "telegram",
    "intent": "archive",
    "capture_text": "raw text",
    "clean_text": "cleaned text",
    "content_type": "note",
    "title": "Some title",
    "author": "Some author",
    "url": "https://example.com",
    "url_canonical": "https://example.com",
    "topic_primary": "ai",
    "topic_primary_confidence": 0.7,
    "topic_secondary": "decision hygiene",
    "topic_secondary_confidence": 0.5,
    "gist": "One sentence gist.",
    "metadata": {
      "retrieval": {
        "excerpt": "excerpt",
        "version": "v1",
        "quality": {
          "clean_word_count": 10,
          "clean_char_count": 20,
          "extracted_char_count": 30,
          "link_count": 2,
          "link_ratio": 0.2,
          "boilerplate_heavy": false,
          "low_signal": false,
          "quality_score": 0.8
        }
      }
    }
  }
}
```

You can also send the same fields at the top level (no `input` wrapper).
Required fields: `source`, `capture_text`. Optional: any `pkm.entries` column (see `docs/database_schema.md`).
For JSONB columns (`metadata`, `external_ref`), send either a JSON object or a JSON string; invalid JSON strings will be rejected.

Idempotent ingest fields (mandatory):
- `idempotency_policy_key`
- `idempotency_key_primary`
- `idempotency_key_secondary`

Inserts without idempotency fields are rejected to prevent duplicate rows.

When idempotency fields are provided, backend resolves policy in the active schema and returns per-row `action`:
- `inserted`
- `skipped` (policy conflict action = skip)
- `updated` (policy conflict action = update)

**Batch insert**

You can insert multiple rows in one request:

```json
{
  "items": [
    {
      "source": "email-batch",
      "capture_text": "raw",
      "clean_text": "clean",
      "idempotency_policy_key": "email_newsletter_v1",
      "idempotency_key_primary": "<msg-1@example.com>",
      "idempotency_key_secondary": "abc"
    },
    {
      "source": "email-batch",
      "capture_text": "raw2",
      "clean_text": "clean2",
      "idempotency_policy_key": "email_newsletter_v1",
      "idempotency_key_primary": "<msg-2@example.com>",
      "idempotency_key_secondary": "def"
    }
  ],
  "continue_on_error": true
}
```

Batch response returns per-item rows. Error rows include:
- `_batch_index`
- `_batch_ok: false`
- `error`

**Custom RETURNING**

You can override the default `RETURNING` columns by adding `returning` at the top level or inside `input`:

```json
{
  "source": "telegram",
  "capture_text": "raw text",
  "returning": ["id", "entry_id", "created_at"]
}
```

### `POST /db/update`
Builds and executes a SQL `UPDATE` using a generic JSON input that matches `docs/database_schema.md`.
The backend validates and sanitizes fields and builds SQL.

Body:
```json
{
  "table": "\"pkm\".\"entries\"",
  "set": ["intent = 'think'::text", "content_type = 'note'::text"],
  "where": "id = '00000000-0000-0000-0000-000000000000'::uuid",
  "returning": ["id", "intent", "content_type"]
}
```

**Simple input (recommended for n8n)**

```json
{
  "id": "00000000-0000-0000-0000-000000000000",
  "title": "Updated title",
  "clean_text": "Updated text",
  "returning": ["id", "title", "clean_text"]
}
```

You can also use a `where` object:

```json
{
  "where": { "entry_id": 123 },
  "gist": "Updated gist"
}
```

**Batch update**

```json
{
  "items": [
    {
      "id": "00000000-0000-0000-0000-000000000000",
      "title": "Updated title 1"
    },
    {
      "entry_id": 12345,
      "title": "Updated title 2"
    }
  ],
  "continue_on_error": true
}
```

### `POST /db/delete`
Deletes entries using explicit selectors in an explicit schema.

Headers:
- `x-pkm-admin-secret: <secret>` (required)

Body:
```json
{
  "schema": "pkm",
  "entry_ids": [101, 102],
  "range": { "from": 200, "to": 220 },
  "dry_run": false,
  "force": false
}
```

Rules:
- `schema` is required (`pkm` or `pkm_test`).
- At least one selector is required: `entry_ids` and/or `range`.
- All IDs must be positive integers.
- `range.from <= range.to`.
- Selector size max is `200` unless `force = true`.

### `POST /db/move`
Moves entries from one schema to another in a single transaction.

Headers:
- `x-pkm-admin-secret: <secret>` (required)

Body:
```json
{
  "from_schema": "pkm",
  "to_schema": "pkm_test",
  "entry_ids": [101],
  "range": { "from": 200, "to": 205 },
  "dry_run": false,
  "force": false
}
```

Rules:
- `from_schema` and `to_schema` are required and must differ.
- Selector/validation/max-size rules are the same as `/db/delete`.
- Move preserves `id` and reassigns destination `entry_id`.
- Move annotates migration provenance in `metadata` and `external_ref`.

## Read

Read hit rows (where `is_meta=false`) include retrieval/context fields used by shared context-pack rendering:
- `keywords`
- `distill_summary`
- `distill_why_it_matters`
- `gist`
- `excerpt`

### `POST /db/read/last`
Builds and executes the `/last` query.

Body:
```json
{
  "q": "ai",
  "days": 180,
  "limit": 10
}
```
Notes:
- `q` is required.
- If `days` or `limit` are `0`/null/omitted, defaults are taken from config.
- Response always includes one meta row (`is_meta=true`, `cmd='last'`) followed by hit rows (`is_meta=false`).

### `POST /db/read/find`
Builds and executes the `/find` query.

Body:
```json
{
  "q": "ai",
  "days": 365,
  "limit": 10
}
```
Notes:
- `q` is required.
- The backend derives the needle from `q` using safe escaping.
- If `days` or `limit` are `0`/null/omitted, defaults are taken from config.
- Response always includes one meta row (`is_meta=true`, `cmd='find'`) followed by hit rows (`is_meta=false`).

### `POST /db/read/continue`
Builds and executes the `/continue` query.

Body:
```json
{
  "q": "ai",
  "days": 90,
  "limit": 10
}
```
Notes:
- `q` is required.
- If `days` or `limit` are `0`/null/omitted, defaults are taken from config.
- Response always includes one meta row (`is_meta=true`, `cmd='continue'`) followed by hit rows (`is_meta=false`).

### `POST /db/read/pull`
Builds and executes the `/pull` query.

Body:
```json
{
  "entry_id": "123456",
  "shortN": 320,
  "longN": 1800
}
```

Notes:
- Returns exactly one row.
- Row includes `found` boolean:
  - `found=true` when the entry exists (row contains entry data).
  - `found=false` when the entry does not exist (row contains the requested `entry_id` plus null/empty content fields).

### `POST /db/read/smoke`
Returns smoke-marked entries for cleanup/reporting selectors.

Body:
```json
{
  "suite": "T00",
  "run_id": "smoke_20260320_010203"
}
```

Notes:
- `suite` is required.
- `run_id` is optional.
- This selector does not apply a time window.
- Filtering keys are JSONB metadata fields:
  - `metadata.smoke.suite`
  - `metadata.smoke.run_id`

## Response format

All `/db/*` endpoints return **only the rows** from SQL:
```json
[
  {
    "id": "...",
    "entry_id": 123,
    "found": true,
    "keywords": ["k1", "k2"],
    "distill_summary": "Primary Tier-2 summary when present.",
    "distill_why_it_matters": "Why this should matter later.",
    "gist": "Tier-1 gist fallback.",
    "excerpt": "Retrieval excerpt/snippet."
  }
]
```

If an error occurs:
```json
{ "error": "bad_request", "message": "..." }
```

## Environment

These variables are required in the service container:
- `PKM_INGEST_USER`
- `PKM_INGEST_PASSWORD`
- `BRAINTRUST_API_KEY`
- `BRAINTRUST_PROJECT` (or `BRAINTRUST_PROJECT_NAME`)

Optional:
- `PKM_DB_HOST` (default: `postgres`)
- `PKM_DB_PORT` (default: `5432`)
- `PKM_DB_NAME` (default: `pkm`)
- `PKM_DB_SCHEMA` (default: `pkm`)
- `PKM_DB_SSL` (default: `false`)
- `PKM_DB_SSL_REJECT_UNAUTHORIZED` (default: `true`)
- `PKM_ADMIN_SECRET` (required for `/db/delete` and `/db/move`)
- `PKM_DB_ADMIN_ROLE` (optional; used via `SET LOCAL ROLE` for admin DB operations)
- `EMAIL_IMPORT_ROOT` (default: `/data`; root directory for `/import/email/mbox` reads)
- `OPENAI_BASE_URL` (recommended: `http://litellm:4000/v1`)
- `T1_DEFAULT_MODEL` (recommended: `t1-default`)
- `T1_BATCH_MODEL` (recommended: `t1-batch`)
- `T2_MODEL_DIRECT` (recommended: `t2-direct`)
- `T2_MODEL_CHUNK_NOTE` (recommended: `t2-chunk-note`)
- `T2_MODEL_SYNTHESIS` (recommended: `t2-synthesis`)
- `T2_MODEL_SYNC_DIRECT` (recommended: `t2-sync-direct`)
- `T2_MODEL_BATCH_DIRECT` (recommended: `t2-batch-direct`; falls back to sync/direct route if unset)
- `T2_RETRY_ENABLED` (`true` default)
- `T2_RETRY_MAX_ATTEMPTS` (`2` default)
- `T2_STALE_MARK_ENABLED` (`true` default)
- `T2_STALE_MARK_INTERVAL_MS` (`86400000` default)
- `T2_BATCH_WORKER_ENABLED` (`false` default)
- `T2_BATCH_SYNC_INTERVAL_MS` (`600000` default)
- `T2_BATCH_SYNC_LIMIT` (`distill.max_entries_per_run` default)
- `T2_BATCH_COLLECT_LIMIT` (`20` default)
- `T2_BATCH_REQUEST_MODEL` (optional provider model override for Tier‑2 batch request lines; falls back to `T1_BATCH_REQUEST_MODEL`)
- `FAMILY_CALENDAR_ID` (optional; shared calendar id surfaced in `/config.calendar.family_calendar_id`)
- `FAMILY_CALENDAR_RECIPIENT_EMAIL` (optional; default `pkm.gasovic`)
- `CALENDAR_TELEGRAM_ENFORCE_ALLOWLIST` (`false` default; when `true`, enforces Telegram user id allowlists for calendar/PKM routing)
- `CALENDAR_TELEGRAM_ALLOWED_USER_IDS` (optional CSV Telegram user ids allowed for calendar flows)
- `CALENDAR_TELEGRAM_PKM_ALLOWED_USER_IDS` (optional CSV Telegram user ids allowed for PKM capture; treated as subset of calendar users)

LLM auth:
- `LITELLM_MASTER_KEY` (required; used as Bearer token for LiteLLM)
