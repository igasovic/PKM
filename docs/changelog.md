# changelog

## 2026-03-30 — Low-score doc usability cleanup

### What changed
- Added stronger `read this / skip this` guidance to the lowest-utility docs in the current corpus.
- Clarified which docs are:
  - active contract/process docs
  - historical ledgers
  - archive-only references
  - execution companions
- Updated:
  - `docs/database_operations.md`
  - `docs/prd-expectations.md`
  - `docs/requirements.md`
  - `docs/changelog.md`
  - `docs/PRD/family-calendar-prd.md`
  - `docs/PRD/config-work-packages.md`
  - `docs/PRD/distill-work-packages.md`
  - `docs/PRD/family-calendar-work-packages.md`
  - `docs/archive/mcp_api.md`
  - `docs/PRD/archive/README.md`
  - `docs/PRD/archive/MCP-transition-work-packages-v2.md`
  - `docs/PRD/archive/distill-reference-appendix.md`
  - `docs/PRD/archive/failure-pack-work-packages.md`
  - `docs/PRD/archive/n8n-npm-migration.md`

### Cutoff note
- After this entry, low-signal docs should be made explicit about whether they are active, historical, archive-only, or execution companions.

## How To Use This File
- Use this file as a change inbox and historical timeline, not as the long-term owner of surface intent.
- For current behavior, prefer the owning PRD and the authoritative contract docs.
- When adding a new entry, list the affected surfaces and impacted PRDs explicitly.

## Entry Template

Use this lightweight shape for new entries:
- `What changed`
- `Surfaces changed`
- `PRDs impacted`
- `Contract docs impacted`
- `Cutoff note` when the entry changes how later readers should interpret the docs

## 2026-03-30 — PRD split and filename normalization pass

### What changed
- Normalized active PRD filenames to lowercase kebab-case so the corpus is easier to scan and reference consistently.
- Split oversized PRDs where a clean contract/reference boundary existed:
  - `docs/PRD/distill-prd.md` now keeps the active contract
  - `docs/PRD/archive/distill-reference-appendix.md` now holds the most reference-heavy appendix material
  - `docs/PRD/smoke-prd.md` now keeps the active smoke-harness contract
  - `docs/PRD/smoke-detailed-matrix.md` now holds the detailed test matrix, fixtures, assertion guidance, and implementation handoff
- Updated PRD routing docs to acknowledge active reference companions:
  - `docs/PRD/README.md`
  - `docs/prd-expectations.md`

### Cutoff note
- After this entry, active PRDs should prefer lowercase kebab-case filenames and should split dense appendix or matrix material into companion docs when that improves retrieval without weakening ownership.

## 2026-03-30 — PRD usability pass

### What changed
- Added a retrieval layer to active PRDs so agents can find the right sections faster instead of reading large files linearly:
  - `Use this PRD when`
  - `Fast path by agent`
  - `Section map` on larger PRDs
- Updated:
  - `docs/PRD/README.md`
  - `docs/prd-expectations.md`
  - `docs/PRD/ingest-prd.md`
  - `docs/PRD/classify-prd.md`
  - `docs/PRD/read-prd.md`
  - `docs/PRD/test-mode-prd.md`
  - `docs/PRD/working-memory-prd.md`
  - `docs/PRD/gpt-actions-integration-prd.md`
  - `docs/PRD/pkm-ui-prd.md`
  - `docs/PRD/config-prd.md`
  - `docs/PRD/logging-prd.md`
  - `docs/PRD/distill-prd.md`
  - `docs/PRD/failure-pack-prd.md`
  - `docs/PRD/family-calendar-prd.md`
  - `docs/PRD/smoke-prd.md`

### Cutoff note
- After this entry, active PRDs should be maintained as search-first docs with an explicit retrieval layer near the top.

## 2026-03-30 — Requirements migration into owning PRDs

### What changed
- Folded the remaining active requirement areas out of `docs/requirements.md` and into owning PRDs:
  - `docs/PRD/classify-prd.md`
  - `docs/PRD/read-prd.md`
  - `docs/PRD/pkm-ui-prd.md`
  - `docs/PRD/test-mode-prd.md`
  - `docs/PRD/ingest-prd.md`
  - `docs/PRD/distill-prd.md`
  - `docs/PRD/gpt-actions-integration-prd.md`
- Converted `docs/requirements.md` into a legacy migration ledger instead of an active requirements owner.
- Updated `docs/PRD/README.md` so the requirements migration map reflects completed migration rather than pending `PRD_GAP` backfill.

### Cutoff note
- After this entry, `docs/requirements.md` should be treated as a historical index and migration ledger, not as the primary owner of active feature requirements.

## 2026-03-30 — Ingest PRD deep-dive + PRD gap ownership map

### What changed
- Deepened `docs/PRD/ingest-prd.md` from a boundary-only baseline into a more useful ingest contract:
  - added method matrix
  - added idempotency policy ownership table
  - added write-boundary / batch-write semantics
  - added retrieval / quality ownership notes
  - tightened evidence sources and reduced resolved uncertainty
- Added a concrete requirements-to-PRD backfill map in:
  - `docs/PRD/README.md`
- Updated `docs/requirements.md` markers so remaining `PRD_GAP:` items point at exact intended PRD owners.
- Added an explicit changelog-as-inbox rule to:
  - `docs/prd-expectations.md`

### PRDs impacted
- `docs/PRD/ingest-prd.md`
- `docs/PRD/README.md`

## 2026-03-30 — PRD corpus rework cutoff

### What changed
- Reworked the active PRD corpus around owned surfaces instead of historical drafting order:
  - added active index: `docs/PRD/README.md`
  - added baseline PRDs:
    - `docs/PRD/ingest-prd.md`
    - `docs/PRD/test-mode-prd.md`
    - `docs/PRD/classify-prd.md`
    - `docs/PRD/read-prd.md`
    - `docs/PRD/working-memory-prd.md`
    - `docs/PRD/pkm-ui-prd.md`
- Tightened retained active PRDs so ownership is clearer:
  - `docs/PRD/gpt-actions-integration-prd.md`
  - `docs/PRD/config-prd.md`
  - `docs/PRD/distill-prd.md`
  - `docs/PRD/logging-prd.md`
  - `docs/PRD/smoke-prd.md`
  - `docs/PRD/failure-pack-prd.md`
  - `docs/PRD/family-calendar-prd.md`
- Moved completed or historical artifacts under `docs/PRD/archive/`.
- Removed obsolete PRD copies:
  - `docs/PRD/project_instructions.v2.md`
  - `docs/PRD/project_instructions.v3.md`
  - duplicate `docs/PRD/MCP-work-packages.md`
- Updated process/routing docs:
  - `docs/prd-expectations.md`
  - `docs/README.md`
  - `AGENTS.md`
- Added `PRD_GAP:` markers in `docs/requirements.md` for requirements that still have no explicit active PRD owner.

### Cutoff note
- Use this entry as the documentation cutoff point for future changelog-driven PRD analysis.
- Entries before this date may reference pre-rework PRD filenames and pre-archive locations.

## 2026-03-30 — WF99 decomposition + ignore rules + code-node transport guard

### What changed
- Added n8n style-guide guardrail:
  - Code nodes must not perform direct HTTP/SSH transport calls.
  - direct Code-node transport calls now require explicit user request + confirmation before implementation.
  - file: `docs/n8n_node_style_guide.md`
- Decomposed `99 Error Handling` workflow from one monolithic Code node into focused steps:
  - `Extract Failure Context`
  - `Check Ignore Rules`
  - `IF Ignore Error`
  - `Build Failure Pack Envelope`
  - `Store Failure Pack` (standard HTTP Request node)
  - `Merge Pack Context`
  - `Finalize Failure Pack Result`
  - `Run Smoke Cleanup`
  - `Compose Message` (compose-only)
  - file: `src/n8n/workflows/99-error-handling__R2r3jkL5Rb39zKpyutwhW.json`
- Added new WF99 externalized node modules and root exports:
  - `extract-failure-context__...js`
  - `check-ignore-rules__...js`
  - `build-failure-pack-envelope__...js`
  - `finalize-failure-pack-result__...js`
  - `run-smoke-cleanup__...js`
  - updated `compose-message__...js` to message-composition only
  - file: `src/n8n/package.manifest.json`
- Added static ignore rule for appendix-2 class error:
  - workflow `04 Notion Capture` + message `Gateway timed out - perhaps try again later?`
  - appendix-1 IMAP deactivation ignore remains covered via static rule matching.
- Updated WF99 node tests to cover extraction, ignore rules, and smoke cleanup/message composition path:
  - file: `test/server/n8n.error-handling-message.test.js`
- Updated failure-pack PRD/work-package docs to reflect ignore gate + HTTP-node transport split:
  - `docs/PRD/failure-pack-prd.md`
  - `docs/PRD/failure-pack-work-packages-draft.md`

## 2026-03-29 — Calendar normalize resilience + calendar model alias

### What changed
- Calendar extraction graph now defaults to LiteLLM alias `pkm-default`:
  - `src/server/calendar/extraction.graph.js`
- LiteLLM routing config now includes `pkm-default` alias:
  - `ops/stack/litellm/config.yaml`
- `POST /calendar/normalize` now maps malformed request errors (`400`/`404`) to structured business response:
  - HTTP `200`
  - `status: "rejected"`
  - `warning_codes: ["normalize_bad_request"]`
  - preserves human-readable `message`
- Added API-contract test coverage for malformed normalize requests returning rejected payload instead of transport error:
  - `test/server/calendar.api-contract.test.js`
- Updated API docs:
  - `docs/api.md`

## 2026-03-28 — Failure-pack diagnostics path (WF99 + PKM + Debug UI)

### What changed
- Added failure-pack shared utility module:
  - `src/libs/failure-pack.js`
  - schema normalization (`failure-pack.v1`)
  - secret redaction helpers
  - sidecar relative-path validation
- Added backend failure-pack persistence/read surface:
  - `POST /debug/failures`
  - `GET /debug/failures/:failure_id`
  - `GET /debug/failures/by-run/:run_id`
  - `GET /debug/failures`
  - `GET /debug/failure-bundle/:run_id`
- Added DB migration for prod-only failure store:
  - `scripts/db/migrations/2026-03-28_failure_packs.sql`
  - table `pkm.failure_packs` keyed by `run_id`
- Extended WF99 error handler to:
  - build normalized failure-pack envelope
  - redact payloads
  - write sidecar artifacts under shared storage
  - post to PKM and report pack-status in Telegram alert text
- Added Debug UI Failures page:
  - route/menu: `/failures`
  - recent list + filters + run-id lookup
  - detail view with stored pack and bundle trace
- Updated docs/contracts:
  - `docs/api.md`
  - `docs/database_schema.md`
  - `docs/env.md`
  - `docs/config_operations.md`
  - `docs/requirements.md`
  - `src/web/pkm-debug-ui/README.md`
- Added tests:
  - `test/server/failure-pack.api-contract.test.js`
  - `test/server/failure-pack.utils.test.js`

## 2026-03-27 — WF11 read routing moved fully into n8n

### What changed
- Updated `11 ChatGPT Read Router` so n8n now:
  - parses semantic read command/intent (`pull|continue|last|find`)
  - routes to existing backend read endpoints (`/db/read/*`)
  - builds context-pack markdown in n8n before responding
- Removed backend `POST /chatgpt/read` route.
- Added backend `POST /chatgpt/working_memory` route for direct topic-keyed working-memory retrieval.
- Added externalized WF11 execute node:
  - `execute-routed-read__48f7c595-f134-4a6a-8b0c-6756511ad76d.js`
- Updated WF11 runtime package root exports with `wf11ExecuteRoutedRead`.
- Updated docs to reflect that ChatGPT read path is n8n routing + direct `/db/read/*` calls.

## 2026-03-26 — n8n-first ChatGPT integration transition (MCP legacy-disabled)

### What changed
- Moved active ChatGPT integration path to n8n orchestration:
  - GPT action -> n8n webhook -> internal backend action routes.
- Marked MCP endpoint as legacy-disabled:
  - `POST /mcp` now returns HTTP `410` with `legacy_disabled`.
- Added internal backend action routes for n8n:
  - `POST /chatgpt/read`
  - `POST /chatgpt/wrap-commit`
  - both require `x-pkm-admin-secret`.
