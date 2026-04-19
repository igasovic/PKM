# Backend API: Ingest and Enrichment

## Purpose
- define internal ingest, normalization, enrichment, and backlog-import contracts
- keep payload-shaping routes together for n8n and backend-controlled ingest flows

## Authoritative For
- normalization endpoints
- Tier-1 enrichment and batch-status endpoint contracts
- backlog import request and response shapes

## Not Authoritative For
- batch table schema details; use `docs/database_schema.md`
- public webhook contracts; use `docs/external_api.md`

## Read When
- changing ingest normalization, Tier-1 enrichment, batch status, or backlog import flows
- reviewing DB-ready payload generation rules

## Update When
- normalization or enrichment request/response shapes change
- backlog import semantics or batch status surfaces change

## Related Docs
- `docs/api.md`
- `docs/api_read_write.md`
- `docs/database_schema.md`
- `docs/backend_runtime_env.md`

## Endpoint Map

| Endpoint family | Auth | Primary callers | Schema touched | Typical tests |
|---|---|---|---|---|
| Normalization | internal | n8n ingest workflows | none directly; returns DB-ready payloads | `test/server/normalization.test.js`, `test/server/content-hash.test.js`, `test/server/quality.test.js` |
| Telegram URL batch ingest | internal | compatibility callers (legacy URL-list batching) | `entries` (through backend write repository) | `test/server/classify.api-contract.test.js`, `test/server/telegram-url-batch-ingest.test.js` |
| Tier-1 enrichment | internal | n8n, backend orchestration | `entries`, `active_topic_related_entries`, `t1_*` status tables for batch flows | `test/server/classify.api-contract.test.js`, `test/server/tier2.enrichment.test.js`, `test/server/batch-status-service.test.js` |
| Backlog import | internal | n8n backlog flows | `entries`, `t1_*` tables | `test/server/idempotency.test.js`, related batch tests |

## Batch Persistence Note
- Durable batch table definitions live in `docs/database_schema.md`.
- This doc owns the HTTP contract only.

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

### `POST /ingest/telegram/url-batch`
Normalizes and inserts a pure URL list from one Telegram message in one backend call.
The backend parses URLs in parallel, inserts with idempotency, and returns a per-URL summary.
Canonical WF02 URL handling now uses per-URL `22 Web Extraction` execution instead of this bulk route.

This route is for URL-only lists (comma/newline separated). Mixed free text + URLs is rejected.
When `continue_on_error` is true (default), per-URL normalize or insert failures are reported in `results[]` while successful URLs still complete.

Body:
```json
{
  "text": "https://a.com, https://b.com",
  "source": {
    "chat_id": "123",
    "message_id": "456",
    "user_id": "789"
  },
  "continue_on_error": true
}
```

