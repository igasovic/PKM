# PKM Backend API

Base URL: `http://<host>:<port>`

This service exposes a minimal JSON API intended for internal systems (e.g., n8n) to read/write entries in Postgres. All endpoints accept `application/json` and return JSON.

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

## Config

### `GET /config`
Returns the retrieval/scoring config as JSON (static; does not include test mode state).

Response:
```json
{
  "version": "v1",
  "db": { "is_test_mode": false, "schema_prod": "pkm", "schema_test": "pkm_test" },
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

## Normalization

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
  "retrieval_excerpt": "...",
  "retrieval_version": "v1",
  "source_domain": "...",
  "clean_word_count": 10,
  "clean_char_count": 200,
  "extracted_char_count": 0,
  "link_count": 1,
  "link_ratio": 0.1,
  "boilerplate_heavy": false,
  "low_signal": false,
  "extraction_incomplete": false,
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
  "retrieval_excerpt": "...",
  "retrieval_version": "v1",
  "source_domain": "...",
  "clean_word_count": 10,
  "clean_char_count": 200,
  "extracted_char_count": 0,
  "link_count": 1,
  "link_ratio": 0.1,
  "boilerplate_heavy": false,
  "low_signal": false,
  "extraction_incomplete": false,
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
Creates an OpenAI Batch job for Tier‑1 enrichment and persists mapping in Postgres.

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
```

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
        "source_domain": "example.com",
        "quality": {
          "clean_word_count": 10,
          "clean_char_count": 20,
          "extracted_char_count": 30,
          "link_count": 2,
          "link_ratio": 0.2,
          "boilerplate_heavy": false,
          "low_signal": false,
          "extraction_incomplete": false,
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

## Read

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

## Response format

All `/db/*` endpoints return **only the rows** from SQL:
```json
[
  { "id": "...", "entry_id": 123 }
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