- Added exactly two new n8n workflows for ChatGPT integration:
  - `05 ChatGPT Wrap Commit`
  - `11 ChatGPT Read Router`
- Added externalized n8n code nodes and package root exports for these workflows.
- Updated canonical PRD/instruction surfaces to v3 transition docs:
  - `docs/PRD/gpt-actions-integration-prd.md`
  - `docs/PRD/MCP-work-packages.md`
  - `chatgpt/project_instructions.md`
- Marked `docs/mcp_api.md` as legacy reference.
- Updated API and requirements docs to the n8n-first contract.

## 2026-03-24 — MCP surface on pkm-server (`POST /mcp`) + wrap commit capture flow

### What changed
- Updated MCP transport for v1 testing:
  - `/mcp` auth switched to no-auth mode (removed `x-pkm-admin-secret` requirement for this route)
  - `/mcp` now supports SSE streaming (`Accept: text/event-stream` or `transport: "sse"`) with `meta -> result|error -> done` events
- Added ChatGPT-facing MCP transport endpoint:
  - `POST /mcp` in `src/server/index.js`
  - MCP protocol dispatcher in `src/server/mcp/protocol.js`
  - MCP tool registry/handlers in `src/server/mcp/registry.js` and `src/server/mcp/service.js`
- Implemented approved MCP toolset only:
  - `pkm.last`, `pkm.find`, `pkm.continue`, `pkm.pull`, `pkm.pull_working_memory`, `pkm.wrap_commit`
- Added dedicated topic-keyed working-memory read path in approved DB layers:
  - `buildReadWorkingMemory` in `src/libs/sql-builder.js`
  - `readWorkingMemory` in `src/server/db.js`
- Added wrap-commit artifact renderers:
  - `src/server/mcp/renderers.js`
  - session note and working memory markdown are rendered server-side and written via one MCP write flow
- Added MCP contract test coverage:
  - `test/server/mcp.api-contract.test.js`
- Added idempotency policy migration for ChatGPT MCP artifacts:
  - `scripts/db/migrations/2026-03-24_mcp_chatgpt_policies.sql`
- Added MCP docs and updated contract docs:
  - `docs/mcp_api.md` (new)
  - `docs/api.md`, `docs/requirements.md`, `docs/database_schema.md`

## 2026-03-19 — Global root-wrapper migration + n8n ops output readability

### What changed
- Migrated remaining workflow Code-node wrappers from package subpath imports to package-root exports:
  - wrappers now consistently call `require('@igasovic/n8n-blocks')` with `wf<NN><NodeName>` exports.
- Externalized remaining inline n8n Code nodes that depended on package shared helpers into canonical files under `src/n8n/nodes/**`.
- Expanded `src/n8n/package.manifest.json` root exports to cover all migrated wrapper targets.
- `updatecfg n8n --push` progress now reports push substeps (build package, recreate stack, patch workflows, validate live) instead of a single opaque sync step.
- n8n config-op output now shortens n8n paths to repo-relative forms (for example `workflows/...`, `nodes/...`) and masks node ids in filenames as `__ab****cdef.js`.
- n8n sync/migration scripts now mask node-id segments in script-emitted node filename lists for readability.

## 2026-03-19 — WF10 root-export wrapper migration

### What changed
- Updated all Code nodes in `10 Read` to use package-root wrapper imports from `@igasovic/n8n-blocks` with stable WF10 export names (`wf10...`).
- Externalized previously inline WF10 code nodes into canonical files under `src/n8n/nodes/10-read/`:
  - `format-help-message__83d12448-5f97-48f1-9ece-de61a9756db3.js`
  - `build-context-pack__3580c243-cd64-4bc2-8b4f-ab5215ff71a1.js`
  - `format-delete-message__3feac23b-f095-4af9-9179-3b0a1a4279a2.js`
  - `format-move-message__344aac95-db6e-4262-9441-1072918d9d48.js`
  - `build-read-smoke-result__93ed61ff-ed68-4a8d-bb78-047a8812675e.js`
- Expanded `src/n8n/package.manifest.json` root exports for all WF10 wrapper targets.
- Kept `readCommandParser` root export as compatibility alias while introducing `wf10CommandParser`.

## 2026-03-17 — n8n runtime package migration (`@igasovic/n8n-blocks`)

### What changed
- Replaced canonical n8n runtime imports from `/data/...` with package imports under `@igasovic/n8n-blocks/...`:
  - workflow wrappers now call stable package subpaths like `@igasovic/n8n-blocks/nodes/<workflow>/<node>.js`
  - shared helper imports now use `@igasovic/n8n-blocks/shared/...`
- Added generated n8n runtime package flow:
  - `src/n8n/package.manifest.json`
  - `scripts/n8n/build_runtime_package.js`
  - generated output under ignored `src/n8n/package/`
- Added custom runners image build flow:
  - `ops/stack/n8n-runners/Dockerfile`
  - `scripts/n8n/build_runners_image.sh`
  - compose now uses local image `pkm-n8n-runners:2.10.3`
- Updated n8n sync/apply behavior:
  - `scripts/n8n/sync_workflows.sh` now builds the runtime package, builds the runners image, recreates `n8n` + `n8n-runners`, patches workflows, and validates the live export
  - `scripts/n8n/sync_code_nodes.py` and `scripts/n8n/sync_nodes.py` now canonicalize and validate package imports instead of `/data/...` imports
  - `scripts/cfg/lib.sh` `checkcfg n8n` now validates the generated runtime package before live comparison
- Updated test/CI wiring:
  - `src/server/package.json` builds the runtime package before Jest and resolves it through `NODE_PATH`
  - `scripts/CI/check.sh` now builds the runtime package and forbids legacy `/data/src/...` runtime imports in canonical n8n sources
- Updated repo and ops docs:
  - `AGENTS.md`
  - `docs/env.md`
  - `docs/n8n_sync.md`
  - `docs/n8n_node_style_guide.md`
  - `docs/config_operations.md`
  - `docs/repo-map.md`
  - `docs/requirements.md`
  - `docs/PRD/n8n-npm-migration.md`

## 2026-03-15 — Smoke cleanup on error path via WF99

### What changed
- Wired smoke master to use WF99 as `errorWorkflow`:
  - `src/n8n/workflows/00-smoke-master__2DB1S0mq7UQN4U3InXRM0.json`
- Extended WF99 compose logic to detect smoke-master failures and run cleanup on the error path:
  - `src/n8n/nodes/99-error-handling/compose-message__566912ab-5d96-4405-8443-6a296ef03366.js`
  - detects smoke by workflow id/name
  - invokes smoke cleanup helper (`00-smoke-master/t99-cleanup__...js`)
  - includes cleanup status/details in Telegram failure report (`Smoke cleanup: ok|failed`, deleted IDs, cleanup error)
- Updated smoke PRD snapshot/failure behavior notes:
  - `docs/PRD/smoke-prd.md`

## 2026-03-15 — Fail-fast n8n workflow policy + smoke precheck hard-fail

### What changed
- Enforced fail-fast workflow behavior across `src/n8n/workflows/`:
  - removed all `continueOnFail: true`
  - removed node-level continuation error modes (`onError: continueRegularOutput|continueErrorOutput`)
- Updated smoke master command prechecks so dependent tests are not called with missing IDs:
  - `Build T06 Pull Command` now throws when `telegram_capture_entry_id` is missing
  - `Build T08 Distill Command` now throws when `telegram_capture_entry_id` is missing
  - `Build T09 Delete Command` now throws when no capture IDs are available
- Added style-guide rule:
  - `docs/n8n_node_style_guide.md` section `3.4 Fail-fast error handling`

## 2026-03-15 — Smoke harness failure propagation + safe fallback removal

### What changed
- Updated smoke capture URL fixtures to use a real extractable page:
  - `https://paulgraham.com/todo.html`
  - affected:
    - `test/smoke/fixtures/telegram/capture_with_url.json`
    - `test/smoke/fixtures/telegram/capture_duplicate.json`
    - `src/n8n/workflows/00-smoke-master__2DB1S0mq7UQN4U3InXRM0.json` (`Build T04 Capture Fixture`)
- Removed unsafe fallback command defaults that previously targeted entry `1`:
  - `Build T06 Pull Command` now falls back to `/pull` (usage path)
  - `Build T08 Distill Command` now falls back to `/distill` (usage path)
  - `Build T09 Delete Command` now falls back to `/delete test` (usage path)
- Hardened smoke master error semantics:
  - `Run T03..T11` execute-workflow nodes now use explicit node-level error handling (`onError=continueRegularOutput`) with `alwaysOutputData=true`
  - added final `Fail Smoke Run` node after summary send to mark workflow failed when any smoke test failed
  - `Send Smoke Summary` now routes both success and error outputs to final fail gate
- Hardened `T99 - Cleanup` externalized node:
  - delete and test-mode restore are isolated steps (restore still runs if delete fails)
  - cleanup aggregates IDs from artifacts and prior results and deduplicates before delete
  - cleanup reports targeted IDs in artifacts (`deleted_ids`)

## 2026-03-14 — Smoke harness implementation (n8n-first)

### What changed
- Added smoke orchestration workflows:
  - `src/n8n/workflows/00-smoke-master__4kWjqNPBe5ghmxY2q7v6G.json`
  - `src/n8n/workflows/00-smoke-public-ingress__X8t6FxE3d8asR3hMz2yqA.json`
- Added smoke fixtures/config:
  - `test/smoke/fixtures/**`
  - `test/smoke/config/defaults.json`
- Updated core workflows for smoke assertions/result contracts and dry-run notifications:
  - `01 Telegram Router`
  - `02 Telegram Capture`
  - `03 E-Mail Capture`
  - `10 Read`
  - `30 Calendar Create`
  - `31 Calendar Read`
- Added/updated calendar smoke guardrails in externalized node logic:
  - enforce explicit `test_calendar_id` and `prod_calendar_id` in `calendar_test_mode`
  - hard-fail when IDs collide
  - add `[SMOKE <test_run_id>]` tagging in calendar-create summaries
- Added/updated Jest coverage for calendar-create/read smoke-mode behavior:
  - `test/server/n8n.calendar-router-create.test.js`
  - `test/server/n8n.calendar-read.test.js`

## 2026-03-14 — Calendar display/timezone routing fixes

### What changed
- Routing rule update for short query alias:
  - `src/server/telegram-router/routing.rules.js`
  - `cal tomorrow` now routes to `calendar_query` (instead of PKM capture fallback)
- Calendar title normalization update:
  - `src/server/calendar/deterministic-extractor.js`
  - removes bare-hour connectors like `at 5` from title text, preventing subjects like `Louie store at 5`
- Calendar read message timezone/display hardening:
  - `src/n8n/nodes/31-calendar-read/format-calendar-read-message__7ec3a63a-4e24-4d8b-aa65-7644b31d6162.js`
  - event time labels are rendered in configured calendar timezone (not host-local timezone)
  - Telegram-authored coded events display original start label from subject code (for example `2:00p`) while retaining sort by event start
- Calendar create payload timezone hardening:
  - `src/n8n/workflows/30-calendar-create__valOh9zMfqOZOvmHyOQfa.json` (`Build Google Event Payload` and result message formatting)
  - creates Google event timestamps with explicit UTC offset (`YYYY-MM-DDTHH:mm:ss±HH:MM`)
  - create confirmation now preserves coded subject text (no `L/DOG` rewriting)
- Added compatibility shims for older node-id paths still referenced by tests/tooling:
  - under `src/n8n/nodes/01-telegram-router/`, `30-calendar-create/`, `31-calendar-read/`, `32-calendar-report/`
- Updated tests/fixtures:
  - `test/fixtures/calendar-evals/routing.json`
  - `test/server/calendar-service.test.js`
  - `test/server/n8n.calendar-read.test.js`
  - `test/server/n8n.calendar-router-create.test.js`

## 2026-03-14 — Error workflow node-name resolution hardening (WF 99)

### What changed
- Externalized `99 Error Handling` compose node to:
  - `src/n8n/nodes/99-error-handling/compose-message__566912ab-5d96-4405-8443-6a296ef03366.js`
- Updated workflow wrapper:
  - `src/n8n/workflows/99-error-handling__R2r3jkL5Rb39zKpyutwhW.json`
- Improved node name extraction for Telegram alerts:
  - reads nested `execution.error.*` fields
  - parses node script path from stack traces like `/data/src/n8n/nodes/<wf>/<node>__<id>.js`
  - parses `extjs:<wf>/<node>__<id>.js` style errors
  - falls back cleanly when no signal exists
