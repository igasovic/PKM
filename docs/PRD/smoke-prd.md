# PRD — Smoke Harness

Status: active  
Surface owner: n8n-first end-to-end validation harness  
Scope type: canonical surface  
Last verified: 2026-04-11  
Related authoritative docs: `docs/api_read_write.md`, `docs/api_control.md`, `docs/n8n_sync.md`, `docs/requirements.md`  
Related companion doc: `docs/PRD/smoke-detailed-matrix.md`

## Status and scope boundary
Current implementation note (2026-04-11):
- repo-authored smoke workflows `00 Smoke - Master` and `00 Smoke - Public Ingress` have been removed and must be rebuilt before smoke harness operations are considered healthy
- smoke-specific externalized nodes were removed from `src/n8n/nodes` as part of smoke harness teardown
- `scripts/n8n/run_smoke.sh` should be treated as blocked until the replacement master workflow is implemented

This PRD owns:
- the orchestrated smoke harness and fixtures
- smoke-only selector and cleanup behavior
- daily/on-demand end-to-end validation expectations for critical workflows

This PRD does not own:
- output-quality evaluation
- feature semantics for the systems it probes
- generic config-surface ownership of cloudflared or other runtime services

## Use this PRD when
- changing the smoke harness, fixtures, orchestration order, or smoke-only selectors/cleanup behavior
- deciding what the system must prove end to end after changes
- reviewing whether a test concern belongs in smoke versus in a feature PRD or unit/integration test

## Fast path by agent
- Coding agent: read `Implementation Snapshot`, `Decisions Locked In`, `Test Harness Architecture`, and then use `docs/PRD/smoke-detailed-matrix.md` for per-test and implementation detail.
- Planning agent: read `Purpose`, `Implementation Snapshot`, `What the Smoke System Must Prove`, `Test Harness Architecture`, `Reporting Requirements`, and `Success Criteria`.
- Reviewing agent: read `Status and scope boundary`, `Decisions Locked In`, `What the Smoke System Must Prove`, `Test mode contract`, `Reporting Requirements`, and `Success Criteria`.
- Architect agent: read `Existing Workflow Surfaces`, `Test Harness Architecture`, `Orchestration Order`, and `docs/PRD/smoke-detailed-matrix.md` if the review depends on fixture or assertion detail.

## Section map
- Baseline and locked decisions: `Purpose`, `Implementation Snapshot`, `Decisions Locked In`
- System-level goals: `What the Smoke System Must Prove`
- Harness design: `Test Harness Architecture`, `Required child workflow suite`, `Orchestration Order`
- Detailed matrix and fixtures: `docs/PRD/smoke-detailed-matrix.md`
- Delivery sequencing: `docs/PRD/smoke-detailed-matrix.md`

## Detailed design
## Purpose

Define the smoke-test system for the PKM stack so that after changes, and once daily, you can verify that the real n8n-orchestrated system still works end to end without spending hours chasing parser drift, routing regressions, payload-shape mismatches, or provider quirks.

This PRD is intentionally optimized for your actual failure mode:

- parser failures
- input-shape drift
- route selection regressions
- Telegram message rendering failures
- integration breakage across PKM, Google Calendar, IMAP, and Telegram

It is **not** optimized for output quality, model quality, or semantic correctness.

## Implementation Snapshot (2026-03-20)

Current repo implementation adds:

- master smoke orchestration workflow: `00 Smoke - Master`
- public ingress probe workflow: `00 Smoke - Public Ingress`
- fixture tree under `test/smoke/fixtures/`
- smoke defaults under `test/smoke/config/defaults.json`
- operator helper: `scripts/n8n/run_smoke.sh`
- backend smoke selector API: `POST /db/read/smoke`

Current smoke metadata contract implemented on capture inserts (`02` and `03`):

- `metadata.smoke.suite = "T00"`
- `metadata.smoke.run_id = <test_run_id>`

Current smoke selector behavior implemented in backend:

- `POST /db/read/smoke` requires `suite`
- optional `run_id` narrows the selector
- no time-window filtering is applied by this selector

Selected public ingress path:

- `POST https://n8n-hook.gasovic.com/pkm/smoke/ingress`

Current operator execution paths:

- n8n UI/manual trigger on `00 Smoke - Master`
- schedule trigger on `00 Smoke - Master`
- Pi shell helper: `./scripts/n8n/run_smoke.sh`

Calendar test-mode IDs currently wired in repo defaults:

- `test_calendar_id = 831dca29672745da07709e8636e37b6241df174fca270982c66a046b915b2dc1@group.calendar.google.com`
- `prod_calendar_id = pkm.gasovic@gmail.com`

Current cleanup behavior:

