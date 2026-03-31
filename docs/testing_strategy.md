# Testing Strategy

## Purpose
- define the practical test strategy for PKM across local development and Pi post-deploy verification
- tell operators and coding agents which tests are mandatory, optional, mocked, live, isolated, or cleanup-sensitive
- keep non-gating evals separate from correctness, contract, and deployment-safety tests

## Authoritative For
- which tests run locally on a Mac before push
- which tests run on the Pi after deployment
- what each test layer is supposed to prove
- cleanup and isolation expectations for live-stack verification

## Not Authoritative For
- exact endpoint schemas; use `docs/api*.md`
- smoke workflow implementation detail; use `docs/PRD/smoke-prd.md` and `docs/PRD/smoke-detailed-matrix.md`
- detailed eval fixture ownership and scoring logic; use `evals/README.md` and owning PRDs

## Read When
- deciding what a coding agent should run before closing a change
- deciding what operators should run after `scripts/redeploy`
- adding a new test layer, smoke probe, integration harness, or post-deploy verification step

## Update When
- local or post-deploy test commands change
- a test moves between mocked, integration, or live-stack categories
- smoke cleanup or post-deploy verification guarantees change

## Related Docs
- `docs/backend_test_surface_matrix.md`
- `docs/n8n_backend_contract_map.md`
- `docs/PRD/smoke-prd.md`
- `docs/PRD/smoke-detailed-matrix.md`
- `docs/PRD/family-calendar-prd.md`
- `docs/PRD/family-calendar-eval-work-packages.md`
- `docs/n8n_sync.md`
- `evals/README.md`

## Core Principles

- Local pre-push tests should be fast, deterministic, and runnable by coding agents on a Mac without live providers.
- Post-deploy Pi tests should exercise the real stack, but only through isolated smoke paths with explicit cleanup.
- Contract and correctness tests come before evals. Evals can judge output quality later, but they should not be the only guard against regressions.
- Test layers should answer different questions:
  - local mocked tests: “did we break code or contracts?”
  - local Postgres integration: “does the DB behavior still match our assumptions?”
  - Pi smoke: “does the deployed system still work end to end?”

## Test Layers

| Layer | Where it runs | Dependencies | What it proves | Persistence rule | Command |
|---|---|---|---|---|---|
| Local repo gate | Mac, coding agent, CI-like local runs | mocked or in-process backend surfaces, generated n8n package, no live providers | repo structure, route/doc/env parity, backend Jest suite, n8n packaging safety | must not depend on live stack or persist product data | `bash scripts/CI/check.sh` |
| Local backend DB integration | Mac, coding agent, optional local DB | real Postgres only, dedicated integration DB | high-risk store behavior such as test-mode routing and prod-pinned DB behavior | must use a dedicated integration DB, never the live Pi database | `cd src/server && PKM_DB_INTEGRATION_URL=postgres://... npm run test:integration` |
| Pi backend post-deploy verification | Pi after `scripts/redeploy backend` | deployed backend plus live n8n entrypoints | backend readiness plus workflow-facing smoke confidence | must use smoke/test-mode isolation and cleanup | `./scripts/redeploy backend` then `./scripts/n8n/run_smoke.sh` |
| Pi n8n/runtime post-deploy verification | Pi after `scripts/redeploy n8n` or runtime/config changes | full live stack: n8n, runners, backend, public ingress, providers where applicable | deployment health, runner packaging, CLI readiness, smoke path | must run the smoke workflow with cleanup enabled | `./scripts/redeploy n8n` then `./scripts/n8n/validate_cutover.sh --with-smoke` |
| Scheduled live smoke | Pi on schedule | full live stack | regression detection after drift, provider changes, or deploys outside active coding | must restore test mode and clean created test entries | schedule `00 Smoke - Master` and route failures to WF99 cleanup |
| Family-calendar live eval (non-gating) | Pi or any environment with live backend + DB + LiteLLM | backend calendar routing/normalize APIs and debug surfaces | behavior quality trends (router precision/recall, clarification quality, extraction drift) | must use unique run ids and retain manual review for fixture promotion | `cd src/server && npm run eval:router:live` and `npm run eval:calendar:live` |

## Local Mac Before Push

### Mandatory for normal backend and n8n work

Run:

```bash
bash scripts/CI/check.sh
```

What this covers today:
- backend Jest suite with mocked or in-process dependencies
- route/doc parity
- env/doc parity
- generated backend test-surface matrix freshness
- n8n runtime package build and workflow-safety checks

This is the default command a coding agent should run before closing typical work.

### Mandatory when DB routing, stores, or SQL behavior changed

If you touched any of these:
- `src/server/db/**`
- `src/server/repositories/**`
- `src/libs/sql-builder.js`
- test-mode routing logic
- distill/classify batch schema behavior

also run the opt-in Postgres integration suite against a dedicated test database:

```bash
cd src/server
PKM_DB_INTEGRATION_URL=postgres://<user>:<pass>@<host>:5432/<db> npm run test:integration
```

Requirements:
- the database must be dedicated to integration testing
- it must not be the Pi production database
- the suite is allowed to drop and recreate `pkm` and `pkm_test` schemas inside that database

### Optional surface-specific checks

Run these when relevant:
- web/UI touched: `cd src/web/pkm-debug-ui && npm run build`
- smoke workflow logic touched: review `docs/PRD/smoke-prd.md` and run the normal local gate, then rely on Pi smoke for live verification
- operator/deploy scripts touched: add or update Jest coverage under `test/server/` for the script path and run `bash scripts/CI/check.sh`
- family-calendar routing/normalization behavior tuning: run non-gating live evals in a live-backend environment (`cd src/server && npm run eval:router:live` and `npm run eval:calendar:live`)

## Pi After Deployment

### Backend deploys

Required flow:

```bash
./scripts/redeploy backend
./scripts/n8n/run_smoke.sh
```

Why:
- `scripts/redeploy backend` currently proves deploy + readiness
- it does not yet prove that n8n-facing workflows still behave correctly against the deployed backend
- the smoke workflow is the required post-deploy correctness check until redeploy grows a built-in verify phase

### n8n or runtime/config deploys

Required flow:

```bash
./scripts/redeploy n8n
./scripts/n8n/validate_cutover.sh --with-smoke
```

Why:
- this validates container/image/runtime assumptions first
- then runs the smoke workflow against the live stack

### Live-stack isolation and cleanup rules

Pi post-deploy verification must:
- use backend test mode for PKM data isolation where the smoke harness expects it
- use n8n-level calendar test mode and the explicit test calendar id, never the production calendar id
- restore backend test mode even if smoke fails midway
- delete created PKM test entries during cleanup
- fail closed on destructive calendar cleanup if the target calendar is not explicitly the allowlisted test calendar

These rules are currently owned by the smoke harness and WF99 cleanup path, not by ad hoc shell cleanup.

## What This Strategy Does Not Cover

- broad cross-surface output-quality programs outside the owning eval surface docs
- broad manual exploratory QA checklists
- performance/load testing
- security-specific test programs

Those should be added as separate layers, not merged into the local correctness or Pi smoke gate.

## Proposed Next Testing Improvements

High-value additions after this strategy is adopted:
- make post-deploy verification first-class in `scripts/redeploy`, for example `scripts/redeploy backend --verify` and `scripts/redeploy n8n --verify`
- expand Postgres-backed integration coverage from `read-store` / `write-store` / prod-pinned `distill-store` into debug/calendar stores where behavior is high-risk
- add a machine-readable test-requirement map by change type so agents can infer “what must I run?” from touched paths instead of judgment alone