- Kept IMAP auto-deactivation suppression and expanded match to use message text when node name is missing.
- Added tests:
  - `test/server/n8n.error-handling-message.test.js`

## 2026-03-14 — Conflict-check error path keeps create payload (WF 30)

### What changed
- Hardened conflict-context builder:
  - `src/n8n/nodes/30-calendar-create/prepare-conflict-context__ec57f2a4-7b67-4485-b6d3-3bf7a6b3b0d1.js`
- Behavior on conflict-check error-only items:
  - preserves upstream `Build Google Event Payload` fields (`request_id`, Google create fields, etc.)
  - does not let the error-only check payload overwrite create payload
  - adds `calendar_conflict_check_failed` warning code
  - surfaces warning text in `warning_message`
- Added regression test for this exact path:
  - `test/server/n8n.calendar-router-create.test.js`

## 2026-03-14 — Calendar finalize hardening for merged warning payloads

### What changed
- Hardened finalize helper to prevent false `calendar_failed` when Google event was created:
  - `src/n8n/nodes/30-calendar-create/prepare-finalize-request__4c9a5cd8-7c13-4ad8-8d1c-a10f2f23520b.js`
  - success now follows event id presence (`id`/`eventId`/`event_id`/`google_event_id`) unless explicit failure was set
  - recovers missing `request_id` from event description line `PKM request id: ...` and upstream node items (`Build Google Event Payload` / normalize merge path) as fallback
  - records non-blocking upstream warning as `calendar_non_blocking_warning` instead of failing finalize
- Updated workflow node wrapper in:
  - `src/n8n/workflows/30-calendar-create__valOh9zMfqOZOvmHyOQfa.json`
- Added regression tests:
  - `test/server/n8n.calendar-router-create.test.js`

## 2026-03-14 — Extraction clarification preference + normalize trace + router-owned continuation hardening

### What changed
- Strengthened deterministic calendar validation to prefer LLM-provided clarification wording when fields are still missing:
  - `src/server/calendar/deterministic-extractor.js`
  - falls back to deterministic missing-fields prompt when LLM question is absent/invalid
- Hardened router-owned continuation boundary:
  - `/calendar/normalize` no longer infers continuation via latest-open-by-chat
  - continuation is selected by `/telegram/route` and passed as explicit `request_id`
- Added optional normalize trace exposure for eval/debug:
  - `POST /calendar/normalize` accepts `include_trace=true`
  - response includes `normalize_trace` when requested
- Added/updated tests:
  - `test/server/calendar-service.test.js` (LLM clarification preference + fallback)
  - `test/server/calendar.api-contract.test.js` (explicit request_id continuation + include_trace response)
- Updated contract docs:
  - `docs/api.md`

## 2026-03-14 — Router-owned clarification continuation override

### What changed
- Updated `POST /telegram/route` logic in `src/server/index.js` so continuation routing is owned by router API:
  - structured checks run first (`/`, `cal:`, `pkm:`)
  - only non-structured text is eligible for continuation override
  - if latest open calendar request exists for the chat, route is forced to `calendar_create` and existing `request_id` is reused
  - continuation reuse skips creating a new `calendar_requests` route row for the same turn
- Added API contract tests in `test/server/calendar.api-contract.test.js`:
  - continuation override for non-structured follow-up text
  - no continuation override for structured prefix text

## 2026-03-14 — Hybrid Telegram routing + calendar extraction graphs

### What changed
- Refactored backend calendar intent logic into dedicated graph modules:
  - routing graph under `src/server/telegram-router/`
  - extraction graph under `src/server/calendar/`
- Added routing graph components:
  - `src/server/telegram-router/routing.rules.js`
  - `src/server/telegram-router/routing.prompt.js`
  - `src/server/telegram-router/routing.schema.js`
  - `src/server/telegram-router/routing.graph.js`
- Added calendar extraction graph components:
  - `src/server/calendar/extraction.prompt.js`
  - `src/server/calendar/extraction.schema.js`
  - `src/server/calendar/extraction.graph.js`
  - deterministic validator/extractor moved to `src/server/calendar/deterministic-extractor.js`
- Converted `src/server/calendar-service.js` into a compatibility facade that delegates to graph runners while preserving the existing API response contract shape.
- Updated calendar service/eval tests to async graph-backed calls:
  - `test/server/calendar-service.test.js`
  - `test/server/calendar-evals.test.js`
- Updated family-calendar PRD/work-package docs to formalize the hybrid graph architecture and module placement.

## 2026-03-13 — Calendar conflict-context node branch-safe fallback

### What changed
- Fixed `Prepare Conflict Context` externalized node to handle branch paths where `Build Google Event Payload` was not executed.
- Updated `src/n8n/nodes/30-calendar-create/prepare-conflict-context__ec57f2a4-7b67-4485-b6d3-3bf7a6b3b0d1.js`:
  - wrapped `$items('Build Google Event Payload')` lookup in `try/catch`
  - falls back to current `ctx.$json` instead of failing execution
- Prevents runtime errors like:
  - `Node 'Build Google Event Payload' hasn't been executed`
  - downstream `ExecutionBaseError` wrapping failures

## 2026-03-13 — Error handling noise filter for IMAP trigger auto-deactivation

### What changed
- Updated `99 Error Handling` formatter in `src/n8n/workflows/99-error-handling__R2r3jkL5Rb39zKpyutwhW.json` to suppress Telegram notifications for the known low-signal IMAP trigger auto-deactivation message:
  - trigger name includes `Email Trigger (IMAP)`
  - message contains `There was a problem with the trigger node...workflow had to be deactivated`
- Suppressed events now return no items from the formatter node, so `Send Telegram Message` is skipped for that case.

## 2026-03-13 — Telegram MarkdownV2 formatter primitives + 10 Read refactor

### What changed
- Expanded shared Telegram MarkdownV2 helper in `src/libs/telegram-markdown.js`:
  - added formatter primitives: `bold`, `italic`, `code`, `kv`, `bullet`, `arrow`, `parens`, `brackets`, `nl`, `joinLines`
  - added `finalizeMarkdownV2` and kept backward-compatible `mdv2`, `mdv2Message`, `mdv2Render`
- Refactored 10 Read Markdown message builders to use shared primitives (removed manual escape token assembly):
  - `src/n8n/nodes/10-read/format-telegram-message__f305ac84-35d3-44df-8ef5-1c0e004f37b8.js`
  - `src/n8n/nodes/10-read/format-status-message__075f1d02-d3af-43dc-a694-f387f757ba3d.js`
  - `src/n8n/nodes/10-read/format-distill-message__ef76e14a-f96e-4cb2-90da-c1b8f6fd2fca.js`
  - `src/n8n/nodes/10-read/format-distill-run-message__b9f00fcd-a5ed-462f-a8d0-3e49c20eca11.js`
- Added regression coverage:
  - `test/server/telegram-markdown.test.js`
  - `test/server/n8n.format-telegram-message.test.js`
  - updated `test/server/n8n.format-distill-run-message.test.js` for escaped parenthesized counts

## 2026-03-13 — Calendar create hardening + scheduled report workflows + Telegram MarkdownV2 helper

### What changed
- Standardized Telegram Markdown escaping for workflow-generated messages:
  - added shared helper `src/libs/telegram-markdown.js` (`mdv2`)
  - updated Telegram message builder nodes/workflows to use shared escaping and `parse_mode=MarkdownV2`
- Hardened `30 Calendar Create` workflow (`src/n8n/workflows/30-calendar-create__valOh9zMfqOZOvmHyOQfa.json`):
  - added pre-create overlap check (`Google Calendar Check Conflicts`)
  - added conflict context helper (`src/n8n/nodes/30-calendar-create/prepare-conflict-context__ec57f2a4-7b67-4485-b6d3-3bf7a6b3b0d1.js`)
  - added one silent retry for Google create (`retryOnFail=true`, `maxTries=2`)
  - create confirmation now includes conflict warning summary when overlap exists
- Implemented WP7 report workflows:
  - added `src/n8n/workflows/32-calendar-daily-report__hK7B2Y4uWn3Rm9QpLd0Sa.json`
  - added `src/n8n/workflows/33-calendar-weekly-report__tV8mQ2nL6xP4cR1jHf7Ds.json`
  - both use scheduled triggers, Google calendar read, Telegram MarkdownV2 send, and backend `POST /calendar/observe` logging
  - added shared report helpers:
    - `src/n8n/nodes/32-calendar-report/build-report-window__1d7fa7c9-3ac6-4b7e-bf0a-6e2e7789f31a.js`
    - `src/n8n/nodes/32-calendar-report/format-calendar-report-message__58f6c53c-5dad-4d29-93d0-00dc8f7d5683.js`
- Added WP8-oriented eval/snapshot coverage:
  - new fixture-based eval dataset:
    - `test/fixtures/calendar-evals/routing.json`
    - `test/fixtures/calendar-evals/normalization.json`
    - `test/fixtures/calendar-evals/clarification.json`
  - new tests:
    - `test/server/calendar-evals.test.js`
    - `test/server/n8n.calendar-report.test.js`
  - extended create helper tests:
    - `test/server/n8n.calendar-router-create.test.js` (conflict context assertions)

## 2026-03-13 — Telegram chat-id key standardization and admin fallback config

### What changed
- Standardized n8n Telegram reply routing key usage:
  - removed `$json.chat_id` expression usage from workflow sender nodes
  - standardized on `$json.telegram_chat_id` with message-derived fallback
- Updated Telegram sender-node fallback expressions in:
  - `src/n8n/workflows/01-telegram-router___NgZy8xU5XGXrBeBjl2cp.json`
  - `src/n8n/workflows/02-telegram-capture__EWyb1cTmqDlKY2pIyqULN.json`
  - `src/n8n/workflows/10-read__dq9Nex-IR8AToJvHksphj.json`
  - `src/n8n/workflows/30-calendar-create__valOh9zMfqOZOvmHyOQfa.json`
  - `src/n8n/workflows/31-calendar-read__DwtBNN8QIebQC3G-IsuCU.json`
- Updated command parser output shape:
  - `src/n8n/nodes/10-read/command-parser__926eb875-5735-4746-a0a4-7801b8db586f.js`
  - command outputs now emit `telegram_chat_id` (not `chat_id`)
- Added repo-owned n8n non-secret config:
  - `ops/stack/env/n8n.env` with `TELEGRAM_ADMIN_CHAT_ID=1509032341`
  - wired into `ops/stack/docker-compose.yml` (`n8n` service `env_file`)
- Updated docs:
  - `docs/n8n_node_style_guide.md` (new Telegram node guidance section)
  - `docs/config_operations.md` (registry example for `TELEGRAM_ADMIN_CHAT_ID`)

## 2026-03-13 — Telegram ingress/reply chat handling improvements

### What changed
- Updated primary Telegram ingress workflow:
  - `src/n8n/workflows/01-telegram-router___NgZy8xU5XGXrBeBjl2cp.json`
  - removed trigger-level `chatIds` lock from `01 Telegram Router` trigger (chat-agnostic ingress)
  - ambiguous-reply node now resolves `chatId` dynamically from payload (`telegram_chat_id`/`chat_id`/`message.chat.id`) with fallback to admin chat id
- Updated PKM capture workflow reply routing:
  - `src/n8n/workflows/02-telegram-capture__EWyb1cTmqDlKY2pIyqULN.json`
  - all Telegram send nodes now use dynamic chat-id fallback expression instead of hardcoded `1509032341`
  - `/normalize/telegram` payload now includes `source.user_id` from Telegram sender (`message.from.id`)
- Updated PKM read workflow reply routing:
  - `src/n8n/workflows/10-read__dq9Nex-IR8AToJvHksphj.json`
  - all Telegram send nodes now use dynamic chat-id fallback expression instead of hardcoded `1509032341`
- Added PKM command allowlist enforcement by Telegram sender id in command parser:
  - `src/n8n/nodes/10-read/command-parser__926eb875-5735-4746-a0a4-7801b8db586f.js`
  - when allowlist enforcement is enabled and sender is not in `pkm_allowed_user_ids`, parser returns immediate calendar-only access message
- Added parser test coverage:
  - `test/server/n8n.command-parser.test.js`

## 2026-03-13 — Telegram allowlist enforcement for calendar-only vs PKM access