- PKM test entries are deleted from `pkm_test` in `T99 - Cleanup`
- backend persisted test-mode state is restored in `T99 - Cleanup`
- calendar cleanup is intentionally not destructive by default and is reported as skipped unless a dedicated delete workflow is enabled
- cleanup is step-isolated so test-mode restore still runs even when PKM delete fails
- cleanup recursively deduplicates and deletes all smoke entry IDs recoverable from artifacts/results, including `created_entry_ids`
- preflight selector cleanup is wired in WF00 as `T00.5 - Preflight Cleanup` (selector read -> delete -> verify -> fail-fast on leftovers)

Current smoke failure behavior:

- fail-fast policy is enforced (no node-level continue-on-fail settings)
- dependent tests hard-fail at precheck when required artifacts are missing (`telegram_capture_entry_id` before `T06`/`T08`)
- `/pull`, `/distill`, and `/delete` smoke command builders no longer fall back to entry `1`
- `00 Smoke - Master` routes failures into `99 Error Handling` (`errorWorkflow`)
- `99 Error Handling` detects smoke master failures, executes smoke cleanup, and reports cleanup status in the failure Telegram alert
- smoke record nodes rebuild suite state from their originating `Build T*` nodes instead of assuming tested subworkflows pass state through unchanged

---

## Decisions Locked In

These are not open questions anymore.

1. **The smoke harness is n8n-first.**
   The thing being tested is the orchestrated workflow system, so the test harness must run the workflows that matter.

2. **External JS internals are not the testing boundary.**
   Smoke tests do not need unit coverage of the JS files. They need entrypoints, assertion points, and deterministic fixtures around the existing workflow behavior.

3. **Fixtures are required.**
   Telegram and email tests must be runnable from controlled payloads, not only from live provider triggers.

4. **Calendar test mode must be implemented in n8n, not in the backend.**
   PKM backend test mode is for PKM data isolation. Calendar isolation must happen at the workflow layer by overriding the calendar target and tagging test events.

5. **Calendar cleanup must fail closed.**
   Smoke cleanup may delete events only from an explicit allowlisted test calendar ID. It must never infer the target calendar from names, and it must hard-fail if the resolved test calendar ID matches the configured production calendar ID.

6. **The test chain must capture created `entry_id` values and reuse them.**

   Capture must create entries, and later tests must use those exact IDs for `/pull`, `/distill`, and `/delete`.

7. **Assertions are structural, not semantic.**
   The smoke system checks that workflows run, payloads are accepted, writes happen, reads return results, messages render, and sends succeed.

8. **Smoke state must not rely on downstream payload pass-through.**

   The suite must preserve results/artifacts from the orchestrator side and treat tested workflow outputs as replaceable payloads.

---

## Problem Statement

Today, a normal change can create hours of manual validation work because success depends on multiple fragile boundaries:

- Telegram input shape
- router behavior
- command parsing
- email normalization
- DB insert/idempotency
- optional URL extraction path
- Tier-1 enrichment handoff
- Telegram formatting and MarkdownV2 safety
- calendar normalization and Google Calendar writes/reads

The system often looks alive while being functionally broken.

The smoke system must answer one operator question quickly:

> “After this change, do the critical PKM workflows still run through n8n from input to output?”

---

## Goals

### Primary goals

1. Verify that the core runtime is operational:
   - n8n
   - cloudflared/public ingress
   - PKM backend
   - Postgres via PKM-backed operations

2. Verify that the main workflow paths still execute through n8n:
   - Telegram routing
   - Telegram capture
   - email capture
   - pull
   - continue
   - distill
   - calendar create
   - calendar read

3. Verify the real bug-heavy message path inside the workflows that already send Telegram messages:
   - payload accepted
   - parsed/transformed successfully
   - final Telegram text rendered correctly
   - Telegram send succeeds

4. Make tests runnable:
   - on demand after changes
   - daily on schedule

5. Make failures diagnosable:
   - entrypoint
   - parser
   - router
   - backend call
   - provider call
   - formatter/send step

### Non-goals

1. Do not test content quality.
2. Do not test LLM output quality.
3. Do not build a broad regression suite.
4. Do not require provider-live traffic for all tests if a fixture is sufficient.

---

## Repository Layout

Required locations:

- smoke test assets and fixtures live under `test/smoke/`
- n8n smoke workflow source files may live under `src/n8n/workflows/` after sync for now

This PRD treats that `src/n8n/workflows/` location as acceptable for the current implementation.

---

## Existing Workflow Surfaces

## 1. `01 Telegram Router`

Current behavior:

- accepts Telegram trigger input
- runs `Prepare Route Input`
- sends commands to `10 Read`
- routes explicit `cal:` messages to `30 Calendar Create`
- routes to backend `/telegram/route` for intent-based dispatch
- can emit an ambiguous Telegram response

Implication for smoke tests:

