# PKM Debug UI

Local React + Tailwind GUI for inspecting PKM pipeline logs through `/debug/*` HTTP endpoints.

## Scope
- Dark-mode only UI.
- Uses PKM server HTTP only (no DB connections).
- MVP depends on `GET /debug/run/:run_id`.
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

Vite proxy forwards `/debug` to `${VITE_PKM_ORIGIN}/debug` and injects `x-pkm-admin-secret` from `PKM_ADMIN_SECRET`, so frontend requests stay relative and no backend CORS changes are required.

## Features
- Run lookup by run id.
- Optional paste-json mode for offline inspection.
- Raw events table (seq/step/pipeline/direction/duration/ids/summaries).
- Call-stack tree view (best-effort nested spans).
- Paired spans view with health statuses:
  - `ok`, `error`, `missing_end`, `orphan_end`, `orphan_error`
- Side drawer for event/span/node details.
- Copy buttons for JSON sections.
- Deterministic **Copy Investigation Bundle** output with stable key ordering.

## Optional SSH tunnel (if LAN is blocked)
From Mac:
```bash
ssh -L 3010:localhost:3010 pi
```
Then set:
```env
VITE_PKM_ORIGIN=http://localhost:3010
```