### What changed
- Added calendar Telegram access config in `src/libs/config/index.js`:
  - `calendar.telegram_access.enforce_allowlist`
  - `calendar.telegram_access.calendar_allowed_user_ids`
  - `calendar.telegram_access.pkm_allowed_user_ids`
- Added backend access policy helper:
  - `src/server/calendar-access.js`
  - resolves sender access from Telegram `user_id`
  - downgrades disallowed routes to `ambiguous` with explicit access clarification text
- Enforced access policy in backend API:
  - `POST /telegram/route` applies allowlist policy before returning route
  - `POST /calendar/normalize` returns `status=rejected` when sender is not calendar-allowed
- Updated n8n workflow payload wiring to pass sender identity:
  - `src/n8n/workflows/01-telegram-router___NgZy8xU5XGXrBeBjl2cp.json`
    - explicit `pkm:` now routes through backend route decision
    - route request now includes `source.user_id`
  - `src/n8n/workflows/30-calendar-create__valOh9zMfqOZOvmHyOQfa.json`
    - normalize request now includes Telegram `user_id`
- Added repo-owned non-secret env placeholders:
  - `ops/stack/env/pkm-server.env`
    - `CALENDAR_TELEGRAM_ENFORCE_ALLOWLIST`
    - `CALENDAR_TELEGRAM_ALLOWED_USER_IDS`
    - `CALENDAR_TELEGRAM_PKM_ALLOWED_USER_IDS`
- Updated docs:
  - `docs/api.md` (calendar route/normalize payload + env vars)
  - `docs/config_operations.md` (repo ownership for calendar allowlist vars)
  - `docs/PRD/family-calendar-prd.md` (formalized allowlist model)

## 2026-03-12 — Family calendar backend foundation (WP1-WP3 start)

### What changed
- Added shared calendar config surface in `src/libs/config/index.js`:
  - timezone/prefix defaults
  - people registry, category registry
  - default durations, padding, and clarification policy flags
  - v1 create rules (`allow_all_day=false`, `allow_recurrence=false`)
- Added prod-only calendar business-log migration:
  - `scripts/db/migrations/2026-03-12_calendar_business_logs.sql`
  - creates:
    - `pkm.calendar_requests`
    - `pkm.calendar_event_observations`
  - includes one-open-request partial unique index for `needs_clarification` status
- Added calendar backend service module:
  - `src/server/calendar-service.js`
  - provides intent routing and normalization logic for v1 create flows
- Extended backend DB layer (`src/server/db.js`) with prod-pinned calendar methods:
  - request upsert/get/update/finalize paths
  - latest-open-request lookup by chat
  - observation insert path
- Added new API endpoints in `src/server/index.js`:
  - `POST /telegram/route` (admin-protected)
  - `POST /calendar/normalize` (admin-protected)
  - `POST /calendar/finalize` (admin-protected)
  - `POST /calendar/observe` (admin-protected)
- Added tests:
  - `test/server/calendar-service.test.js`
  - `test/server/calendar.api-contract.test.js`
- Updated docs:
  - `docs/api.md` (new calendar endpoint contracts)
  - `docs/database_schema.md` (new prod-only calendar tables + invariants)
- Added n8n workflow routing and calendar workflow scaffolding:
  - updated `src/n8n/workflows/01-telegram-router___NgZy8xU5XGXrBeBjl2cp.json`
    - explicit `pkm:` / `cal:` prefix handling
    - backend fallback routing via `POST /telegram/route`
    - route fan-out to:
      - `02 Telegram Capture`
      - `30 Calendar Create`
      - `31 Calendar Read`
      - ambiguous clarification message
  - added `src/n8n/workflows/30-calendar-create__c3lNDV3YhV8m4N7Q2pRk.json`
  - added `src/n8n/workflows/31-calendar-read__wQ9kL2mN5pR7tV3xY8Za.json`
- Added externalized n8n helper modules:
  - `src/n8n/nodes/01-telegram-router/*`
  - `src/n8n/nodes/30-calendar-create/*`
  - `src/n8n/nodes/31-calendar-read/*`
- Added n8n helper tests:
  - `test/server/n8n.calendar-router-create.test.js`
  - `test/server/n8n.calendar-read.test.js`

## 2026-03-12 — Logger Braintrust sink consolidation + verboss removal

### What changed
- Removed obsolete Tier-1 file logger:
  - deleted `src/server/tier1/verboss-logger.js`
  - removed all `verboss` writes from Tier-1 graph and email importer flows
- Sunset `src/server/observability.js`:
  - Braintrust initialization moved to `src/server/logger/braintrust-client.js`
  - shared Braintrust helper wrappers moved to `src/server/logger/braintrust.js`
  - all server callsites now import logger-owned Braintrust helpers/sink
- Upgraded Braintrust sink in `src/server/logger/sinks/braintrust.js`:
  - explicit success/error helpers with `metadata.outcome = success|error`
  - LLM usage normalization (`prompt_tokens`, `completion_tokens`, `reasoning_tokens`, `total_tokens`)
  - automatic `estimated_cost_usd` derivation with precedence:
    - `LLM_MODEL_COSTS_PER_1M_USD_JSON`
    - `LLM_MODEL_<MODEL_KEY>_INPUT/OUTPUT_COST_PER_1M_USD`
    - global `LLM_INPUT/OUTPUT_COST_PER_1M_USD`
  - sink write failures now surface sampled stderr warnings with cumulative/consecutive failure counters
- Refactored LiteLLM client telemetry:
  - `src/server/litellm-client.js` now logs via logger Braintrust sink instead of direct Braintrust client calls
  - `chat.completions` now emits one canonical event per call (retry attempts captured as metadata instead of separate per-attempt events)
- API request telemetry hardening:
  - `capture_text` is redacted on `api.request` error logs as well as success logs
  - `/db/*` handled errors now avoid duplicate request-level Braintrust events (`api.request` + `server.request_error`)
- Added coverage:
  - `test/server/braintrust-sink.test.js`
  - `test/server/braintrust-wrapper.test.js`

## 2026-03-12 — Content hash derivation from clean_text + backfill script

### What changed
- Added shared content hash utility:
  - `src/libs/content-hash.js`
  - derives `content_hash` as SHA-256 hex from `clean_text` (UTF-8), returns `null` for blank/missing text.
- Updated backend normalization outputs in `src/server/normalization.js`:
  - normalized payloads now include `content_hash` wherever `clean_text` is produced.
  - empty-clean webpage path now explicitly returns `content_hash: null`.
- Updated web extraction write path to persist recalculated hash with recalculated clean text:
  - `src/n8n/nodes/22-web-extraction/text-clean__9ceb22a3-83dc-4b29-844e-6a769101b0d2.js`
  - `src/n8n/workflows/22-web-extraction__eYF7ivDiFwDYgi-pFRbpg.json`
- Updated legacy Telegram SQL update module to keep `content_hash` aligned with clean-text updates:
  - `js/workflows/telegram-capture/02_build-sql-update__1c1e479b-b8f6-4d85-9c69-8c0f9943982f.js`
- Added temporary one-off backfill script:
  - `scripts/db/backfill_content_hash.sh`
  - supports `--dry-run` and `--apply` across both `pkm.entries` and `pkm_test.entries`.
- Updated docs:
  - `docs/requirements.md` (hash algorithm + recalc requirements)
  - `docs/api.md` (normalize responses now document `content_hash`)
- Added/updated tests:
  - `test/server/content-hash.test.js`
  - `test/server/normalization.test.js`
  - `test/server/ingestion-pipeline.notion.test.js`
  - `test/sql-builder-update.test.js`

## 2026-03-11 — Config ops performance + targeted backend deploy path

### What changed
- Added `scripts/cfg/importcfg`:
  - dedicated runtime->repo import command for one surface
  - implemented as a thin wrapper over existing `updatecfg <surface> --pull` adapter path
  - reuses the same report and exit semantics as pull mode
- Added `scripts/cfg/bootstrapcfg`:
  - first-time multi-surface runtime->repo bootstrap import helper
  - defaults to `docker litellm postgres cloudflared n8n` and supports `--skip-n8n`
  - reuses existing `importcfg` adapter path for each surface
- Added `scripts/n8n/export_workflows_snapshot.sh`:
  - performs one n8n workflow export and fans out to normalized + raw trees
  - reuses existing rename/normalize scripts to avoid duplicate export passes
- Updated `scripts/cfg/lib.sh` n8n check adapter:
  - `checkcfg n8n` now uses one-shot snapshot export instead of running separate normalized/raw exports
  - keeps existing code-node sync + workflow normalization compare flow
- Updated `scripts/cfg/lib.sh` docker update adapter:
  - `updatecfg docker --push` now resolves apply scope and avoids broad restarts when possible
  - if only service-mapped env files changed, runs targeted compose apply for those services
  - if compose/global/ambiguous changes are detected, falls back to full `docker compose up -d`
  - if no managed docker files changed, skips compose apply
- Updated `scripts/cfg/lib.sh` docker check adapter:
  - `checkcfg docker` now reports affected services for detected docker-surface drift when scope can be resolved
- Added `scripts/cfg/backend_push.sh`:
  - custom backend deploy flow for `updatecfg backend --push`
  - optional repo update (`git pull --ff-only` by default, configurable)
  - targeted compose apply for `pkm-server` only (`docker compose up -d --build pkm-server`)
  - backend readiness check (`/ready`) with bounded retries
- Updated backend adapter wiring:
  - `checkcfg backend` readiness now validates `scripts/cfg/backend_push.sh`
  - `updatecfg backend --push` now runs `scripts/cfg/backend_push.sh`
- Updated docs/tests:
  - `docs/config_operations.md`
  - `docs/PRD/config-prd.md`
  - `docs/PRD/config-work-packages.md`
  - `test/server/config-ops-scripts.test.js` backend deploy-script expectation path + docker apply-scope coverage + importcfg coverage
- Added importcfg guard coverage and operator readme alignment:
  - `test/server/config-ops-scripts.test.js` now covers unknown surface and backend-blocked behavior for `importcfg`
  - `ops/stack/*` readmes now recommend `importcfg` as the runtime->repo import alias
- Added bootstrapcfg coverage:
  - `test/server/config-ops-scripts.test.js` now covers backend rejection and multi-surface bootstrap import flow
- Hardened cloudflared import behavior for token-mode deployments:
  - `importcfg/updatecfg cloudflared --pull` is now non-blocking when runtime `config.yml` is absent but compose indicates token-based tunnel mode
  - added regression coverage in `test/server/config-ops-scripts.test.js`

## 2026-03-09 — Tier-2 async provider-batch runtime and durable status tables

### What changed
- Added Tier‑2 async batch persistence migration:
  - `scripts/db/migrations/2026-03-09_tier2_batch_tables.sql`
  - creates mirrored tables in `pkm` and `pkm_test`:
    - `t2_batches`
    - `t2_batch_items`
    - `t2_batch_item_results`
- Added Tier‑2 batch storage and parsing modules:
  - `src/server/tier2/store.js`
  - `src/server/tier2/domain.js`
- Refactored Tier‑2 orchestration in `src/server/tier2-enrichment.js`:
  - default `execution_mode=batch` path now performs control-plane planning + provider batch enqueue (LiteLLM `/v1/files` + `/v1/batches`)
  - async collect/reconcile now uses durable `t2_*` tables
  - status surfaces now read Tier‑2 batch state from DB-backed tables (with in-memory fallback when tables are unavailable)
  - explicit `execution_mode=sync` remains supported and uses prior single-entry sync loop behavior
- Extended SQL builder for Tier‑2 batch runtime:
  - new helpers for `t2_batch_items` / `t2_batch_item_results` insert/upsert/reconcile paths
  - extended Tier‑2 item-status query fields (`entry_id`, `error_code`, `message`, `preserved_current_artifact`)
  - extended Tier‑2 entry-state projection to include `clean_text` for reconciliation validation
- Added minimal Tier‑2 model config surface for batch direct calls:
  - `distill.models.batch_direct` in `src/libs/config.js`
- Updated docs/contracts:
  - `docs/api.md` (`/distill/run` enqueue semantics + durable Tier‑2 status behavior + `t2_*` tables)
  - `docs/database_schema.md` (Tier‑2 batch tables + mirrored/grant inventory)
  - `docs/requirements.md` (Tier‑2 async enqueue/collect and durable status requirements)