- router behavior is important enough to have its own test
- it needs a callable test entrypoint for Telegram-like fixture payloads
- at least one separate ingress test should still exercise the public `n8n-hook` path

## 2. `02 Telegram Capture`

Current behavior:

- already supports `When Executed by Another Workflow`
- normalizes via `/normalize/telegram`
- inserts via `/db/insert`
- handles duplicates via `action == skipped`
- optionally runs web extraction when URL exists
- calls Tier-1 enrichment
- formats and sends Telegram confirmation

Implication:

- this is already close to smoke-testable
- the main missing piece is structured assertions and explicit result output
- this workflow is the best place to capture and return `entry_id`

## 3. `03 E-Mail Capture`

Current behavior:

- starts from IMAP trigger
- normalizes via `/normalize/email`
- inserts via `/db/insert`
- handles duplicates
- calls Tier-1 enrichment
- formats and sends Telegram notification

Implication:

- this is the main workflow gap
- it needs a test entrypoint independent of live IMAP state
- adding an execute-workflow trigger or thin wrapper is required

## 4. `10 Read`

Current behavior:

- already supports `When Executed by Another Workflow`
- parses commands
- calls `/db/read/pull`, `/db/read/continue`, `/db/delete`, `/distill/sync`, `/distill/run`, etc.
- formats and sends Telegram replies

Implication:

- `/pull`, `/continue`, `/distill`, and `/delete` smoke tests should all run through this workflow
- those tests should use fixture command payloads plus captured `entry_id` values from earlier capture tests

## 5. `30 Calendar Create`

Current behavior:

- already supports `When Executed by Another Workflow`
- builds normalize request
- calls `/calendar/normalize`
- checks conflicts in Google Calendar
- creates Google Calendar event
- calls `/calendar/finalize`
- formats and sends Telegram confirmation

Implication:

- this is smoke-testable today
- but it needs **n8n-level calendar test mode** to redirect writes to a dedicated test calendar
- it also needs stable tagging for cleanup and assertions

## 6. `31 Calendar Read`

Current behavior:

- already supports `When Executed by Another Workflow`
- parses calendar query
- fetches Google Calendar events
- formats and sends Telegram reply
- optionally calls `/calendar/observe`
- optionally finalizes query via backend

Implication:

- this is smoke-testable today
- it must read from the same test calendar used by calendar create when running in smoke mode

## 7. `21 Tier-1 Enrichment` and `22 Web Extraction`

Current behavior:

- both are already callable subworkflows
- both are reached indirectly from capture workflows

Implication:

- no extra test entrypoints are required for smoke
- smoke should assert around their outputs from the parent flow rather than unit-testing their internal JS

## 8. `98 Config`

Current behavior:

- retrieves config
- can toggle PKM backend test mode

Implication:

- it is useful for PKM test schema isolation
- it is **not** the solution for calendar test mode

---

## What the Smoke System Must Prove

### A. Infra/runtime

- n8n can execute workflows
- cloudflared/public ingress is alive
- PKM backend responds
- Postgres-backed PKM operations succeed

### B. Capture and routing

- Telegram-like payload can be routed
- Telegram capture inserts successfully
- email fixture can be normalized and inserted successfully
- duplicate handling still works where expected

### C. Read-side flows

- `/pull` works on a real `entry_id` created during the same smoke run
- `/continue` returns results and formats correctly
- `/distill` works on a real `entry_id` created during the same smoke run
- `/delete` removes test entries created during the same smoke run

### D. Calendar flows

- calendar create works end to end against a test calendar
- calendar read can read back the created or seeded test event
- calendar writes do not pollute the real family calendar

### E. Telegram rendering/send path

- final Telegram messages are non-empty
- MarkdownV2-safe rendering holds
- send nodes return success
- returned message IDs exist where available

---

## Test Harness Architecture

## 1. Master workflow

### Workflow
`00 Smoke - Master`

### Triggers
- Manual Trigger
- Schedule Trigger (daily)

### Responsibilities
- create `test_run_id`
- set PKM backend `test_mode` before the first child test
- call child tests in order
- collect artifacts from earlier tests
- reuse `entry_id` values in later tests
- aggregate pass/fail
- send one Telegram summary
- keep PKM backend `test_mode` enabled for the whole smoke fixture, including calendar tests
- perform cleanup and reset PKM backend `test_mode` to its prior state on both success and failure paths

### Shared smoke context
Every child workflow should receive a shared object like:

```json
{
  "test_run_id": "smoke_2026-03-14_01",
  "smoke_mode": true,
  "pkm_test_mode": true,
  "calendar_test_mode": true,
  "test_calendar_id": "<explicit_test_calendar_id>",
  "prod_calendar_id": "<explicit_prod_calendar_id>",
  "telegram_test_chat_id": "<chat_id>",
  "artifacts": {},
  "fixtures": {}
}
```

