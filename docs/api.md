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

## Insert / Update

### `POST /db/insert`
Builds and executes a SQL `INSERT` using `js/libs/sql-builder.js`.

Body:
```json
{
  "table": "\"pkm\".\"entries\"",
  "columns": ["source", "intent"],
  "values": ["'telegram'::text", "'archive'::text"],
  "returning": ["id", "created_at"]
}
```

### `POST /db/update`
Builds and executes a SQL `UPDATE` using `js/libs/sql-builder.js`.

Body:
```json
{
  "table": "\"pkm\".\"entries\"",
  "set": ["intent = 'think'::text", "content_type = 'note'::text"],
  "where": "id = '00000000-0000-0000-0000-000000000000'::uuid",
  "returning": ["id", "intent", "content_type"]
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
  "limit": 10,
  "weights": {},
  "halfLife": 180
}
```

### `POST /db/read/find`
Builds and executes the `/find` query.

Body:
```json
{
  "q": "ai",
  "days": 365,
  "limit": 10,
  "needle": "ai",
  "weights": { "fts_rank": 80 }
}
```

### `POST /db/read/continue`
Builds and executes the `/continue` query.

Body:
```json
{
  "q": "ai",
  "days": 90,
  "limit": 10,
  "weights": {},
  "halfLife": 45,
  "noteQuota": 0.75
}
```

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

All DB endpoints return:
```json
{
  "ok": true,
  "rowCount": 1,
  "rows": []
}
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