## 2026-03-09 — Distill run mode controls, failure surfacing, and command help updates

### What changed
- Updated Tier‑2 sync service logging in `src/server/tier2/service.js`:
  - renamed persistence failure step from `t2.sync.persist.failed` to `*.persist.failure_state` to avoid ambiguity.
  - batch-triggered single-entry execution now logs under batch-prefixed steps (`t2.batch.entry.*`) instead of sync-prefixed names.
  - added `batch_direct_generation` request type/model route support (`T2_MODEL_BATCH_DIRECT` fallback chain).
- Updated Tier‑2 run orchestration in `src/server/tier2-enrichment.js` and API wiring in `src/server/index.js`:
  - `POST /distill/run` now accepts `execution_mode` (`batch` default, `sync` explicit opt-in).
  - run payloads/status metadata now include `execution_mode`.
  - run payloads/status metadata now include `error_code_counts` aggregation for failed entries.
  - batch loop step name updated from `t2.batch.sync_one` to `t2.batch.process_one`.
- Updated Read workflow n8n command/parser behavior:
  - `src/n8n/nodes/10-read/command-parser__926eb875-5735-4746-a0a4-7801b8db586f.js` now supports:
    - command-specific `--help`/`-h` for major commands
    - richer `/help` output
    - `/distill-run` mode flags: `--batch` (default) and `--sync`
    - conflict guard for `--batch` + `--sync`
  - `src/n8n/workflows/10-read__dq9Nex-IR8AToJvHksphj.json` now sends `execution_mode` in `/distill/run` HTTP body.
- Updated Telegram status formatting:
  - `format-distill-run-message` now renders execution mode and top failure-code counts.
  - `format-status-message` now renders aggregated top failure codes from status metadata.
- Added/updated tests:
  - `test/server/n8n.command-parser.test.js` (new)
  - `test/server/n8n.format-distill-run-message.test.js`
  - `test/server/n8n.format-status-message.test.js`
  - `test/server/tier2.enrichment.test.js`

## 2026-03-09 — Batch currentness mismatch now clears queued status

### What changed
- Updated `src/server/tier2-enrichment.js`:
  - terminal batch `currentness_mismatch` now triggers a failure persistence write to avoid rows remaining `queued`.
  - this cleanup is skipped when `preserved_current_artifact = true`.
- Added runner tests in `test/server/tier2.enrichment.test.js` for:
  - cleanup persistence on terminal currentness mismatch
  - skip cleanup when preserved-current marker is set.
- Updated `docs/requirements.md` and `docs/api.md` with this batch-mode status-clearing rule.

## 2026-03-09 — Status summary now shows preserved-current aggregate

### What changed
- Updated `src/n8n/nodes/10-read/format-status-message__075f1d02-d3af-43dc-a694-f387f757ba3d.js`:
  - status summary now aggregates `metadata.preserved_current_count` across jobs
  - message includes `Preserved current: N` in results when non-zero.
- Added formatter coverage in `test/server/n8n.format-status-message.test.js`.

## 2026-03-09 — Tier-2 run/status now preserve current-artifact failure details

### What changed
- Updated `src/server/tier2-enrichment.js`:
  - run-level responses now include `preserved_current_count`
  - failed result rows now carry `preserved_current_artifact` and `message` when present
  - status item rows (`/status/batch/:batch_id?stage=t2&include_items=true`) now retain:
    - `error_code`
    - `message`
    - `preserved_current_artifact`
  - status metadata now includes `preserved_current_count`
- Updated `src/n8n/nodes/10-read/format-distill-run-message__b9f00fcd-a5ed-462f-a8d0-3e49c20eca11.js`:
  - preserved-current line now reads from `preserved_current_count` (fallback to counting `results[]`).
- Added/updated tests:
  - `test/server/tier2.enrichment.test.js`
  - `test/server/tier2.status.test.js`
  - `test/server/tier2.api-contract.test.js`
  - `test/server/n8n.format-distill-run-message.test.js`
- Updated `docs/api.md` to document:
  - `/distill/run` `preserved_current_count`
  - optional failed-result fields (`message`, `preserved_current_artifact`)
  - optional stage=t2 item detail fields on status endpoints.

## 2026-03-09 — Distill run Telegram message now shows preserved-current count

### What changed
- Updated `src/n8n/nodes/10-read/format-distill-run-message__b9f00fcd-a5ed-462f-a8d0-3e49c20eca11.js`:
  - for run mode, message now includes `Preserved current: N` when failed results include `preserved_current_artifact=true`.
- Added formatter coverage in `test/server/n8n.format-distill-run-message.test.js`.

## 2026-03-09 — Tier-2 run results now propagate preserved-current failure marker

### What changed
- Updated `src/server/tier2-enrichment.js` result shaping to preserve
  `preserved_current_artifact` on failed per-entry run results.
- Added runner-level coverage in `test/server/tier2.enrichment.test.js`.
- Added HTTP contract coverage for `/distill/run` failed result passthrough in `test/server/tier2.api-contract.test.js`.
- Updated `docs/api.md` run response example to include optional `message` and `preserved_current_artifact` on failed results.

## 2026-03-09 — Tier-2 retry hardening for deterministic failures

### What changed
- Updated `src/server/tier2-enrichment.js` retry config resolution:
  - always treats deterministic failures as non-retryable, regardless of runtime retry config.
  - includes all `DISTILL_VALIDATION_ERROR_CODES` plus `currentness_mismatch` and deterministic gating codes.
- Added/expanded tests in `test/server/tier2.enrichment.test.js`:
  - validates deterministic codes are in resolved non-retryable set
  - ensures `excerpt_not_grounded` is not retried even with permissive retry config.
- Updated `docs/requirements.md` to codify deterministic non-retryable behavior.

## 2026-03-09 — Added /distill sync success HTTP contract coverage

### What changed
- Added `test/server/tier2.api-contract.test.js` coverage for successful `POST /distill/sync` responses:
  - verifies presence of `summary`, `why_it_matters`, `stance`, and optional `excerpt`.

## 2026-03-09 — Distill failure Telegram message now shows preserved-current flag

### What changed
- Updated `src/n8n/nodes/10-read/format-distill-message__ef76e14a-f96e-4cb2-90da-c1b8f6fd2fca.js` failure rendering:
  - includes `Current artifact preserved: true` when `preserved_current_artifact` is returned by backend.
- Added formatter coverage in `test/server/n8n.format-distill-message.test.js`.

## 2026-03-09 — Distill sync Telegram success message now includes why-it-matters and excerpt

### What changed
- Updated `src/n8n/nodes/10-read/format-distill-message__ef76e14a-f96e-4cb2-90da-c1b8f6fd2fca.js`:
  - completed `/distill` responses now render:
    - `Summary`
    - `Why it matters`
    - optional `Excerpt` (only when present/non-empty)
- Added formatter tests in `test/server/n8n.format-distill-message.test.js`.

## 2026-03-09 — Fix Tier-2 sync currentness guard for null/empty source hashes

### What changed
- Fixed `persistTier2SyncSuccess(...)` currentness guard in `src/server/db.js`:
  - expected source hash now normalizes empty/whitespace values to `NULL` before guard comparison.
  - prevents false `currentness_mismatch` responses when rows have `content_hash IS NULL`.
- Added Tier‑2 service regression coverage in `test/server/tier2.service.test.js` for null-`content_hash` sync success path.

## 2026-03-09 — Tier-2 sync failure no longer downgrades current completed artifacts

### What changed
- Updated `src/server/tier2/service.js` failure handling:
  - generation/validation failures now preserve an existing current completed artifact
    (`distill_status=completed` + matching `distill_created_from_hash`)
  - in that path, failure response includes `preserved_current_artifact: true`
  - no `failed` status write is persisted for preserved-current rows
- Added service tests in `test/server/tier2.service.test.js` for:
  - generation failure with preserved current artifact
  - validation failure with preserved current artifact
- Added HTTP contract coverage for `preserved_current_artifact` passthrough in `test/server/tier2.api-contract.test.js`.
- Updated `docs/api.md` and `docs/requirements.md` to document this preservation behavior.

## 2026-03-09 — Tier-2 batch dispatch now marks selected entries queued

### What changed
- Tier‑2 batch runner now marks dispatched selected entries as queued before sync execution:
  - added `t2.batch.mark_queued` transition step in `src/server/tier2-enrichment.js`
  - uses new DB helper `persistTier2QueuedStatusByIds(...)` in `src/server/db.js`
- Extended DB status persistence validation to allow `queued` in `persistTier2EligibilityStatusByIds(...)` and added queued convenience wrapper.
- Added/updated Tier‑2 runner tests in `test/server/tier2.enrichment.test.js` to verify:
  - queued marking occurs for run mode
  - dry-run does not mark queued
  - queued marking respects `max_sync_items` cutoff
- Added SQL-builder coverage for queued status persistence in `test/server/tier2.plan-sql.test.js`.
- Updated `docs/api.md` and `docs/requirements.md` to document queued-on-dispatch behavior for `POST /distill/run`.

## 2026-03-09 — Read workflow status formatter externalized + dry-run planned count

### What changed
- Externalized Read workflow `Format Status Message` Code node to:
  - `src/n8n/nodes/10-read/format-status-message__075f1d02-d3af-43dc-a694-f387f757ba3d.js`
- Updated workflow wrapper in:
  - `src/n8n/workflows/10-read__dq9Nex-IR8AToJvHksphj.json`
- Status formatter now includes an extra line when Tier‑2 dry-run jobs are present:
  - `Would process (dry_run): <sum(metadata.will_process_count)>`
- Added formatter tests in:
  - `test/server/n8n.format-status-message.test.js`

## 2026-03-09 — Tier-2 currentness guard on final sync write

### What changed
- Added a currentness guard to Tier‑2 final persistence (`src/server/db.js`):
  - sync success writes now require both `entry_id` and matching `content_hash` (`distill_created_from_hash`) at update time.
- Updated Tier‑2 sync service (`src/server/tier2/service.js`) to handle no-op guarded writes as:
  - `status = "failed"`
  - `error_code = "currentness_mismatch"`
  - message indicating source content changed during distillation
  - no fallback failure overwrite is applied in this path.
- Added service-level test coverage for currentness mismatch in `test/server/tier2.service.test.js`.
- Added `/distill/sync` HTTP contract coverage for `currentness_mismatch` passthrough in `test/server/tier2.api-contract.test.js`.
- Updated `docs/api.md` and `docs/requirements.md` to document the guarded write behavior.

## 2026-03-09 — Tier-2 sync service execution-path coverage

### What changed
- Added focused Jest coverage for `src/server/tier2/service.js` in `test/server/tier2.service.test.js`:
  - direct-route successful sync persistence
  - chunked-route generation flow (chunk notes + final synthesis)
  - validation-failure persistence path (`excerpt_not_grounded`)
  - generation-failure persistence path (`generation_error`)
- Validated model-selection wiring per request type (`sync_direct`, `chunk_note`, `synthesis`) and failure metadata persistence fields (`error`, `retry_count`, `chunking_strategy`).

## 2026-03-09 — Tier-2 dry-run status counts clarification

### What changed
- Updated Tier‑2 batch status recording so dry-run batches report:
  - `counts.pending = 0`
  - `metadata.will_process_count = <planned item count>`
- Added/updated test coverage in `test/server/tier2.status.test.js` for the dry-run status contract.
- Updated `docs/api.md` notes for `GET /status/batch/:batch_id` to document dry-run count semantics for `stage=t2`.

## 2026-03-09 — Read context-pack Tier-2 summary + why-it-matters integration

### What changed
- Updated shared context-pack content selection priority in `src/libs/context-pack-builder.js`:
  - now prefers `distill_summary` before `gist` / `retrieval_excerpt` / raw text fallbacks.
- Updated shared context-pack rendering to include `distill_why_it_matters` for top-ranked rows:
  - includes `why_it_matters` on roughly the first quarter of hit rows (25% target) when present.
- Extended read SQL projections (`/db/read/continue`, `/db/read/find`, `/db/read/last`, `/db/read/pull`) to include `distill_summary` in row payloads.
- Extended read SQL projections (`/db/read/continue`, `/db/read/find`, `/db/read/last`, `/db/read/pull`) to include `distill_why_it_matters` in row payloads.
- Added server-side tests for context-pack priority behavior:
  - `test/server/context-pack-builder.test.js`
  - includes UI + Telegram layout checks for top-ranked `why_it_matters` inclusion behavior
