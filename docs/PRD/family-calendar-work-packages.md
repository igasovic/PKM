# Work Packages — Family Calendar on the PKM Pi Stack

Status: proposed  
Companion to: `family-calendar-PRD.md`  
Intended repo path: `docs/PRD/family-calendar-work-packages.md`

---

## 1. Delivery order

Recommended implementation order:

1. WP1 — contracts, config, and schema baseline
2. WP2 — backend logging tables and DB methods
3. WP3 — backend routing and normalization APIs
4. WP4 — `01 Telegram Router` changes
5. WP5 — `30 Calendar Create`
6. WP6 — `31 Calendar Read`
7. WP7 — `32 Calendar Report`
8. WP8 — evals, observability hardening, release checks

---

## WP1 — Contracts, config, and repo baseline

### Goal

Create the documented contract surface before implementation spreads across backend and n8n.

### PRD sections

- §1 Baseline and current behavior
- §6 Core invariants and boundaries
- §15 Config surface
- §16 API and operational surfaces
- §18 Migration and rollout plan

### Scope

1. Create a new PRD file under `docs/PRD/`.
2. Update `docs/api.md` for new calendar endpoints.
3. Update `docs/database_schema.md` for new prod-only calendar log tables.
4. Update `docs/config_operations.md` if a new config surface or config-file ownership is introduced.
5. Add shared config entries for calendar defaults under the approved config loader path.

### Deliverables

- PRD committed
- API docs updated
- schema docs updated
- config registry updated if needed
- shared config stub present

### Acceptance criteria

- no undocumented endpoint remains in the design
- calendar defaults are not defined ad hoc inside workflows
- docs clearly state that calendar business logs live in `pkm` and ignore `test_mode`

### Likely files

- `docs/PRD/family-calendar-PRD.md`
- `docs/PRD/family-calendar-work-packages.md`
- `docs/api.md`
- `docs/database_schema.md`
- `docs/config_operations.md`
- `src/libs/config/` and/or `src/libs/config.js`

---

## WP2 — Backend calendar logging tables and DB methods

### Goal

Add the durable business-log layer for Telegram calendar requests and external-event observations.

### PRD sections

- §13 Data model and schema changes
- §14 Validation and state transitions
- §17 Observability and logging requirements

### Scope

1. Add prod-only tables:
   - `pkm.calendar_requests`
   - `pkm.calendar_event_observations`
2. Add DB module methods in approved DB layers only.
3. Ensure these tables are not routed by active `test_mode`.
4. Add idempotency handling for Telegram calendar requests.

### Deliverables

- migrations / init scripts for new tables
- DB methods for create, update, finalize, and observe flows
- tests proving prod-only routing for calendar business logs

### Acceptance criteria

- no raw SQL outside approved DB layers
- repeated Telegram deliveries do not create duplicate request-log rows
- business logs always land in `pkm`, regardless of `test_mode`

### Likely files

- `ops/stack/postgres/init/*` or existing migration path
- `src/server/db.js`
- `src/libs/sql-builder.js` if needed
- tests covering table writes and schema routing

---

## WP3 — Backend routing, clarification, normalization, and finalize APIs

### Goal

Introduce the backend calendar intent family without breaking the existing PKM Telegram note flow.

### PRD sections

- §8 Control plane and execution flow
- §9 Event normalization rules
- §10 Subject coding and display rules
- §11 Color model
- §16 API and operational surfaces
- §17 Observability and logging requirements

### Scope

1. Add `POST /telegram/route`.
2. Add `POST /calendar/normalize`.
3. Add `POST /calendar/finalize`.
4. Add `POST /calendar/observe`.
5. Keep `POST /normalize/telegram` unchanged for PKM capture.
6. Route all LLM logic through LangGraph + LiteLLM.
7. Require `x-pkm-admin-secret` on new calendar endpoints and on `POST /telegram/route`.
8. Use shared logger and Braintrust conventions.

