# Smoke Test PRD

## Purpose

Define the smoke-test system for the PKM stack so that after changes, and once daily, you can verify that the real n8n-orchestrated system still works end to end without spending hours chasing parser drift, routing regressions, payload-shape mismatches, or provider quirks.

This PRD is intentionally optimized for your actual failure mode:

- parser failures
- input-shape drift
- route selection regressions
- Telegram message rendering failures
- integration breakage across PKM, Google Calendar, IMAP, and Telegram

It is **not** optimized for output quality, model quality, or semantic correctness.

## Implementation Snapshot (2026-03-14)

Current repo implementation adds:

- master smoke orchestration workflow: `00 Smoke - Master`
- public ingress probe workflow: `00 Smoke - Public Ingress`
- fixture tree under `test/smoke/fixtures/`
- smoke defaults under `test/smoke/config/defaults.json`

Selected public ingress path:

- `POST https://n8n-hook.gasovic.com/pkm/smoke/ingress`

Calendar test-mode IDs currently wired in repo defaults:

- `test_calendar_id = 831dca29672745da07709e8636e37b6241df174fca270982c66a046b915b2dc1@group.calendar.google.com`
- `prod_calendar_id = pkm.gasovic@gmail.com`

Current cleanup behavior:

- PKM test entries are deleted from `pkm_test` in `T99 - Cleanup`
- backend persisted test-mode state is restored in `T99 - Cleanup`
- calendar cleanup is intentionally not destructive by default and is reported as skipped unless a dedicated delete workflow is enabled

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
- n8n smoke workflow source files may live under `src/tn8n/workflows/` after sync for now

This PRD treats that `src/tn8n/workflows/` location as acceptable for the current implementation.

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

---

## Orchestration Order

The suite should run in this order:

1. T01 infra
2. T02 public ingress
3. T03 Telegram router
4. T04 Telegram capture
5. T05 email capture fixture
6. T06 pull using captured Telegram `entry_id`
7. T07 continue using known query fixture
8. T08 distill using captured Telegram `entry_id`
9. T09 delete created PKM test entries
10. T10 calendar create in calendar test mode
11. T11 calendar read in calendar test mode
12. T99 cleanup and final reset

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

## Detailed Requirements by Test

## 1. `T01 - Infra`

### Purpose
Confirm the minimum runtime surface is alive.

### Must verify
- n8n workflow execution works
- backend `/health` succeeds
- backend `/ready` succeeds
- one PKM-backed operation succeeds

### Assertions
- expected HTTP status codes
- expected response markers
- one DB-backed PKM operation completes successfully

---

## 2. `T02 - Public Ingress`

### Purpose
Confirm `cloudflared -> n8n-hook` public ingress still works.

### Design
Do **not** depend on Telegram Trigger internals for this. Add a small generic smoke webhook workflow or endpoint and call it through the public hostname.

### Must verify
- `https://n8n-hook.gasovic.com/...` accepts a smoke POST
- n8n executes and returns an expected response

### Why separate this from Telegram router
Telegram-payload simulation and public ingress validation are different concerns. Keep them decoupled.

---

## 3. `T03 - Telegram Router`

### Purpose
Validate routing logic against Telegram-like fixtures.

### Required implementation change
Add one of:

- `When Executed by Another Workflow` directly to `01 Telegram Router`, or
- a thin test wrapper that accepts a Telegram-like payload and then executes the same router path

### Required fixtures
At minimum:

- `/continue ai`
- `cal: Louie store tomorrow at 2pm for 90min`
- ambiguous free-text message
- plain capture message

### Must verify
- commands route to `10 Read`
- explicit `cal:` routes to `30 Calendar Create`
- backend-routed capture goes to `02 Telegram Capture`
- ambiguous route produces valid Telegram message

### Assertions
- chosen route matches expected branch
- downstream execute-workflow call succeeds
- reply payload exists when a message path is expected

---

## 4. `T04 - Telegram Capture`

### Purpose
Validate `02 Telegram Capture` end to end from a fixture.

### Starting fixtures
Use at least these:

- simple capture message
- message with URL
- duplicate replay
- Markdown/special-character edge case

### Must verify
- `/normalize/telegram` succeeds
- `/db/insert` succeeds or returns `skipped` when expected
- `entry_id` is returned and captured
- optional web extraction path runs when URL exists
- Tier-1 enrichment path does not break the flow
- final Telegram confirmation renders and sends

### Required assertion points to add
After:

- `PKM Normalize Telegram`
- `PKM Insert`
- `Call '06 Web Extraction'` (when used)
- `Call 'Tier-1 Enhancement'`
- `Format Thought Saved Message` / `Format Duplicate Message`
- Telegram send node

### Required artifacts to return
- `entry_id`
- `action`
- `telegram_message`
- `telegram_message_id` if available

---

## 5. `T05 - E-Mail Capture Fixture`

### Purpose
Validate email normalization and insert path from a deterministic fixture, not live IMAP mailbox state.

### Required implementation change
Add one of:

- `When Executed by Another Workflow` directly to `03 E-Mail Capture`, or
- a wrapper workflow that accepts email fixture input and calls the same business path

### Important boundary
No external JS refactor is required for smoke coverage. The test boundary is the workflow entrypoint plus explicit assertions around key nodes.

### Starting fixture
Use the provided newsletter-style payload as the first canonical fixture.

### Must verify
- `/normalize/email` accepts fixture payload
- `/db/insert` succeeds or skips as expected
- Tier-1 enrichment handoff does not break the flow
- final Telegram notification renders and sends
- inserted `entry_id` is returned for cleanup use

### Required assertion points to add
After:

- `PKM Normalize E-Mail`
- `PKM Insert`
- `Call 'Tier-1 Enhancement'`
- `Compose Reply Text`
- Telegram send node

### Required artifacts to return
- `entry_id`
- `action`
- `telegram_message`

---

## 6. `T06 - Pull`

### Purpose
Validate `/pull` using a real `entry_id` created during the same smoke run.

### Input
Command fixture should be built dynamically from captured artifact:

```text
/pull <telegram_capture_entry_id>
```

### Must verify
- command parser accepts input
- `/db/read/pull` succeeds
- formatted Telegram reply is valid
- send succeeds

### Required assertion points to add
After:

- `Command Parser`
- `PKM Pull`
- `Format Telegram Message`
- Telegram send node

---

## 7. `T07 - Continue`

### Purpose
Validate `/continue` command path and context-pack rendering.

### Starting fixture
Use:

```text
/continue ai
```

### Must verify
- command parser succeeds
- `/db/read/continue` returns rows
- context-pack/message formatting succeeds
- Telegram send succeeds

### Note
This does not need an `entry_id`, but it should run after capture so there is fresh data in test mode.

---

## 8. `T08 - Distill`

### Purpose
Validate `/distill` using the real `entry_id` created earlier.

### Input
Command fixture built dynamically:

```text
/distill <telegram_capture_entry_id>
```

### Must verify
- command parser succeeds
- `/distill/sync` or chosen distill path succeeds
- formatted Telegram reply is valid
- send succeeds

### Required assertion points to add
After:

- `Command Parser`
- `PKM Distill Sync` or `PKM Distill Run`
- `Format Distill Message` or `Format Distill Run Message`
- Telegram send node

### Scope
Do not test output quality.

---

## 9. `T09 - Delete`

### Purpose
Validate that smoke-created test entries can be removed.

### Input
Build command dynamically from created artifacts, for example:

```text
/delete test <telegram_capture_entry_id>,<email_capture_entry_id> --force
```

### Must verify
- command parser succeeds
- `/db/delete` succeeds against test schema
- formatted delete reply sends

### Why explicit delete test matters
If cleanup is broken, repeated smoke runs become noisy and misleading.

---

## 10. `T10 - Calendar Create`

### Purpose
Validate calendar creation end to end without touching the real family calendar.

### Required implementation: n8n calendar test mode
Add `calendar_test_mode` handling in workflow logic.

When `calendar_test_mode == true`, the workflow must:

- override target calendar ID to the explicit configured `test_calendar_id`
- verify `test_calendar_id` is present
- verify `test_calendar_id != prod_calendar_id`
- hard-fail if either check fails
- prefix event summary with `[SMOKE <test_run_id>]`
- append `test_run_id` to the event description
- preserve the rest of the create path

### Important rule
This override happens in n8n only. No backend calendar test mode is required.
The workflow must never infer the test calendar from display name alone.

### Must verify
- normalize returns expected status
- conflict check executes
- Google Calendar create succeeds
- finalize succeeds
- confirmation message renders and sends

### Required artifacts to return
- `google_event_id`
- `google_calendar_id`
- `request_id`
- confirmation message text

### Additional case
Also add one negative/clarification fixture to verify `needs_clarification` message rendering.

---

## 11. `T11 - Calendar Read`

### Purpose
Validate calendar read against the test calendar.

### Must verify
- parser succeeds
- event fetch succeeds
- response formatting succeeds
- send succeeds
- if a calendar event was created earlier in the run, the read result can find it

### Required implementation
When `calendar_test_mode == true`, override calendar ID in this workflow to the same explicit `test_calendar_id` used by create.
The workflow must hard-fail if `test_calendar_id` is missing or if it matches `prod_calendar_id`.

### Preferred ordering
Run after calendar create and read back the just-created smoke event.

---

## 12. `T99 - Cleanup`

### Purpose
Leave the system clean even when the run fails in the middle.

### Responsibilities
- delete any PKM test entries created during the run
- reset PKM test mode to its prior state
- optionally record any orphaned cleanup failures in the summary

### Calendar cleanup strategy
The cleanup goal is to leave the test calendar empty without ever touching the production calendar.

Required guardrails:

1. delete calendar events only when `calendar_test_mode == true`
2. delete calendar events only when `resolved_calendar_id == test_calendar_id`
3. hard-fail cleanup if `resolved_calendar_id == prod_calendar_id`
4. hard-fail cleanup if `test_calendar_id` is missing
5. never select a delete target by calendar display name alone
6. prefer deleting only events tagged with `[SMOKE <test_run_id>]` for the current run
7. optionally support full purge of the test calendar only when an explicit `allow_test_calendar_purge == true` flag is set and all ID checks pass

Implementation path:

1. dedicated test calendar
2. `[SMOKE <test_run_id>]` tagging on every smoke-created event
3. separate cleanup workflow that deletes tagged events from the allowlisted test calendar via Google Calendar support in n8n or direct Google Calendar API calls from n8n
4. default behavior should be tagged-event deletion; full calendar purge is optional and must fail closed

Calendar cleanup is a workflow concern, not a backend concern.

---

## Fixture Strategy

## 1. Fixture storage

Create a repo-managed fixture directory:

```text
test/smoke/fixtures/
  telegram/
    router_continue_ai.json
    router_calendar_create.json
    router_ambiguous.json
    capture_simple.json
    capture_with_url.json
    capture_duplicate.json
    capture_markdown_edge.json
  email/
    newsletter_sethgodin.json
    malformed_basic.json
    duplicate_replay.json
  commands/
    continue_ai.json
    distill_template.json
    delete_template.json
  calendar/
    create_valid.json
    create_needs_clarification.json
    read_recent.json
```

## 2. Canonical starting fixtures

Start with the payloads already provided:

### Telegram command fixture
```json
{
  "update_id": 235792334,
  "message": {
    "message_id": 1497,
    "from": {
      "id": 1509032341,
      "is_bot": false,
      "first_name": "igorg",
      "username": "igorg89",
      "language_code": "en"
    },
    "chat": {
      "id": 1509032341,
      "first_name": "igorg",
      "username": "igorg89",
      "type": "private"
    },
    "date": 1773518809,
    "text": "/continue ai",
    "entities": [
      {
        "offset": 0,
        "length": 9,
        "type": "bot_command"
      }
    ]
  }
}
```