Response:
```json
{
  "mode": "url_list",
  "url_count": 3,
  "inserted_count": 1,
  "updated_count": 0,
  "skipped_count": 1,
  "failed_count": 1,
  "results": [
    {
      "batch_index": 0,
      "ok": true,
      "action": "inserted",
      "entry_id": 101,
      "id": "uuid",
      "url": "https://a.com",
      "url_canonical": "https://a.com",
      "error": null
    },
    {
      "batch_index": 1,
      "ok": true,
      "action": "skipped",
      "entry_id": 99,
      "id": "uuid",
      "url": "https://b.com",
      "url_canonical": "https://b.com",
      "error": null
    },
    {
      "batch_index": 2,
      "ok": false,
      "action": "failed",
      "entry_id": null,
      "id": null,
      "url": "https://c.com",
      "url_canonical": "https://c.com",
      "error": "normalize failed"
    }
  ]
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
Normalizes webpage/article capture text and recomputes retrieval + quality in one call.
The response is insert-ready for canonical web extraction flows (`/pkm/insert`), including idempotency fields.

Body:
```json
{
  "capture_text": "raw extracted webpage text",
  "text": "optional legacy alias for capture_text",
  "content_type": "newsletter",
  "url": "https://example.com/article",
  "url_canonical": "https://example.com/article",
  "excerpt": "optional excerpt override",
  "source": {
    "system": "telegram",
    "chat_id": "123",
    "message_id": "456",
    "user_id": "789"
  }
}
```

Notes:
- `capture_text` is the canonical input field.
- `text` and `extracted_text` are accepted as legacy aliases when `capture_text` is missing.
- If `clean_text` is provided instead, it is used as the cleaning input.
- If cleaned text is empty, response includes `retrieval_update_skipped: true`.
- If `excerpt` is provided, it is used as excerpt override.
- `source.system` defaults to `telegram` when omitted.

Response:
```json
{
  "capture_text": "...",
  "capture_len": 12000,
  "clean_text": "...",
  "content_hash": "3b066804f6d1d077173cfe4d06002e6a61e6f21c2b2e648417962115f1afcd8e",
  "clean_len": 9800,
  "idempotency_policy_key": "telegram_link_v1",
  "idempotency_key_primary": "https://example.com/article",
  "idempotency_key_secondary": "6d7b...",
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

### `POST /enrich/t1/update`
Runs Tier‑1 enrichment and persists the fixed Tier‑1 update field set to one existing entry.
This is the explicit classify write path (replaces classify-through-generic-`/db/update`).

Body:
```json
{
  "entry_id": 123,
  "title": "Optional title",
  "author": "Optional author",
  "clean_text": "Required when t1 is not provided"
}
```

Optional fields:
- `id` as UUID selector alternative to `entry_id`
- `t1` object to persist precomputed Tier‑1 output (skips model call)
- `enrichment_model`, `prompt_version`
- `schema` (`pkm` or `pkm_test`) for explicit override

Response:
```json
{
  "schema": "pkm",
  "row": {
    "entry_id": 123,
    "topic_primary": "parenting",
    "topic_secondary": "bedtime routine",
    "gist": "One sentence summary.",
    "enrichment_status": "done",
    "action": "updated"
  },
  "topic_link": {
    "linked": true,
    "topic_key": "parenting",
    "reason": null
  }
}
```

Notes:
- When `topic_primary` resolves to an active topic key, backend upserts `active_topic_related_entries` with `relation_type='classified_primary'`.
- If the resolved topic is not active, prior `classified_primary` links for that entry are cleared and no active-topic link is created.

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

### `POST /enrich/t1/run`
Runs a classify sweep over entries where `topic_primary` or `gist` is missing.
Supports sync writeback (`/enrich/t1/update-batch`) or async batch enqueue (`/enrich/t1/batch`) in one control-plane call.

Body:
```json
{
  "execution_mode": "sync",
  "dry_run": false,
  "limit": 0
}
```

Fields:
- `execution_mode`: `sync` (default) or `batch`
- `dry_run`: when true, returns counts only and does not classify
- `limit`: non-negative integer; `0` means unlimited
- `schema`: optional explicit schema override (`pkm` or `pkm_test`)

Response:
```json
{
  "mode": "run",
  "execution_mode": "sync",
  "limit": 0,
  "candidate_count": 120,
  "runnable_count": 118,
  "skipped_missing_clean_text": 2,
  "processed_count": 118,
  "completed_count": 117,
  "failed_count": 1,
  "error_code_counts": {
    "error": 1
  }
}
```

Notes:
- Batch mode returns enqueue metadata (`batch_id`, `status`, `request_count`, `enqueued_count`) instead of per-item completion counts.
- Dry-run mode returns `will_process_count` and never performs enrichment calls.

### `POST /enrich/t1/update-batch`
Persists explicit Tier‑1 updates for multiple existing entries in one call.
Each item may either provide a precomputed `t1` object or provide `clean_text` for in-call enrichment.

Body:
```json
{
  "items": [
    {
      "entry_id": 123,
      "clean_text": "Required when t1 is not provided"
    }
  ],
  "continue_on_error": true
}
```

Response:
```json
{
  "rows": [
    {
      "_batch_index": 0,
      "_batch_ok": true,
      "entry_id": 123,
      "topic_primary": "parenting",
      "action": "updated"
    }
  ],
  "rowCount": 1
}
```

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
      "error_code": null,
      "message": null,
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
- For `stage=t1` with `include_items=true`, item rows may include:
  - `error_code` (`parse_error`, `error`, or provider/code-specific value when available)
  - `message` (best-effort failure message when available)
- For `stage=t2` with `include_items=true`, item rows may include:
  - `entry_id`
  - `error_code`
  - `message`
  - `preserved_current_artifact`

Legacy aliases kept for backward compatibility:
- `GET /status/t1/batch` (equivalent to `GET /status/batch?stage=t1`)
- `GET /status/t1/batch/:batch_id` (equivalent to `GET /status/batch/:batch_id?stage=t1`)


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
- `mbox_path` is required and must point to a `.mbox` filename available under backend import root `/data`.
- Path resolution currently uses the filename basename only (directory segments are ignored).
- `batch_size` is Tier‑1 enqueue size and must be between `500` and `2000` (default `500`).
- `insert_chunk_size` controls DB insert chunking (default `200`).
- `max_emails` is optional and must be a positive integer when provided.
- Source for inserted rows is set to `email-batch`.
- Retry recovery: idempotency-skipped rows with `enrichment_status = "pending"` are re-enqueued so reruns can recover rows inserted before a prior enqueue failure.

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
