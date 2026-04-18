# PKM Debug UI

Local React + Tailwind GUI for:
- **Read** workflows via `/db/read/*`
- **Entities** browsing and maintenance via `/db/read/entities`, `/db/delete`, `/db/move`
- **Working Memory** lookup via `/chatgpt/working_memory`
- **Recipes** workflows via `/recipes/*`
- **Evals** fixture case exploration from `evals/*/fixtures/*` (repo-first, read-only)
- **Debug** pipeline inspection via `/debug/*`
- **Failures** diagnostics via `/debug/failures*`

## Scope
- Dark-mode only UI.
- Uses PKM server HTTP for backend pages and repo fixture imports for `/evals` (no DB connections).
- Read page depends on:
  - `POST /db/read/continue`
  - `POST /db/read/find`
  - `POST /db/read/last`
  - `POST /db/read/pull`
- Entities page depends on:
  - `POST /db/read/entities`
  - `POST /db/read/pull`
  - `POST /db/delete`
  - `POST /db/move`
- Working Memory page depends on:
  - `POST /chatgpt/working_memory`
- Recipes page depends on:
  - `POST /recipes/create`
  - `POST /recipes/search`
  - `POST /recipes/get`
  - `POST /recipes/patch`
  - `POST /recipes/overwrite`
  - `POST /recipes/link`
  - `GET /recipes/review`
- Evals page depends on:
  - `evals/router/fixtures/*/*.json`
  - `evals/calendar/fixtures/*/*.json`
  - `evals/todoist/fixtures/*/*.json`
- Debug page depends on:
  - `GET /debug/run/:run_id`
  - `GET /debug/runs`
- Failures page depends on:
  - `GET /debug/failures/open`
  - `GET /debug/failures/:failure_id`
  - `POST /debug/failures/:failure_id/analyze`
  - `POST /debug/failures/:failure_id/resolve`
  - `GET /debug/failure-bundle/:run_id`
- Handles payload variants:
  - `[{ run_id, rows: [...] }]`
  - `{ run_id, rows: [...] }`
  - `{ rows: [...] }` (run id derived from row data)

## Setup
1. `cd src/web/pkm-debug-ui`
2. `cp .env.example .env`
3. `npm install`
4. `npm run dev`
5. Open `http://localhost:5173`

## Config
`.env`
```env
VITE_PKM_ORIGIN=http://192.168.5.4:3010
PKM_ADMIN_SECRET=replace-with-your-pkm-admin-secret
```

Vite proxy forwards:
- `/db` to `${VITE_PKM_ORIGIN}/db`
- `/recipes` to `${VITE_PKM_ORIGIN}/recipes`
- injects `x-pkm-admin-secret` from `PKM_ADMIN_SECRET` for admin-protected `/db/delete`, `/db/move`, and `/db/test-mode/toggle`
- `/chatgpt` to `${VITE_PKM_ORIGIN}/chatgpt` and injects `x-pkm-admin-secret` from `PKM_ADMIN_SECRET`
- `/debug` to `${VITE_PKM_ORIGIN}/debug` and injects `x-pkm-admin-secret` from `PKM_ADMIN_SECRET`

This keeps frontend requests relative and avoids backend CORS changes.

## Features

### Read
- Left menu navigation (`/read`, `/entities`, `/working-memory`, `/recipes`, `/todoist`, `/evals`, `/debug`, `/failures`).
- Single-operation radio selection: `continue | find | last`.
- Query controls: `q` (required), `days`, `limit`.
- Sends request run id in `X-PKM-Run-Id` (`ui-read-<uuid>`).
- Displays returned run id and quick link to open debug page for that run.
- Result browser with per-row include checkbox and bulk actions.
- Manual `pull` by `entry_id` and per-card top-right `Pull` actions that open a right-side drawer.
- Drawer view uses standardized Telegram-style formatting plus expandable full JSON.
- Context pack builder (markdown/json), live preview, and copy to clipboard.
- Token estimation (heuristic `chars / 4`).

### Entities
- Side-menu route at `/entities`.
- Paginated table for all entities in active schema (test-mode sensitive backend routing).
- Filters:
  - required: `content_type`, `source`, `status`, `created_from`, `created_to`
  - additional: `intent`, `topic_primary` (config-backed dropdown), `has_url`, `quality_flag`
- Row click opens right-side drawer by calling `POST /db/read/pull` for selected `entry_id`.
- Multi-select actions:
  - delete selected entities (`POST /db/delete`)
  - move selected entities between `pkm` and `pkm_test` (`POST /db/move`)

### Working Memory
- Side-menu route at `/working-memory`.
- Topic lookup via admin-protected `POST /chatgpt/working_memory`.
- Standardized Telegram-style entry view with expandable full JSON debug payload.

### Debug
- Run lookup by run id.
- Recent run listing (`GET /debug/runs`) with quick load and error/no-error filters.
- Optional paste-json mode for offline inspection.
- Raw events table (seq/step/pipeline/direction/duration/ids/summaries).
- Call-stack tree view (best-effort nested spans).
- Paired spans view with health statuses:
  - `ok`, `error`, `missing_end`, `orphan_end`, `orphan_error`
- Side drawer for event/span/node details.
- Copy buttons for JSON sections.
- Deterministic **Copy Investigation Bundle** output with stable key ordering.

### Evals
- Side-menu route at `/evals`.
- Loads actual fixture cases directly from repo under `evals/*/fixtures/*` (no eval report dependency).
- Unified table view across router/calendar/todoist fixture suites.
- Detail card view for selected case (`input`, `expect`, optional `setup`).
- Filter controls for surface, tier (`gold`/`candidates`), suite, bucket, and free-text search.
- Read-only explorer (no run/start/cancel controls).

### Failures
- Side-menu route at `/failures`.
- Open failure queue (`status=captured`) with refresh.
- Detail panel with summary + stored pack + merged bundle trace.
- Inline analysis editor (`analysis_reason`, `proposed_fix`) with save action.
- Resolve action (`status=resolved`, terminal in v1).
- Quick jump to `/debug/run/:run_id`.

### Recipes
- Side-menu route at `/recipes`.
- Search via lexical backend rank (`POST /recipes/search`) with top hit + alternatives.
- Direct lookup by public id (`POST /recipes/get`), including archived rows.
- One-shot capture create panel (`POST /recipes/create`) from structured/semi-structured recipe text.
- Patch and overwrite editors (`POST /recipes/patch`, `POST /recipes/overwrite`).
- Link action for `See Also` relationships (`POST /recipes/link`).
- Recipe detail displays linked recipes in a `See Also` list.
- Review queue loader (`GET /recipes/review`) for `needs_review` rows.

## Optional SSH tunnel (if LAN is blocked)
From Mac:
```bash
ssh -L 3010:localhost:3010 pi
```
Then set:
```env
VITE_PKM_ORIGIN=http://localhost:3010
```