### Deliverables

- backend route API
- calendar normalization API
- finalize API
- observe API
- unit / integration tests for all endpoint contracts

### Acceptance criteria

- `pkm_capture` messages still work through the old path
- calendar create requests produce normalized event payloads or clarification prompts
- run correlation works through `X-PKM-Run-Id`
- LLM spans appear in Braintrust with run metadata
- transition events appear in `pkm.pipeline_events` without heavy payload leakage

### Likely files

- `src/server/index.js`
- `src/server/**` calendar route / normalize services
- `src/server/logger/**` only if extension is necessary
- `src/libs/config/**`
- tests for endpoint behavior

---

## WP4 — Extend workflow `01 Telegram Router`

### Goal

Upgrade the existing router from a binary slash-vs-capture split into a 4-way route while preserving current PKM behavior.

### PRD sections

- §1.1 Existing Telegram behavior
- §8.1 Workflow A — `01 Telegram Router`
- §15 Config surface

### Scope

1. Preserve current slash-command behavior.
2. Add explicit prefix handling for:
   - `pkm:`
   - `cal:`
3. Add backend route call for remaining unstructured messages.
4. Route to:
   - existing `02 Telegram Capture`
   - new `30 Calendar Create`
   - new `31 Calendar Read`
   - clarification reply path

### Deliverables

- updated workflow JSON for `01 Telegram Router`
- thin Code nodes only; larger logic externalized
- repo sync artifacts under `src/n8n/workflows/` and `src/n8n/nodes/`

### Acceptance criteria

- slash-command path remains intact
- PKM capture path remains intact
- router can distinguish calendar create vs calendar query vs ambiguous
- workflow changes are exported and committed through the normal n8n sync model

### Likely files

- `src/n8n/workflows/01-telegram-router*.json`
- `src/n8n/nodes/01-telegram-router/**`

---

## WP5 — Workflow `30 Calendar Create`

### Goal

Create the full Telegram-authored event path from free text to Google Calendar write.

### PRD sections

- §8.2 Workflow B — `30 Calendar Create`
- §9 Event normalization rules
- §10 Subject coding and display rules
- §11 Color model
- §14 Validation and state transitions

### Scope

1. Accept routed calendar-create requests.
2. Call backend normalization.
3. Support one or more clarification turns tied to one request.
4. Enforce one-open-request-per-chat policy for clarification state.
5. Resolve clarification continuation using latest-open request in chat (v1 heuristic).
6. Build Google event payload with:
   - coded title
   - original start time in title
   - padded block window
   - event color
   - optional location text or map link
7. Create event in Google Calendar.
8. Retry one silent time on write failure.
9. Warn on conflicts but still create.
10. Finalize backend request log status.

### Deliverables

- workflow JSON
- externalized formatting / mapping helpers
- create confirmation message formatter
- failure / retry handling

### Acceptance criteria

- high-confidence complete requests auto-create
- ambiguous requests ask fluent follow-up
- created events have correct title code and color
- conflicts warn but do not block create
- final backend state matches Google write outcome

### Likely files

- `src/n8n/workflows/30-calendar-create*.json`
- `src/n8n/nodes/30-calendar-create/**`

---

## WP6 — Workflow `31 Calendar Read`

### Goal

Support simple date-based family-calendar queries via Telegram.

### PRD sections

- §8.3 Workflow C — `31 Calendar Read`
- §12 Query and report formatting rules
- §19 Success criteria

### Scope

1. Support today / tomorrow / one weekday.
2. Query the PKM Google Calendar surface.
3. Include:
   - Telegram-authored events
   - invited visible events
   - forwarded visible events
4. Format reply for Telegram.
5. Log external observations through backend `POST /calendar/observe`.
6. Follow `America/Chicago` day-window rules (including DST-safe local boundaries).

### Deliverables

- workflow JSON
- date-window parser / formatter helpers
- observation logging call for external visible events