- Added server-side SQL projection tests for read endpoints:
  - `test/server/read-sql-distill-projection.test.js`
- Updated `docs/api.md` read section to document `distill_summary` / `distill_why_it_matters` hit-row fields.
- Updated requirements + PRD contracts to document summary-first retrieval and early-row `why_it_matters` inclusion.

## 2026-03-09 — Tier-2 boolean option parsing hardening

### What changed
- Hardened Tier‑2 option parsing for plan/run flows to accept boolean-like string values consistently:
  - `dry_run`
  - `persist_eligibility`
  - `include_details`
- Hardened batch status boolean parsing to treat unrecognized values as fallback defaults:
  - `include_terminal`
  - `include_items`
- Added tests covering string boolean behavior:
  - `test/server/tier2.enrichment.test.js`
  - `test/server/tier2.planner.test.js`
  - `test/server/batch-status-service.test.js`

## 2026-03-09 — Tier-2 run busy-response normalization

### What changed
- Normalized `/distill/run` busy-overlap response shape:
  - returns `mode = "skipped"` with `reason = "worker_busy"` and a user-facing `message`.
- Normalized `/distill/run` runtime-error response shape:
  - returns structured run payload with `error` and `failed_count = 1`
  - persists a failed run record with `batch_id` so `/status/batch` can still inspect the failure.
- Tier‑2 status records now include `metadata.error` for failed run-level errors.
- Updated `Format Distill Run Message` node logic to render a dedicated Telegram message for worker-busy skips.
- Updated `Format Distill Run Message` node logic to render run-level error payloads clearly.
- Updated `Format Distill Run Message` node output to include `batch_id` on non-skipped runs for easier `/status` follow-up.
- Updated `docs/api.md` to document the worker-busy response variant for `POST /distill/run`.
- Updated `docs/api.md` to clarify that non-busy `/distill/run` responses include `batch_id` for status lookup.
- Updated `docs/api.md` with normalized runtime-failure response shape for `POST /distill/run`.
- Updated `docs/requirements.md` to codify normalized Tier‑2 run-failure payloads and `metadata.error` status behavior.
- Updated `docs/api.md` to document `metadata.error` availability on failed `stage=t2` status rows.
- Added backend test coverage for worker-busy response contract in `test/server/tier2.enrichment.test.js`.
- Expanded backend test coverage for runtime-error response normalization in `test/server/tier2.enrichment.test.js` (run + dry-run modes).
- Added HTTP contract tests for Tier‑2 endpoints in `test/server/tier2.api-contract.test.js`:
  - `/distill/run` busy payload
  - `/distill/run` admin-secret enforcement
  - `/status/batch?stage=t2` query forwarding
  - `/status/batch/:batch_id?stage=t2` query forwarding + not-found behavior
  - `/distill/run` string-boolean option handling end-to-end
  - `/distill/run` normalized runtime-failure payload
  - `/distill/run` run-id response header propagation (`X-PKM-Run-Id`)
  - `/distill/plan` admin-secret enforcement + request forwarding
  - `/distill/sync` failed response `message` passthrough
  - `/distill/sync` admin-secret enforcement + input validation + 404 mapping

## 2026-03-09 — Tier-2 batch retry policy + LLM metadata enrichment

### What changed
- Tier‑2 batch execution (`POST /distill/run`) now applies config-driven retry decisions for per-entry failures:
  - reads retry settings from `distill.retry.*`
  - evaluates retryable/non-retryable error codes and max attempts
  - retries only when policy allows; otherwise marks terminal failure for the entry
- Tier‑2 sync service now accepts optional retry context from the batch runner and persists `distill_metadata.retry_count` for both success and failure writes.
- Added lightweight Tier‑2 retry transition logging steps in pipeline events:
  - `t2.batch.retry.evaluate`
  - `t2.batch.retry.dispatch`
- Enriched Tier‑2 LiteLLM telemetry metadata by forwarding distillation context (stage/route/substage/entry/chunk metadata) into `litellm-client` logs.
- Expanded Tier‑2 batch runner tests to cover:
  - retryable failure -> retry -> success
  - non-retryable failure -> no retry
  - max-attempts stop condition

## 2026-03-09 — Read workflow status command wiring (n8n)

### What changed
- Updated `src/n8n/nodes/10-read/command-parser__926eb875-5735-4746-a0a4-7801b8db586f.js`:
  - fixed `/status` parsing so it no longer falls through to query-required command handling
  - added optional stage argument: `/status [t1|t2]`
  - added optional flags: `--limit M`, `--active-only`
  - added `/distill <entry_id>` command parsing for Tier‑2 sync trigger
  - added `/distill-run` parsing (supports `--dry-run`, `--candidate-limit`, `--max-sync-items`, `--no-persist-eligibility`)
- Updated Read workflow status request node:
  - switched from `GET /status/t1/batch` to generic `GET /status/batch`
  - request now passes stage/limit/include-terminal from parsed command fields
- Added Tier‑2 sync branch in Read workflow:
  - `PKM Distill Sync` HTTP node calls `POST /distill/sync` (admin header required)
  - `Format Distill Message` node returns success/failure Telegram output
- Added Tier‑2 run branch in Read workflow:
  - `PKM Distill Run` HTTP node calls `POST /distill/run` (admin header required)
  - `Format Distill Run Message` node returns run/dry-run summary in Telegram output
- Updated status message label from `T1 Batch summary` to generic `Batch summary`.
- Fixed Tier‑2 telegram formatter rendering:
  - moved distill formatter code nodes to externalized files under `src/n8n/nodes/10-read/`
  - replaced broken inline escaped JS strings with thin wrapper imports in workflow JSON
- Improved `/distill/sync` failure response payload with `message` for generation failures (in addition to `error_code`).

## 2026-03-08 — Tier-2 foundation: sync distillation endpoint + control-plane utilities

### What changed
- Added Tier‑2 backend modules under `src/server/tier2/`:
  - control-plane eligibility/scoring/budget/route utilities
  - deterministic chunking
  - prompt builders
  - parsing + validation contract helpers
  - sync distillation service
- Added Tier‑2 sync API endpoint:
  - `POST /distill/sync` (admin-protected)
- Added Tier‑2 control-plane planning API endpoint:
  - `POST /distill/plan` (admin-protected)
- Added Tier‑2 batch-run API endpoint:
  - `POST /distill/run` (admin-protected)
- Extended DB/API runtime support for Tier‑2 fields:
  - added Tier‑2 columns to backend insert/update type map
  - added DB helpers for Tier‑2 candidate/detail reads, schema override routing, eligibility persistence, and sync persistence
  - added Tier‑2 SQL builders in `src/libs/sql-builder.js` for candidate selection and eligibility state writes
- Added optional Tier‑2 background batch worker controls (`T2_BATCH_WORKER_*`) and worker lifecycle wiring in backend startup/shutdown.
- Extracted shared worker loop runtime in backend and migrated both Tier‑1 and Tier‑2 workers to use it (common timer, busy-guard, and error handling behavior).
- Refactored batch status API to be stage-generic:
  - new canonical endpoints:
    - `GET /status/batch?stage=t1|t2`
    - `GET /status/batch/:batch_id?stage=t1|t2`
  - legacy Tier‑1 aliases remain available:
    - `GET /status/t1/batch`
    - `GET /status/t1/batch/:batch_id`
  - n8n migration note: switch status reads to `/status/batch` and pass explicit `stage` query param.
- Internal backend refactor:
  - added stage registry + batch status service modules
  - moved stage routing logic out of `index.js` handlers
  - no API contract change from the previous generic status endpoint rollout
- Added Tier‑2 stale-detection maintenance cycle in backend startup:
  - marks `distill_status = stale` for outdated completed artifacts in `pkm.entries`
  - controlled by `T2_STALE_MARK_ENABLED` and `T2_STALE_MARK_INTERVAL_MS`
- Expanded shared config with `distill.*` keys and Tier‑2 model/retry settings.
- Added Jest coverage for Tier‑2 control-plane, chunking, and validation modules.
- Updated docs:
  - `docs/api.md`
  - `docs/database_schema.md`
  - `docs/env.md`
  - `docs/requirements.md`

## 2026-03-06 — Script sunset + Git->n8n operator doc

### What changed
- Archived obsolete n8n scripts to `scripts/archive/n8n/`:
  - `activate_workflows.sh`
  - `import_workflows.sh`
  - `repair_legacy_bridges.py`
- Updated `docs/n8n_sync.md`:
  - integrated operator-focused Git->n8n runbook sections
  - updated active vs archived script lists

## 2026-03-06 — Bridge dependency cutover (safe remove path)

### What changed
- Removed bridge creation from sync flow:
  - `scripts/n8n/sync_code_nodes.py` no longer emits legacy bridge files in `js/workflows`.
- Hardened push validation:
  - `scripts/n8n/sync_nodes.py` now forbids legacy wrapper paths (`/data/js/workflows/...`) by default.
- Added repo/live validation in orchestrator:
  - `scripts/n8n/sync_workflows.sh` now validates:
    - repo workflows contain no legacy wrapper paths
    - canonical wrapper targets exist
    - live n8n workflows (post-push) contain no legacy wrapper paths
- Added safe cutover orchestration:
  - `scripts/n8n/cutover_remove_bridges.sh`
    - runs existing backup script (`scripts/db/backup.sh`)
    - snapshots live workflows before cutover
    - runs full sync + recreate
    - removes local legacy bridge files
    - validates no legacy wrapper references remain
- Added local bridge cleanup helper:
  - `scripts/n8n/remove_legacy_bridges.py`
- Updated docs:
  - `docs/n8n_sync.md`

## 2026-03-06 — Canonical n8n paths under src/n8n with legacy bridge compatibility

### What changed
- Migrated canonical n8n assets to:
  - `src/n8n/workflows` (workflow JSON)
  - `src/n8n/nodes` (externalized code nodes)
- Updated workflow wrapper paths to canonical mount path:
  - `/data/src/n8n/nodes/...`
- Kept legacy compatibility paths under `js/workflows` for existing/stale wrappers.
- Updated sync scripts defaults and behavior:
  - `scripts/n8n/export_workflows.sh` now defaults to `src/n8n/workflows`
  - `scripts/n8n/normalize_workflows.sh` and `rename_workflows_by_name.sh` default to `src/n8n/workflows`
  - `scripts/n8n/sync_workflows.sh` now syncs canonical `src/n8n/*` paths and keeps legacy root for bridges
  - `scripts/n8n/sync_code_nodes.py` now writes canonical nodes to `src/n8n/nodes`, emits canonical wrappers, and can read legacy wrapper sources from `js/workflows`
  - `scripts/n8n/sync_nodes.py` now defaults to canonical `src/n8n/*` paths with optional legacy wrapper validation root
- Updated docs:
  - `docs/n8n_sync.md`
- Consolidated to a single entrypoint script:
  - kept `scripts/n8n/sync_workflows.sh`
  - removed `scripts/n8n/sync_nodes.sh`
  - added `--mode pull|push|full` to `sync_workflows.sh`

## 2026-03-05 — n8n in-place node sync via API patch

### What changed
- Added `scripts/n8n/sync_nodes.sh` + `scripts/n8n/sync_nodes.py`.
- New flow patches existing workflows by name using n8n API (`PATCH /api/v1/workflows/:id`) instead of delete/import.
- Script preserves workflow IDs/history by default and restores active state for workflows that were active before patch.
- Added wrapper-target validation before patching:
  - if a code wrapper points to `/data/js/workflows/...` and target file is missing in repo, sync aborts early.
- Supports targeted patching:
  - `./scripts/n8n/sync_nodes.sh --workflow-name "<name>"`
- Updated docs:
  - `docs/n8n_sync.md`

## 2026-03-01 — n8n workflow sync orchestration under scripts/n8n

### What changed
- Added canonical one-command sync flow:
  - `./scripts/n8n/sync_workflows.sh`
  - optional `--commit` to commit `workflows/` + `js/workflows/`
- Added `scripts/n8n/` workflow-management scripts:
  - `export_workflows.sh`
  - `normalize_workflows.sh`
  - `rename_workflows_by_name.sh`
  - `import_workflows.sh`
  - `activate_workflows.sh`
  - `sync_code_nodes.py`
  - `sync_workflows.sh`