### Metadata marker contract (locked)
Smoke-created PKM entries must carry:

```json
{
  "metadata": {
    "smoke": {
      "suite": "T00",
      "run_id": "smoke_2026-03-20_01"
    }
  }
}
```

Only these two smoke keys are required for selector-based cleanup in this PRD phase.

### Test mode contract
The master workflow must:

- read the current backend `test_mode` state
- set backend `test_mode = true` before any child test starts
- keep backend `test_mode = true` for the entire smoke fixture, including calendar tests
- restore the prior backend `test_mode` state in `T99 - Cleanup` even if intermediate tests fail

This is required so every PKM-touching call in the smoke run stays isolated in the same fixture window.

### Shared result contract
Every child returns:

```json
{
  "test_case": "telegram_capture",
  "ok": true,
  "run_id": "smoke_2026-03-14_01",
  "artifacts": {
    "entry_id": 12345,
    "google_event_id": "abcd1234"
  },
  "assertions": [
    { "name": "normalize_ok", "ok": true },
    { "name": "insert_ok", "ok": true }
  ],
  "error": null
}
```

---

## 2. Required child workflow suite

0. `T00.5 - Preflight Cleanup` (selector cleanup gate)
1. `T01 - Infra`
2. `T02 - Public Ingress`
3. `T03 - Telegram Router`
4. `T04 - Telegram Capture`
5. `T05 - E-Mail Capture Fixture`
6. `T06 - Pull`
7. `T07 - Continue`
8. `T08 - Distill`
9. `T09 - Delete`
10. `T10 - Calendar Create`
11. `T11 - Calendar Read`
12. `T99 - Cleanup`

Notes:

- remove standalone email-connectivity smoke and standalone Telegram payload smoke from the required suite
- Telegram payload render/send assertions belong inside the workflows that already render and send Telegram messages
- `/delete` remains an explicit test because cleanup is part of system health, not just housekeeping
- `T99 - Cleanup` must run even on failure
- `T00.5 - Preflight Cleanup` must run before `T04`

---

## Orchestration Order

The suite should run in this order:

1. T00.5 preflight cleanup (selector-based)
2. T01 infra
3. T02 public ingress
4. T03 Telegram router
5. T04 Telegram capture
6. T05 email capture fixture
7. T06 pull using captured Telegram `entry_id`
8. T07 continue using known query fixture
9. T08 distill using captured Telegram `entry_id`
10. T09 delete created PKM test entries
11. T10 calendar create in calendar test mode
12. T11 calendar read in calendar test mode
13. T99 cleanup and final reset

### `T00.5 - Preflight Cleanup` contract

Purpose:
- eliminate dirty-state duplicates before capture tests start.

Flow:
1. call `POST /db/read/smoke` with `{ "suite": "T00" }`
2. extract candidate `entry_id[]`
3. call existing delete path for those IDs (test mode)
4. re-run `POST /db/read/smoke` with `{ "suite": "T00" }`
5. hard-fail suite if leftovers remain

Assertions:
- selector call succeeds
- post-delete selector result is empty

### Required artifact propagation

The master runner must capture and store at minimum:

```json
{
  "telegram_capture_entry_id": 123,
  "email_capture_entry_id": 456,
  "calendar_event_id": "google_event_id",
  "calendar_request_id": "request_id"
}
```

These artifacts are inputs to later tests.

---

## Detailed matrix companion

The per-test matrix, fixture detail, assertion strategy, and implementation handoff now live in:
- `docs/PRD/smoke-detailed-matrix.md`

Use that companion for:
- `T01` through `T99` detailed expectations
- fixture storage and starting-fixture detail
- assertion-node placement guidance
- workflow-specific implementation handoff and sequencing

## Reporting Requirements

Each run should report:

- `test_run_id`
- start/end time
- overall pass/fail
- passed count
- failed count
- failures with short location-specific message
- captured artifacts when useful

### Telegram summary format

```text
Smoke failed
Run: smoke_2026-03-14_01
Passed: 9
Failed: 2
Failures:
- E-Mail Capture Fixture: normalize/email missing content_type
- Calendar Create: Google create succeeded but finalize failed
```

The summary should be short. Detail belongs in structured results and per-test artifacts.

---

## Success Criteria

The smoke system is successful when:

1. after a change, one manual run gives a clear answer within minutes
2. daily runs catch regressions early
3. Telegram and email parser issues are reproducible from fixtures
4. capture-created entries are reused to validate pull, distill, and delete
5. calendar tests never write to the real family calendar
6. failures point to the broken boundary instead of forcing manual spelunking

---

## Implementation companion

The implementation sequence and coding-agent handoff now live in:
- `docs/PRD/smoke-detailed-matrix.md`

Keep the canonical PRD focused on the active smoke-harness contract, locked decisions, architecture, reporting, and success criteria.
