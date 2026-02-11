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
Returns the retrieval/scoring config as JSON (including test mode state read from Postgres).

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