### Acceptance criteria

- returned events match requested window
- Telegram-authored coded titles display cleanly
- external visible events are included as-is
- external observations are logged compactly

### Likely files

- `src/n8n/workflows/31-calendar-read*.json`
- `src/n8n/nodes/31-calendar-read/**`

---

## WP7 — Workflow `32 Calendar Report` (daily + weekly)

### Goal

Send concise proactive family reports from Google Calendar state.

### PRD sections

- §8.4 Workflow D — `32 Calendar Report`
- §11 Color model
- §12 Query and report formatting rules
- §19 Success criteria

### Scope

1. Daily scheduled workflow:
   - 05:30 America/Chicago
   - today + next 2 days
   - explicit “no events today” behavior
2. Weekly scheduled workflow:
   - Sunday 18:30 America/Chicago
   - next Monday–Sunday
3. Google Calendar query and Telegram formatting in n8n.
4. Log external visible events seen and reported via backend observe endpoint.
5. Follow PRD date-window semantics for daily/weekly windows in local timezone.

### Deliverables

- `family-calendar-daily-report`
- `family-calendar-weekly-report`
- shared report formatter helpers

### Acceptance criteria

- daily report arrives on time and handles empty-day rules correctly
- weekly report skips empty days
- invited / forwarded visible events are included as-is
- color markers follow primary-person / family / grey rules

### Likely files

- `src/n8n/workflows/32-calendar-daily-report*.json`
- `src/n8n/workflows/32-calendar-weekly-report*.json`
- `src/n8n/nodes/32-calendar-report/**`

---

## WP8 — Evaluation, observability hardening, and release checks

### Goal

Make the feature debuggable and improvable from day one.

### PRD sections

- §17 Observability and logging requirements
- §19 Success criteria
- §20 Future improvements and TBD

### Scope

1. Add routing eval set:
   - PKM vs calendar create vs calendar query vs ambiguous
2. Add normalization eval set:
   - title
   - people
   - category
   - date/time
   - duration
   - location parsing
   - padding
3. Add clarification eval set.
4. Add report-format snapshot tests.
5. Add duplicate-suppression tests.
6. Add invited-event visibility / reporting tests.
7. Confirm pipeline telemetry and Braintrust spans are present.

### Deliverables

- eval dataset and prompts
- automated tests / snapshots
- release checklist

### Acceptance criteria

- routing false-positive rate is acceptable for write safety
- run-level debugging works through existing `/debug/*` surfaces
- logs are rich enough to export later for system improvement

### Suggested eval buckets

#### Routing evals

- obvious PKM note
- obvious calendar create
- obvious calendar query
- ambiguous reminder-like text
- prefix override cases

#### Normalization evals

- missing time
- missing duration
- map-link location
- home location no-padding
- birthday default duration
- multi-person ordering
- `FAM` collapse

#### Reporting evals

- no events today
- empty future day skipped
- external invited event included as-is
- external unresolved event rendered grey

---

## 2. Cross-cutting implementation rules for the coding agent

1. Follow the existing backend logger conventions instead of inventing a new telemetry path.
2. Do not place heavy texts into `pipeline_events`.
3. Keep calendar business logs in dedicated tables, separate from transition telemetry.
4. Keep n8n Code nodes thin; externalize larger JS under `src/n8n/nodes/`.
5. Do not bypass `docs/api.md`.
6. Do not bypass DB module methods.
7. If a new config surface appears, register it in `docs/config_operations.md`.

---

## 3. Suggested cut line if implementation pressure appears

If scope needs to tighten while preserving value, cut in this order:

1. observation logging for non-reported external events
2. explicit `pkm:` / `cal:` prefixes in first pass
3. query workflow support for named weekdays beyond today / tomorrow
4. more than one clarification turn

Do **not** cut:

- prod-only calendar request logging
- invited-event visibility in reports
- use of shared config
- use of existing logger / `run_id` / Braintrust conventions
