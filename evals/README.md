# Evals (Non-Gating)

This directory contains non-gating live eval fixtures and reports for router/calendar/todoist quality tracking.

For adding the next eval surface, use:
- `evals/eval-writing-guide.md`

## Scope

- Surfaces:
  - `POST /telegram/route`
  - `POST /calendar/normalize`
  - `POST /todoist/eval/normalize`
- Mode: live backend execution only
- Purpose: quality tracking, drift detection, failure harvesting
- Not used as CI deploy gate

## Layout

- `router/fixtures/gold/`
  - `stateless.json`
  - `stateful.json`
- `router/fixtures/candidates/`
  - harvested, unreviewed fixtures
- `calendar/fixtures/gold/`
  - `normalize.json`
- `calendar/fixtures/candidates/`
  - harvested, unreviewed fixtures
- `todoist/fixtures/gold/`
  - `normalize.json`
- `todoist/fixtures/candidates/`
  - harvested, unreviewed fixtures
- `schemas/`
  - fixture JSON schemas
- `reports/`
  - generated JSON + markdown reports

## Commands

One-command wrapper (run from repo root):

```bash
./scripts/evals/run_evals.sh --router --calendar --todoist --backend-url http://pkm-server:8080 --admin-secret "$PKM_ADMIN_SECRET"
```

Direct commands from `src/server`:

```bash
npm run eval:router:live -- --backend-url http://pkm-server:8080 --admin-secret "$PKM_ADMIN_SECRET"
npm run eval:calendar:live -- --backend-url http://pkm-server:8080 --admin-secret "$PKM_ADMIN_SECRET"
npm run eval:todoist:live -- --backend-url http://pkm-server:8080 --admin-secret "$PKM_ADMIN_SECRET"
```

Harvest a candidate fixture from a failing run:

```bash
npm run eval:harvest:runid -- --surface router --run-id <run_id> --backend-url http://pkm-server:8080 --admin-secret "$PKM_ADMIN_SECRET"
```

## Observability Alignment

Each eval case sets a unique run id:

- router: `eval.router.<stamp>.<case_id>`
- normalize: `eval.calendar.<stamp>.<case_id>`
- todoist normalize: `eval.todoist.<stamp>.<case_id>`

Runners verify that `GET /debug/run/<run_id>` has pipeline trace rows for each case unless `--no-observability-check` is passed.

## Golden Set Rules

- Gold fixtures are versioned and reviewed.
- Candidate fixtures require manual expected-output labeling before promotion.
- Do not auto-promote from candidate to gold.

## Notes

- Reports are advisory and non-blocking.
- Evals are expected to run on Pi against the live backend + LLM path.
- High-signal failures to review first:
  - false-positive `calendar_create`
  - bad clarification decisions
  - high-confidence errors
  - todoist project overcalls
