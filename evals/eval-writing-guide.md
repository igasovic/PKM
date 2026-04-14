# Eval Writing Guide (Live, Non-Gating)

Use this guide when adding a new eval surface (the next runner after router/calendar/todoist).

## Goal

Ship a repeatable live eval loop that:
- runs against a real backend endpoint
- validates a versioned fixture corpus
- scores and reports quality without becoming a CI gate
- keeps each case traceable via `run_id`

## Reuse First (Shared Utilities)

Before creating new files, reuse existing shared modules:
- `scripts/evals/lib/runner-common.js`
  - `resolveRunnerOptions(...)` for backend URL, admin secret, timeout, and observability toggle
  - `parsePositiveCaseLimit(...)` for `--case-limit`
  - `checkRunObservability(...)` for `GET /debug/run/<run_id>` verification
  - `printEvalCompletion(...)` for consistent CLI output
- `scripts/evals/lib/io.js` for args/time/path helpers
- `scripts/evals/lib/live-api.js` for backend request wrappers
- `scripts/evals/lib/fixtures.js` for fixture loading + schema/field validation
- `scripts/evals/lib/scoring.js` for summary/failure-group metrics
- `scripts/evals/lib/reporting.js` for Markdown + JSON report output

If new functionality is generic across surfaces, add it to `scripts/evals/lib/*` first instead of duplicating it in a runner.

## Required File Layout

Add or extend these paths:
- `evals/<surface>/fixtures/gold/*.json`
- `evals/<surface>/fixtures/candidates/` (harvested, unlabeled)
- `evals/schemas/<surface>.schema.json` (or equivalent schema split)
- `scripts/evals/run_<surface>_live.js`
- `evals/reports/<surface>/` (generated outputs, committed history pattern)

## Runner Build Checklist

1. Add endpoint wrapper in `scripts/evals/lib/live-api.js` if needed.
2. Add fixture loader + validations in `scripts/evals/lib/fixtures.js`.
3. Add scoring function in `scripts/evals/lib/scoring.js`.
4. Add markdown builder in `scripts/evals/lib/reporting.js`.
5. Implement `scripts/evals/run_<surface>_live.js` with:
   - `parseArgs` + `utcStamp`
   - `resolveRunnerOptions(...)`
   - `parsePositiveCaseLimit(...)`
   - unique per-case run IDs: `eval.<surface>.<stamp>.<case_id>`
   - `checkRunObservability(...)` unless `--no-observability-check`
   - `writeEvalReport(...)` + `printEvalCompletion(...)`
6. Wire command scripts:
   - `src/server/package.json`: `eval:<surface>:live`
   - `scripts/evals/run_evals.sh`: add `--<surface>` support
7. Update docs:
   - `evals/README.md` surface list + commands
   - owning PRD/work-package docs if surface intent changed
   - `docs/changelog.md`

## Fixture Authoring Rules

- Keep `gold/` reviewed and stable.
- Put newly harvested failures into `candidates/`.
- Do not auto-promote candidate rows into gold.
- Keep fixture IDs deterministic and unique (`case_id` stable across edits).
- Enforce minimum corpus sizes/bucket balance in runner assertions and tests.

## Observability Rules

- Every case must set `x-pkm-run-id` and request-body `run_id`.
- Default behavior is to verify debug trace presence.
- Allow explicit opt-out with `--no-observability-check` only for degraded environments.
- Keep run IDs easy to grep in logs, reports, and Debug UI.

## Test Expectations

Add or update tests in `test/server/`:
- fixture-shape + corpus-size checks
- scoring metric behavior
- markdown/report formatting smoke checks
- runner smoke with mocked live API calls
- shared helper tests if common runner behavior changes

Run at minimum:
- targeted eval-tooling tests for touched surfaces
- `scripts/CI/check.sh` before merge

## Definition of Done

- new eval command runs successfully against live backend
- report JSON + Markdown files are emitted under `evals/reports/<surface>/`
- observability linkage works for run IDs
- docs and PRD references are updated in the same change set
- no duplicated runner plumbing when shared helper already exists