- Updated node sync behavior:
  - externalize only Code nodes with `>= 50` non-empty JS lines (`MIN_JS_LINES` override)
  - keep short Code nodes inline
  - move JS files to correct workflow folders when nodes moved
  - update wrapper paths to `/data/js/workflows/...`
  - remove orphan files from `js/workflows/` after processing all workflows
- Added compose guard in orchestrator:
  - script stops if n8n mount `/home/igasovic/repos/n8n-workflows:/data:ro` is not present in `docker-compose.yml`
- Removed top-level wrapper scripts:
  - `scripts/export_workflows.sh`
  - `scripts/normalize_workflows.sh`
  - `scripts/rename_workflows_by_name.sh`
- Made workflow activation mandatory in orchestrator after n8n restart and before optional commit.
- Added optional targeted recreate mode for problematic workflows:
  - `./scripts/n8n/sync_workflows.sh --recreate-workflow "<workflow name>"`
  - deletes matched live workflow by name before import (history-loss expected for that workflow)
  - default behavior remains overwrite import (no deletes)
- Updated docs:
  - merged `docs/n8n_to_git.md` + `docs/git_to_n8n.md` into `docs/n8n_sync.md`

## 2026-02-24 — Notion collector client + normalize/notion input expansion

### What changed
- Added `src/server/notion-client.js`:
  - fetches Notion page + paginated block tree
  - recursively collects children (including synced block source references)
  - renders collected blocks into `capture_text`
  - returns collector stats/errors for logging
- Wired Notion collector into `runNotionIngestionPipeline`:
  - backend now always collects Notion blocks/content by `id` before normalization
- Expanded `POST /normalize/notion` input handling:
  - uses top-level `id`/`page_id` as canonical input (no required `notion{}` block)
  - uses `capture_text` as the only body-text override field
  - always fetches Notion blocks for the page id in collector path
- Notion client now derives metadata without n8n-supplied fields:
  - resolves `page_url` from Notion API/page id
  - resolves `database_id` from page parent, or fallback config (`NOTION_DATABASE_ID` / `NOTION_DATABASE_URL`)
- Updated docs:
  - `docs/api.md`
  - `docs/requirements.md`
  - `docs/env.md` (Notion env vars)

## 2026-02-24 — Notion normalization + idempotency wiring

### What changed
- Added Notion normalization API endpoint:
  - `POST /normalize/notion`
- Added Notion ingest orchestration path in backend:
  - `runNotionIngestionPipeline` in `src/server/ingestion-pipeline.js`
  - Notion order is `normalize -> idempotency -> quality`
- Added Notion idempotency support in `src/server/idempotency.js`:
  - `notion_note_v1`
  - `notion_newsletter_v1`
  - `notion_correspondence_v1`
  - `notion_other_v1`
  - primary key uses `notion:{page_id}`
  - optional secondary key uses `sha256(created_at + title)` when `created_at` is provided
- Added Notion normalization behavior in `src/server/normalization.js`:
  - strict `content_type` validation (`note|newsletter|correspondence|other`)
  - `updated_at` required
  - Notion block rendering support for allowed block types
  - unsupported block types now cause non-fatal item skip with `skipped=true` + `skip_errors[]`
- Hardened DB insert/update idempotency requirement list:
  - `source=notion` now fail-closed if idempotency fields are missing
- Updated docs:
  - `docs/api.md`
  - `docs/requirements.md`

## 2026-02-23 — Test mode UI control + backend toggle export fix

### What changed
- Added test mode control to Mac UI left sidebar (`src/web/pkm-debug-ui`):
  - reads state via `GET /db/test-mode`
  - toggles state via `POST /db/test-mode/toggle`
  - visual state: green when ON, gray when OFF
  - positioned at the bottom of the sidebar menu with independent menu scrolling
- Fixed backend toggle wiring bug:
  - exported `toggleTestModeStateInDb` from `src/server/db.js` so `TestModeService.toggle()` works correctly

## 2026-02-23 — Read keywords + context pack format alignment

### What changed
- Updated read SQL outputs to include `keywords` in all three read methods:
  - `POST /db/read/continue`
  - `POST /db/read/find`
  - `POST /db/read/last`
- Fixed SQL regressions introduced during read-shape changes:
  - removed duplicate `keywords` select in `continue` path
  - added missing `keywords` select in `find` hits CTE
- Centralized context-pack rendering in `src/libs/context-pack-builder.js` and aligned output contracts:
  - context-pack generation now skips `is_meta=true` rows
  - UI uses compact markdown layout:
    - `## Context Pack`
    - `retrieval: ...`
    - per-entry block with topic, keywords, url, content
  - `run_id` removed from context-pack body
- Updated docs:
  - `docs/requirements.md` (new fixed UI context-pack template + read keywords requirement)

## 2026-02-22 — Debug runs listing API + UI requirement updates

### What changed
- Added new admin debug endpoint:
  - `GET /debug/runs`
- Added backend run-summary query path for `pipeline_events`:
  - SQL builder: `buildGetRecentPipelineRuns`
  - DB method: `getRecentPipelineRuns`
- `GET /debug/runs` supports:
  - `limit` (default `50`, max `200`)
  - `before_ts` pagination cutoff
  - `has_error` filtering (`true|false`)
- Updated docs:
  - `docs/api.md` with `/debug/runs` contract and examples
  - `docs/requirements.md` with full Mac Debug UI requirements and `/debug/runs` usage
- Updated Mac debug UI to consume recent runs:
  - added `/debug/runs` client support and recent-runs panel with quick-load actions

## 2026-02-21 — Pipeline transition logging + run correlation

### What changed
- Added backend logger subsystem under `src/server/logger/` with two sinks:
  - Postgres sink for pipeline transition events (`pipeline_events`)
  - Braintrust sink for LLM-oriented spans/metadata
- Added AsyncLocalStorage run context propagation:
  - request-scoped `run_id` + `request_id`
  - accepts `X-PKM-Run-Id` header
  - accepts body `run_id` when header is absent
  - response now includes `X-PKM-Run-Id`
- Added step-level transition logging wrappers in key orchestration paths:
  - normalization/ingestion pipeline
  - email importer flow
  - Tier-1 enrichment facade
  - LangGraph node wrappers
- Added Postgres DB plumbing for pipeline events:
  - SQL builders in `src/libs/sql-builder.js`
  - DB methods in `src/server/db.js`:
    - `insertPipelineEvent`
    - `getPipelineRun`
    - `prunePipelineEvents`
- Added admin debug endpoint:
  - `GET /debug/run/:run_id`
- Added daily retention prune in server startup:
  - `PKM_PIPELINE_EVENTS_RETENTION_DAYS` (default `30`)
- Added `run_id` metadata propagation to observability + LiteLLM logs for Braintrust correlation.
- Updated docs:
  - `docs/api.md`
  - `docs/requirements.md`
  - `docs/database_schema.md`
  - `AGENTS.md` (DB safety rule: no raw SQL outside sql-builder/db modules)

## 2026-02-16 — Tier-1 LangGraph orchestration refactor

### What changed
- Added LangGraph dependencies to backend server package (`@langchain/langgraph`, `@langchain/core`).
- Refactored Tier‑1 orchestration into reusable modules under `src/server/tier1/`:
  - shared domain logic (`prompt`, parse, batch result mapping)
  - shared batch persistence/store helpers
  - LangGraph graph definitions and execution wrappers
- Implemented three LangGraph flows with explicit node stages `load -> prompt -> llm -> parse -> write`:
  - sync enrichment
  - batch schedule
  - batch collect
- Kept external API contracts unchanged for:
  - `POST /enrich/t1`
  - `POST /enrich/t1/batch`
  - worker-driven batch collection behavior
- Updated `src/server/tier1-enrichment.js` to a thin facade over LangGraph execution, preserving exported function names used by API handlers/importers.
- Refactored `src/server/litellm-client.js` instrumentation to provide consistent structured logging for all LiteLLM operations:
  - chat completions attempts and resolved call
  - files upload
  - batch creation
  - batch retrieval
  - file content fetch
- Constrained non-LLM orchestration logging to error-only node logs.
- Added Tier‑1 batch visibility APIs:
  - `GET /status/t1/batch`
  - `GET /status/t1/batch/:batch_id`
- Added backend status aggregation for Tier‑1 jobs (counts for `total_items`, `processed`, `pending`, `ok`, `parse_error`, `error`) with optional per-item status listing.
- Status scanning supports both `pkm` and `pkm_test` schemas independently of current test mode.
- Added admin-only DB mutation APIs:
  - `POST /db/delete`
  - `POST /db/move`
- Added strict selector/schema validation for delete/move at the backend DB boundary (no implicit schema or direction).
- Added n8n read command parser support for `/delete` and `/move`.

## 2026-02-11 — Config-driven read defaults

### What changed
- Read queries now take weights, half-life, and note quota directly from config instead of request payloads.
- `/db/read/*` now defaults `days` and `limit` from config when omitted or `0`.
- `/db/read/find` now derives `needle` from `q` internally.
- Updated API docs for read endpoints.
- Persisted test mode in Postgres (`pkm.runtime_config`) and wired config to read it.
- Insert/update/read now respect persisted test mode when choosing the schema.
- Added `/db/test-mode` and `/db/test-mode/toggle` endpoints.
- `/db/*` endpoints now return only `rows` from SQL (no ok/rowCount wrapper).
- Added cached test mode reads (10s TTL) to reduce runtime_config lookups.
- Added Telegram normalization API and extracted quality signals into `src/server/quality.js`.
- Added unified email normalization endpoint (`/normalize/email`) using raw IMAP text/plain input.
- Added email intent detection endpoint (`/normalize/email/intent`) returning `content_type`.
- Added Tier‑1 enrichment endpoint (`/enrich/t1`) backed by OpenAI.
- Added restart-safe Tier‑1 batch enqueue API (`/enrich/t1/batch`) with Postgres persistence and backend-owned OpenAI re-sync worker.
- Added normalization-side idempotency key output for Telegram/Email using structured `source` payloads.
- Added policy-driven idempotent `/db/insert` handling with conflict actions `skip`/`update` and result actions `inserted|skipped|updated`.
- Added recursive JSON metadata merge behavior for idempotent `update` conflicts.
- Hardened ingest to fail closed: normalization throws if idempotency keys cannot be derived, and `/db/insert` rejects `email`/`telegram` rows without idempotency fields.
- Normalize APIs now infer source system by endpoint (`/normalize/email` vs `/normalize/telegram`), so callers do not need to pass `source.system`.
- `/normalize/email` no longer expects input `participants`; correspondence idempotency no longer uses participants in key evaluation.
- `/normalize/telegram` no longer expects input `url`; URL is extracted and canonicalized from message text during normalization.
- `/normalize/email` now treats top-level `from` and `subject` as the canonical inputs for those fields (no fallback from `source.from_addr`/`source.subject`).
- Normalization no longer derives/stores correspondence participants (`people`) as part of email normalization output.
- Renamed entry idempotency policy column from `idempotency_policy_id` to `idempotency_policy_key` across backend logic and documentation.
- Fixed schema resolution drift in reads: `/db/read/last` and `/db/read/pull` now honor persisted test mode just like other DB methods.
- Moved test mode caching/logic into `src/server/test-mode.js` and removed it from config.
- `/config` now returns only static config (no test mode state).
- Moved shared libs to `src/libs` and updated server Dockerfile copy path.
- Added `POST /normalize/webpage` for one-call webpage text cleaning plus retrieval/quality recomputation.
- Consolidated retrieval excerpt + quality signal recompute flows behind `buildRetrievalForDb` in `src/server/quality.js` and reused it in normalization paths.
- Added `POST /import/email/mbox` for WP4 backlog ingest from `.mbox` files: normalize sync, idempotent insert, duplicate filtering (`skipped`), and Tier‑1 batch enqueue.
- Added backend `email-importer` module with `.mbox` parsing, MIME plain-text extraction, and per-entry failure isolation.
- Expanded `/db/insert` and `/db/update` to support batch payloads via `items` with optional `continue_on_error`.
- Enforced idempotency fail-closed behavior for `source = email-batch` in insert path.
- Optimized DB batch operations by reusing resolved test-mode config across per-item execution.
- Switched Tier‑1 LLM client from OpenAI Responses routing to LiteLLM chat-completions routing.
- Renamed `src/server/openai-client.js` to `src/server/litellm-client.js` and updated enrichment imports/usages.
- LLM auth is now strict `LITELLM_MASTER_KEY` (no `OPENAI_API_KEY` fallback).

