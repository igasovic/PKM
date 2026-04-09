# Backend API: Read and Write

## Purpose
- define internal read, insert, update, delete, and move contracts
- keep DB-facing payload and selector semantics together for n8n and internal tooling

## Authoritative For
- `/db/*` read and write endpoint contracts
- selector, auth, and response-shape rules for read/write paths

## Not Authoritative For
- DB table definitions; use `docs/database_schema.md`
- normalization/enrichment contract details; use `docs/api_ingest.md`

## Read When
- changing `/db/*` selectors, payloads, or response semantics
- reviewing read/write coupling to the active schema

## Update When
- any `/db/*` request or response shape changes
- destructive selector or admin-auth rules change

## Related Docs
- `docs/api.md`
- `docs/api_ingest.md`
- `docs/database_schema.md`

## Endpoint Map

| Endpoint family | Auth | Primary callers | Schema touched | Typical tests |
|---|---|---|---|---|
| Insert / update | internal | n8n, internal tooling | active schema `entries` | `test/server/idempotency.test.js`, `test/server/normalization.test.js` |
| Delete / move | admin secret | operators, smoke harness, controlled workflows | `pkm.entries`, `pkm_test.entries` | `test/server/db.read-smoke.api-contract.test.js`, smoke-related tests |
| Read | internal | n8n read workflows, PKM UI Read + Entities pages, context-pack builder | active schema `entries` | `test/server/read-sql-distill-projection.test.js`, `test/server/context-pack-builder.test.js`, `test/server/n8n.wf11-context-pack.test.js`, `test/server/read-write.api-contract.test.js` |

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
- PKM UI Read page uses this route for manual entry pull and per-result drawer inspection.

### `POST /db/read/entities`
Returns a paginated entity list for PKM UI entity browsing and maintenance.

Body:
```json
{
  "page": 1,
  "page_size": 50,
  "filters": {
    "content_type": "newsletter",
    "source": "telegram",
    "status": "pending",
    "intent": "archive",
    "topic_primary": "ai",
    "created_from": "2026-01-01",
    "created_to": "2026-04-09",
    "has_url": true,
    "quality_flag": "low_signal"
  }
}
```

Notes:
- Uses active test-mode schema routing (`pkm.entries` vs `pkm_test.entries`), same as other read endpoints.
- Supported filters:
  - required by UI request: `content_type`, `source`, `status` (maps to `distill_status`), `created_from`, `created_to`
  - additional: `intent`, `topic_primary`, `has_url`, `quality_flag`
- `quality_flag` accepted values:
  - `low_signal`
  - `boilerplate_heavy`
- Response includes one meta row (`is_meta=true`) followed by hit rows (`is_meta=false`).
- Meta row includes:
  - pagination (`page`, `page_size`, `total_count`, `total_pages`)
  - active schema/mode (`schema`, `is_test_mode`)
  - `topic_primary_options` sourced from shared config topics for UI dropdown rendering

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
