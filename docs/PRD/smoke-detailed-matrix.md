# Smoke Detailed Matrix

Status: active companion  
Surface owner: smoke harness detailed per-test matrix and implementation reference  
Scope type: companion reference  
Last extracted: 2026-03-30  
Companion to: `docs/PRD/smoke-prd.md`

## Purpose
Hold the detailed per-test matrix, fixture strategy, assertion strategy, and implementation handoff material for the smoke harness without overloading the canonical smoke PRD.

## Use this companion when
- you are implementing or extending a specific smoke test
- you need fixture-level or assertion-level detail
- the canonical smoke PRD points here for detailed execution guidance

## Notes
- The active contract remains in `docs/PRD/smoke-prd.md`.
- This companion is intentionally detailed and execution-oriented.
- If the matrix stops guiding active work, move it to `docs/PRD/archive/`.

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