## 2026-02-10 — Backend config module + API endpoint

### What changed
- Added a shared retrieval config module in `js/workflows/pkm-retrieval-config/config_v1.js`.
- Added `src/libs/config.js` so backend code can read config via a single import.
- Added `GET /config` endpoint to return the config as JSON.
- Updated API docs for the new config endpoint.

## 2026-02-08 — SQL builders, prompt builders, and Pi-ready server

### What changed
- Centralized SQL `INSERT` and `UPDATE` construction in `js/libs/sql-builder.js` and refactored workflow builders to use them.
- Added snapshot-style tests for SQL insert/update/read builders in `test/`.
- Added `js/libs/prompt-builder.js` and refactored Tier‑1 prompt creation nodes (sample + whole) to use it.
- Added a minimal Node.js backend in `src/server/` with a Pi-friendly Dockerfile, plus basic server tests.
- Added Braintrust observability hooks for server errors (config via env).
- Enforced Braintrust initialization at startup (service fails fast if missing config or init fails).
- Added Postgres DB module + HTTP endpoints for insert/update/read (last/find/continue/pull) with Braintrust tracing.
- Added `/docs/api.md` describing the backend API for external systems.
- Updated server Dockerfile to copy project sources instead of individual files.
- Updated server image build to include `js/libs/sql-builder.js` from the repo without duplicating files (requires repo-root build context).
- Replaced Telegram-specific insert mapping with a generic insert that accepts any `pkm.entries` columns and sanitizes server-side.
- Added support for client-specified `RETURNING` columns on `/db/insert` requests.
- API responses now flatten the first row into the top-level JSON (no `rows` or `data` wrapper).
- Added generic `/db/update` input handling with server-side validation/sanitization and optional `returning`.
- Added JSONB validation for `metadata`/`external_ref` inputs (accept objects or valid JSON strings).

## 2026-02-01 — Tier‑1 enrichment subworkflow + Telegram message enrichment

### What changed
- Extracted the Tier‑1 newsletter enrichment chain out of `e-mail-capture` into a dedicated subworkflow: `workflows/tier-1-enhancement__WFB4SDkDPDPIphppIn3l7.json`.
- Updated both `e-mail-capture` and `telegram-capture` workflows to call **Tier‑1 Enhancement** (Execute Workflow) on the newsletter path instead of duplicating nodes.
- Externalized Tier‑1 JS modules into `js/workflows/tier-1-enhancement/` and updated subworkflow Code-node wrappers to load them from the new path.
- Ensured callers keep using the config subworkflow named exactly **PKM Config**.

### Fixes / gotchas discovered
- n8n can keep running “old” external JS after file updates; a container restart (`docker compose restart n8n`) resolved mismatches between repo code and executed SQL.
- Telegram Capture: updated the runtime message builder (`js/workflows/telegram-capture/05_create-message__e7474a77-f17b-4f8f-bbe1-632804bd2e69.js`) to include `gist`, topic path (`topic_primary → topic_secondary`), and to compute message length from `clean_text`.
- Cleaned up Git sync between Mac ↔ Pi (avoid committing `versionCounter`-only workflow diffs; reset Pi to `origin/main` when needed).


## 2026-01-30 — Pi SD → SSD migration (with SD rollback)

### What we achieved
- Migrated Raspberry Pi OS + full Docker stack from SD card (`mmcblk0`) to SSD (`/dev/sda`) while keeping the SD card untouched for rollback.
- Verified services on SSD: Postgres, n8n, Home Assistant, cloudflared.
- Verified n8n external JS mount works inside container (`/data/js/workflows`).
- Verified Cloudflare tunnel routes to n8n and HA.

### Backups (stored on Mac)
- Postgres logical dump: `postgres_dumpall.sql.gz` (covers `n8n` + `pkm`, including n8n credentials such as Telegram).
- Filesystem bundle: `pi_backup_bundle.tgz` (stack, repo, SSH keys).

Mac copy commands used:
- `scp igasovic@192.168.5.4:/home/igasovic/backup/postgres_dumpall.sql.gz ~/pi-ssd-migration/backup/`
- `scp igasovic@192.168.5.4:/home/igasovic/backup/pi_backup_bundle.tgz    ~/pi-ssd-migration/backup/`

### Migration summary
- Identified disks:
  - SD: `mmcblk0` (boot: `mmcblk0p1`, root: `mmcblk0p2`)
  - SSD: `sda` (CT240BX500SSD1)
- Cloned SD → SSD:
  - SSD partitions created:
    - `/dev/sda1` (FAT32 boot)
    - `/dev/sda2` (EXT4 root)
  - Copied root and boot partitions to SSD.
  - Boot-tested with SD removed.
- Fixed post-boot issues on SSD:
  - Root initially mounted read-only (`ro`) and `/etc/fstab` was empty.
  - Remounted root RW.
  - Mounted `/dev/sda1` at `/boot/firmware`.
  - Rebuilt `/etc/fstab` using SSD PARTUUIDs and verified persistence after reboot.

SSD PARTUUIDs used:
- `/dev/sda1` PARTUUID: `22c916e3-aea2-4920-9080-ba0e5f51412d`
- `/dev/sda2` PARTUUID: `7cc91410-0a0e-43c7-a27b-f739c21dec3f`

Final verification commands (passed):
- `findmnt / -o SOURCE,FSTYPE,OPTIONS` → `/dev/sda2` mounted `rw`
- `findmnt /boot/firmware -o SOURCE,FSTYPE,OPTIONS` → `/dev/sda1` mounted `rw`
- `docker compose ps` → all services `Up`
- Postgres DBs present: `n8n`, `pkm`
- n8n JS mount present: `/data/js/workflows/*`
- `https://n8n.gasovic.com` → `302` to Cloudflare Access login (expected)
- `https://ha.gasovic.com` → `405` for HEAD; use GET to validate
## 2026-01-31 — Matter support (Home Assistant Container)

### What was added
- Enabled Matter support for Home Assistant running as a Docker container (not HA OS).
- Added `matter-server` as a dedicated container (`python-matter-server`) to the Docker stack.
- Configured Matter Server to run with `network_mode: host` for reliable mDNS/Thread discovery on Raspberry Pi 4.
- Connected Home Assistant to Matter Server via WebSocket endpoint.

### Key configuration details
- Matter Server UI: `http://192.168.5.4:5580`
- Matter Server WebSocket: `ws://192.168.5.4:5580/ws`
- Home Assistant Matter integration configured to use the above WebSocket URL (not `localhost`).

### Operational notes
- Devices are paired via Home Assistant, not directly in the Matter Server UI.
- Matter Server acts as a backend service only.
- Eero 6 provides Thread Border Router functionality implicitly; it is not added to Home Assistant or Matter.
- Compatible with existing SSD-booted Pi and Docker-based stack.

## 2026-01-31 — PKM test mode & schema isolation

### What was added
- Introduced **schema-level test/production isolation** in Postgres:
  - Production: `pkm.entries`
  - Test: `pkm_test.entries`
- Added `PKM Config` sub-workflow as the **single source of truth** for runtime configuration.
- All workflows now invoke `PKM Config` at startup.
- All SQL and JS builders read configuration **exclusively** from `PKM Config` output.
- Implemented global **test mode** toggle (no parallel deployments required).
- Added visible **⚗️🧪 TEST MODE** banner to Telegram and email responses when active.

### Safety guarantees
- Test data is physically separated from production data.
- Test runs can be wiped safely using:
  ```sql
  TRUNCATE TABLE pkm_test.entries RESTART IDENTITY;
  ```
- No reliance on global mutable state (Data Tables, static data, env vars).

### Developer impact
- Builders fail fast if `PKM Config` is missing.
- Configuration flow is explicit, deterministic, and auditable.
# 2026-03-18

- n8n: added `scripts/n8n/recreate_stack.sh` as the canonical manual recreate path; it now rebuilds `pkm-n8n-runners` before recreating `n8n` and `task-runners`, and `sync_workflows.sh --mode push` delegates to the same helper.
- n8n: operator scripts now resolve `node` or `nodejs` automatically for runtime package builds, so Pi hosts without a `node` symlink still support `checkcfg n8n`, `updatecfg n8n`, and `scripts/n8n/recreate_stack.sh`.
- n8n: runtime package builds now fall back to a short-lived `node:22-bookworm-slim` Docker container when the host has no Node runtime installed, so Pi operators do not need host-level Node just to rebuild `pkm-n8n-runners`.
- ops: `scripts/redeploy` now supports `backend` and `n8n` targets and delegates to the canonical deploy helpers (`scripts/cfg/backend_push.sh` and `scripts/n8n/sync_workflows.sh --mode push`).
- tests: n8n calendar Jest suites now resolve inline/externalized nodes via stable workflow slugs and node stems instead of dead UUID-suffixed filenames, matching the migration’s stable import model.
- smoke: `00 Smoke - Master` record nodes now rebuild suite state from their `Build T*` inputs rather than relying on tested workflow payload pass-through; cleanup now recursively deletes all recoverable smoke entry ids and WF99 passes recovered smoke state into cleanup on failure.
- smoke: added `scripts/n8n/run_smoke.sh` as the operator helper to execute the smoke master on the Pi via documented `n8n execute --id <workflow-id>` CLI flow.
- n8n: added `scripts/n8n/validate_cutover.sh` to validate Pi cutover state end-to-end: image pins, running containers, proxy/runtime env, runners package resolution, CLI readiness, and optional smoke execution.
- tests/docs: added Jest coverage for the n8n operator helpers and clarified migration status wording so the PRD now distinguishes repo-side completion from the final live Pi validation step.
- n8n: added a targeted package-root export trial for `10 Read -> Command Parser`, preserving the existing folder tree while testing whether root-only allowlisting works around stricter n8n disallowed-module checks for deep package subpaths.
- n8n: added a targeted unscoped compatibility alias, `igasovic-n8n-blocks`, for workflow `10 Read` only; the folder tree and runtime subpaths remain unchanged while testing whether n8n accepts unscoped allowlisted packages where scoped packages are rejected as disallowed.
- n8n/docker: mounted repo-managed `ops/stack/n8n-runners/n8n-task-runners.json` into `n8n-runners` as `/etc/n8n-task-runners.json` so external-runner JS allowlists are enforced by launcher config, not only container env; `validate_cutover.sh` now checks the launcher config plus both scoped and unscoped package paths in the runners image.
- n8n: switched workflow-10 `Command Parser` back to a root-only package load (`require('igasovic-n8n-blocks')`) and made its internal telegram-markdown import resolve relative to the packaged module first, avoiding nested deep-package requires in the runner.
- n8n/config-ops: normalized canonical workflow JSON further by removing `createdAt` and `shared`, so `checkcfg n8n` stops diffing repo-authored workflows against workspace/runtime ownership metadata.
- n8n/docker: added the required `python` runner entry back into `ops/stack/n8n-runners/n8n-task-runners.json`; without it, `n8n-runners` crash-loops before any JS task can run.
- docker/n8n: moved `n8n-task-runners.json` under the stack-managed docker surface (`/home/igasovic/stack/n8n-task-runners.json`) so `checkcfg/updatecfg docker` can detect/apply launcher-config changes; also added required per-runner `health-check-server-port` values for multi-runner launcher mode.
- n8n-runners: fixed launcher config typing so `health-check-server-port` values are strings (`\"5680\"`, `\"5681\"`), matching runner config parsing on the Pi image.
- n8n-runners: moved runner health-check ports to `\"5681\"` (javascript) and `\"5682\"` (python) to avoid conflicting with launcher default port `5680`.
- n8n-runners: expanded `ops/stack/n8n-runners/n8n-task-runners.json` to include upstream-required launcher fields (`workdir`, `command`, `args`, `allowed-env`) for both JS and Python runners; this fixes restart loops caused by empty launch config (chdir into empty dir).
- n8n-runners: copied runtime package dependencies into `/opt/runners/task-runner-javascript/node_modules` in addition to `/usr/local/lib/node_modules/n8n/node_modules`, fixing `Cannot find module '@igasovic/n8n-blocks'` from JS task-runner resolution.
- n8n-runners: added explicit package copies to scoped runtime paths (`.../node_modules/@igasovic/n8n-blocks`) for both n8n and JS task-runner roots, while retaining unscoped compatibility alias paths.