### Telegram calendar fixture
```json
{
  "update_id": 235792328,
  "message": {
    "message_id": 1485,
    "from": {
      "id": 1509032341,
      "is_bot": false,
      "first_name": "igorg",
      "username": "igorg89",
      "language_code": "en"
    },
    "chat": {
      "id": 1509032341,
      "first_name": "igorg",
      "username": "igorg89",
      "type": "private"
    },
    "date": 1773517641,
    "text": "cal: Louie store tomorrow at 2pm for 90min"
  }
}
```

### Email newsletter fixture
Use the provided Seth Godin newsletter fixture as the first realistic email input.

Important: the first smoke version does **not** need many email fixtures. One good newsletter fixture plus one malformed fixture is enough to start.

---

## Assertion Strategy

All smoke assertions should be **small, explicit, and near the failure point**.

### Add assertion nodes after critical boundaries

Typical pattern:

```json
{
  "name": "Assert normalize output",
  "checks": [
    "intent exists",
    "content_type exists",
    "capture_text exists"
  ]
}
```

### Minimum assertions by category

#### API output
- expected status code
- required fields exist
- no null/empty required fields

#### Insert/update output
- `action` in expected set
- `entry_id` exists when insert/update succeeds

#### Formatter output
- `telegram_message` is string
- non-empty
- no obvious broken placeholder fragments

#### Provider output
- Telegram send success
- Google Calendar create success
- message or event ID exists

### Design rule
Do not wait for the final node to fail. Assert immediately after the risky transformation or API boundary.

---

## Required Workflow Changes for the Coding Agent

## A. `01 Telegram Router`

Add a test-callable entrypoint.

Accept Telegram-like payload fixture input and route through the same logic. Return:

```json
{
  "route": "read|capture|calendar_create|calendar_read|ambiguous",
  "telegram_message": "...",
  "ok": true
}
```

## B. `02 Telegram Capture`

Add assertion nodes and explicit structured result output.

Return:

```json
{
  "entry_id": 123,
  "action": "inserted",
  "telegram_message": "...",
  "ok": true
}
```

## C. `03 E-Mail Capture`

Add execute-workflow entrypoint or a wrapper. Keep existing IMAP flow intact.

Return the same structured output shape as Telegram capture where possible.

## D. `10 Read`

Add a test-mode-friendly structured output after each supported smoke command:

- `/pull`
- `/continue`
- `/distill`
- `/delete`

The command path should still send the Telegram message, but also return machine-readable smoke results.

## E. `30 Calendar Create`

Add `calendar_test_mode` support in n8n.

When enabled:
- override calendar ID
- tag summary/description with smoke markers
- return `google_event_id`

## F. `31 Calendar Read`

Add `calendar_test_mode` override to point reads to the smoke calendar.

## G. Shared utility

Create one small utility pattern or subworkflow to:

- load fixture by name
- inject `test_run_id`
- inject `telegram_test_chat_id`
- merge prior artifacts into current input

---

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

## Implementation Sequence

## Phase 1 — highest ROI

Build first:

- `00 Smoke - Master`
- `T01 - Infra`
- `T02 - Public Ingress`
- `T03 - Telegram Router`
- `T04 - Telegram Capture`
- `T05 - E-Mail Capture Fixture`
- `T99 - Cleanup`

Why:
This directly attacks the biggest pain: routing, parser breakage, capture-path failures, and Telegram render/send regressions inside the real workflows.

## Phase 2

Build next:

- `T06 - Pull`
- `T07 - Continue`
- `T08 - Distill`
- `T09 - Delete`

Why:
These become high-value once artifact propagation from capture is in place.

## Phase 3

Build last:

- `T10 - Calendar Create`
- `T11 - Calendar Read`

Why:
Calendar needs isolation, guardrails, and cleanup discipline because it is the easiest area to make an irreversible mistake.

---

## What the Coding Agent Needs to Do

This is the implementation handoff.

1. Add test entrypoints where missing.
2. Add assertion nodes immediately after risky boundaries.
3. Add structured outputs from each child workflow.
4. Add artifact propagation in the master runner.
5. Implement n8n-level calendar test mode.
6. Add cleanup workflow for PKM test entries and old smoke calendar events.
7. Keep existing production behavior intact.

That is the full build scope.
