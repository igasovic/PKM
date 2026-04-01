# n8n To Backend Contract Map

## Purpose
- map the primary n8n workflows to the backend routes they own operationally
- make the n8n-first consumer model explicit for route reviews and test planning
- keep docs, routes, and contract tests tied together

## Authoritative For
- the workflow-to-backend-route ownership map for the active n8n surfaces
- which backend routes are considered workflow-critical from an n8n perspective

## Not Authoritative For
- detailed HTTP schemas; use `docs/api.md` and the relevant `docs/api_*.md`
- public ChatGPT webhook contracts; use `docs/external_api.md`
- runtime topology; use `docs/service_dependency_graph.md`

## Read When
- adding or refactoring n8n workflows that call `pkm-server`
- deciding which backend routes need direct contract tests
- reviewing whether a backend change is safe for the primary n8n consumers

## Update When
- a workflow changes which backend route it calls
- a new workflow family becomes a primary backend consumer
- route ownership or required contract tests change

## Related Docs
- `docs/backend_route_registry.json`
- `docs/api.md`
- `docs/backend_architecture.md`
- `docs/n8n_sync.md`

## Active Workflow Map

| n8n workflow / family | Backend routes | Owning docs | Contract tests |
|---|---|---|---|
| `05 ChatGPT Wrap Commit` | `POST /chatgpt/wrap-commit` | `docs/api_control.md`, `docs/PRD/working-memory-prd.md`, `docs/PRD/gpt-actions-integration-prd.md` | `test/server/chatgpt.api-contract.test.js` |
| `11 ChatGPT Read Router` | `POST /db/read/pull`, `POST /db/read/last`, `POST /db/read/continue`, `POST /db/read/find`, `POST /chatgpt/working_memory` | `docs/api_read_write.md`, `docs/api_control.md`, `docs/PRD/read-prd.md`, `docs/PRD/working-memory-prd.md` | `test/server/read-write.api-contract.test.js`, `test/server/chatgpt.api-contract.test.js`, `test/server/n8n.wf11-route-read-request.test.js` |
| Telegram and capture ingest flows | `POST /normalize/telegram`, `POST /normalize/email/intent`, `POST /normalize/email`, `POST /normalize/webpage`, `POST /normalize/notion`, `POST /db/insert`, `POST /enrich/t1`, `POST /enrich/t1/batch` | `docs/api_ingest.md`, `docs/api_read_write.md` | `test/server/classify.api-contract.test.js`, `test/server/read-write.api-contract.test.js` |
| Backlog / import flows | `POST /import/email/mbox` | `docs/api_ingest.md` | `test/server/classify.api-contract.test.js` |
| Family calendar router and finalize flows | `POST /telegram/route`, `POST /calendar/normalize`, `POST /calendar/finalize`, `POST /calendar/observe` | `docs/api_calendar.md`, `docs/PRD/family-calendar-prd.md` | `test/server/calendar.api-contract.test.js` |
| Distill workflows and operators | `POST /distill/plan`, `POST /distill/run`, `POST /distill/sync`, `GET /status/batch`, `GET /status/batch/:batch_id` | `docs/api_distill.md`, `docs/PRD/distill-prd.md` | `test/server/tier2.api-contract.test.js` |
| WF99 failure/debug flows | `POST /debug/failures`, `GET /debug/failures`, `GET /debug/failures/by-run/:run_id`, `GET /debug/failure-bundle/:run_id`, `GET /debug/runs`, `GET /debug/run/:run_id`, `GET /debug/run/last` | `docs/api_control.md`, `docs/PRD/failure-pack-prd.md` | `test/server/failure-pack.api-contract.test.js`, `test/server/control.api-contract.test.js` |
| Smoke and operator helpers | `GET /health`, `GET /ready`, `GET /version`, `GET /config`, `GET /db/test-mode`, `POST /db/test-mode/toggle`, `POST /echo`, `POST /db/read/smoke` | `docs/api_control.md`, `docs/api_read_write.md`, `docs/PRD/test-mode-prd.md`, `docs/PRD/smoke-prd.md` | `test/server/control.api-contract.test.js`, `test/server/read-write.api-contract.test.js`, `test/server/db.read-smoke.api-contract.test.js` |

## Boundary Rule

n8n is the primary consumer of `pkm-server`, but it must use documented backend APIs for PKM product data.

Allowed direct Postgres usage:
- n8n runtime and execution persistence for the n8n product itself

Not allowed:
- n8n direct reads or writes against PKM product data tables as a feature implementation shortcut

## Review Heuristic

If a workflow-critical route changes, at least three things should move together:
- the owning `docs/api_*.md` contract doc
- the matching contract test
- this workflow map or `docs/backend_route_registry.json` if caller ownership changed
