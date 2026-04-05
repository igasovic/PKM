# PKM Debug UI

Local React + Tailwind GUI for:
- **Read** workflows via `/db/read/*`
- **Recipes** workflows via `/recipes/*`
- **Debug** pipeline inspection via `/debug/*`
- **Failures** diagnostics via `/debug/failures*`

## Scope
- Dark-mode only UI.
- Uses PKM server HTTP only (no DB connections).
- Read page depends on:
  - `POST /db/read/continue`
  - `POST /db/read/find`
  - `POST /db/read/last`
- Recipes page depends on:
  - `POST /recipes/create`
  - `POST /recipes/search`
  - `POST /recipes/get`
  - `POST /recipes/patch`
  - `POST /recipes/overwrite`
  - `POST /recipes/link`
  - `GET /recipes/review`
- Debug page depends on:
  - `GET /debug/run/:run_id`
  - `GET /debug/runs`
- Failures page depends on:
  - `GET /debug/failures`
  - `GET /debug/failures/:failure_id`
  - `GET /debug/failures/by-run/:run_id`
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
- `/debug` to `${VITE_PKM_ORIGIN}/debug` and injects `x-pkm-admin-secret` from `PKM_ADMIN_SECRET`

This keeps frontend requests relative and avoids backend CORS changes.

## Features

### Read
- Left menu navigation (`/read`, `/recipes`, `/debug`, `/failures`).
- Single-operation radio selection: `continue | find | last`.
- Query controls: `q` (required), `days`, `limit`.
- Sends request run id in `X-PKM-Run-Id` (`ui-read-<uuid>`).
- Displays returned run id and quick link to open debug page for that run.
- Result browser with per-row include checkbox and bulk actions.
- Context pack builder (markdown/json), live preview, and copy to clipboard.
- Token estimation (heuristic `chars / 4`).

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

### Failures
- Side-menu route at `/failures`.
- Recent failure list with filters (`workflow_name`, `node_name`, `mode`).
- Run-id lookup for direct detail open.
- Detail panel with summary + stored pack + merged bundle trace.
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
