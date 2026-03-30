# PRD — Family Calendar On The PKM Pi Stack

Status: proposed  
Surface owner: family-calendar feature surface  
Scope type: canonical surface  
Last verified: 2026-03-30  
Related authoritative docs: `docs/api_calendar.md`, `docs/database_schema.md`, `docs/config_operations.md`, `docs/env.md`  
Related work-package doc: `docs/PRD/family-calendar-work-packages.md`

## Purpose
Define the family-calendar feature surface centered on Telegram creation, Google Calendar writes/reads, and scheduled family reports.

## Use this PRD when
- planning or reviewing the family-calendar feature surface
- changing Telegram-to-calendar intent handling, Google Calendar interaction, reporting, or family-calendar schemas
- deciding whether a future calendar behavior belongs in this feature PRD or in a shared ingest/read/config surface

## Fast path by agent
- Coding agent: read `Status and scope boundary`, `1. Baseline and current behavior`, `6. Core invariants and boundaries`, `8. Control plane and execution flow`, `13. Data model and schema changes`, and `16. API and operational surfaces`.
- Planning agent: read `2. Problem statement`, `3. Goals`, `4. Non-goals for v1`, `6. Core invariants and boundaries`, `8. Control plane and execution flow`, and `18. Migration and rollout plan`.
- Reviewing agent: read `Status and scope boundary`, `6. Core invariants and boundaries`, `9. Event normalization rules`, `14. Validation and state transitions`, `16. API and operational surfaces`, and `19. Success criteria`.
- Architect agent: read `1.2 Existing system boundaries`, `6. Core invariants and boundaries`, `8.6 Hybrid backend orchestration (implemented shape)`, `13. Data model and schema changes`, `15. Config surface`, and `20. Future improvements and TBD`.

## Section map
- Current baseline and motivation: `1. Baseline and current behavior`, `2. Problem statement`, `3. Goals`, `4. Non-goals for v1`
- Product boundaries: `5. Users, roles, and permissions`, `6. Core invariants and boundaries`, `7. Event classes`
- Flow design: `8. Control plane and execution flow`, `9. Event normalization rules`, `10. Subject coding and display rules`, `11. Color model`, `12. Query and report formatting rules`
- Persistent and operational impact: `13. Data model and schema changes`, `14. Validation and state transitions`, `15. Config surface`, `16. API and operational surfaces`, `17. Observability and logging requirements`
- Delivery planning: `18. Migration and rollout plan`, `19. Success criteria`, `20. Future improvements and TBD`, `21. Work packages`

## Status and scope boundary
This PRD owns the family-calendar feature surface and remains proposed work, not a backfilled baseline of currently implemented behavior.

## Detailed design
## 1. Baseline and current behavior

### 1.1 Existing Telegram behavior

The current Telegram entry point is workflow **`01 Telegram Router`**. It performs one simple split:

- messages starting with `/` go to **PKM Read**
- everything else goes to **`02 Telegram Capture`**

`02 Telegram Capture` is a PKM-note flow, not a calendar flow. It currently:

- calls PKM config
- calls `POST /normalize/telegram`
- calls `POST /db/insert`
- continues existing PKM capture / enrichment behavior

This matters because `POST /normalize/telegram` is explicitly documented as returning a `pkm.entries`-compatible payload for Telegram capture, not a calendar-event contract. Calendar work must therefore be introduced as a separate intent family and a separate backend contract rather than extending the current note-normalization path.

### 1.2 Existing system boundaries

The implementation must respect the existing boundary:

- **n8n** owns Telegram and Google Calendar integration
- **pkm-server** owns LLM-backed routing, clarification, normalization, and backend logging
- **LiteLLM** remains the only model gateway used by backend LLM flows
- **Google Calendar under the PKM account** is the central family calendar surface

### 1.3 Existing repo and delivery rules

This is new major functionality and therefore requires a dedicated PRD under `docs/PRD/`. Workflow wiring must be edited in n8n UI and synced back to repo. New n8n code belongs under `src/n8n/`, with Code nodes kept thin and larger logic externalized. API surface changes must be reflected in `docs/api.md`, and config changes must follow the shared config / config-registry process.

---

## 2. Problem statement

Family scheduling currently lacks one reliable, low-friction system that:

- accepts Telegram free text
- keeps the shared family calendar up to date
- makes invited family-relevant events visible and reportable
- encodes people and colors consistently
- gives concise proactive reporting
- leaves enough logs behind to improve the system over time

---

## 3. Goals

### 3.1 Primary goals

Build a family calendar system centered on the PKM Google Calendar account that:

1. uses the PKM Google calendar surface as the central shared family view
2. is shared with Igor and Danijela Google accounts
3. creates family events from Telegram free text
4. includes events created on Igor or Danijela calendars when `pkm.gasovic` is invited
5. includes forwarded events that end up visible on the family calendar surface
6. sends:
   - a **daily report** at **05:30 America/Chicago** covering **today + next 2 days**
   - a **weekly report** on **Sunday at 18:30 America/Chicago** covering **next Monday–Sunday**
7. codes people into the subject for Telegram-authored events
8. color-codes events by person in Google Calendar and Telegram reports
9. logs all Telegram calendar requests, clarification turns, and outcomes in Postgres
10. uses Braintrust from day one for LLM spans

### 3.2 Secondary goals

Support family-calendar query requests from Telegram for:

- `today`
- `tomorrow`
- a single named weekday

---

## 4. Non-goals for v1

The following are explicitly out of scope for the first implementation:

- private or work calendar sync beyond invited / visible events
- rewriting or canonicalizing externally authored invited events
- rewriting or canonicalizing forwarded events
- free-text update or cancel
- recurring-event creation from Telegram
- Home Assistant write-path integration
- advanced query semantics beyond today / tomorrow / one weekday
- automatic person inference for external events beyond very basic future improvements
- category-driven colors

---

## 5. Users, roles, and permissions

### 5.1 Telegram creators

Allowed Telegram creators in v1:

- Igor
- Danijela

No other Telegram users may create family calendar events in v1.

v1 enforcement baseline:

- shared config stores explicit Telegram numeric user-id allowlists
- calendar flow allowlist includes both Igor and Danijela
- PKM capture allowlist is a stricter subset (Igor only)
- backend enforces allowlists in calendar router/normalize APIs using Telegram sender id (`message.from.id`)
- this works in both direct chat and group chat because authorization is based on sender id, not chat id

### 5.2 External event authors in scope

Events authored outside the system are in scope for visibility and reporting when they are created by Igor or Danijela and `pkm.gasovic` is invited, or when they are forwarded into the PKM family calendar surface.

### 5.3 Visibility

Anything visible on the family calendar surface is considered family-visible. No privacy redaction layer is required in v1.

---

## 6. Core invariants and boundaries

1. **n8n must not talk directly to Postgres.** It should call backend APIs and Google / Telegram only.
2. **Backend must not call Google Calendar or Telegram directly.** Backend produces normalized decisions and logs.
3. **LiteLLM remains the only LLM gateway.** No direct provider calls from n8n or backend business code.
4. **Existing `POST /normalize/telegram` remains PKM-only.** Calendar must not overload it.
5. **Calendar business logs must live in prod schema `pkm` and must not be affected by `test_mode`.**
6. **Pipeline telemetry remains separate from business logs.**
   - transition telemetry → `pkm.pipeline_events`
   - LLM spans → Braintrust
7. **No scattered defaults.** Shared calendar defaults belong in shared config, not ad hoc in workflows or modules.

---

## 7. Event classes

The design must distinguish two event classes.

### 7.1 Telegram-authored events

These are created from Telegram free text through the backend LLM flow and then written by n8n to Google Calendar.

These events are guaranteed in v1 to follow:

- people-coded subject format
- category code
- person-color logic
- duration defaults and padding rules
- clarification loop behavior

### 7.2 External visible events

These include:

- events created on Igor or Danijela calendars with `pkm.gasovic` invited
- forwarded events that become visible on the PKM family calendar surface

These events must be:

- visible on the family calendar surface
- included in read results and reports
- left untouched in v1
- reported **as-is** in v1

They are **not** rewritten, re-colored, or re-titled in v1. Grey is used when people cannot be resolved for report-color purposes.

---

## 8. Control plane and execution flow

### 8.1 Workflow A — `01 Telegram Router` (existing workflow to be extended)

The router should evolve from a binary split into this decision order:

1. **slash command** → existing command/read path
2. **explicit prefix `pkm:`** → PKM capture path
3. **explicit prefix `cal:`** → calendar path
4. otherwise call backend **`POST /telegram/route`** for intent routing

Ingress policy:

- Telegram ingress must not be hard-locked to one chat id.
- Authorization is by Telegram sender user id via shared allowlist policy.
- Reply chat id should come from request context when available; only non-chat-triggered operational workflows should use a fixed admin chat id fallback.

The backend router should classify into:

- `pkm_capture`
- `calendar_create`
- `calendar_query`
- `ambiguous`

Routing outcomes:

- `pkm_capture` → existing `02 Telegram Capture`
- `calendar_create` → workflow `30 Calendar Create`
- `calendar_query` → workflow `31 Calendar Read`
- `ambiguous` → one fluent clarification message in Telegram

### 8.2 Workflow B — `30 Calendar Create`

High-level flow:

1. receive Telegram input and actor identity
2. call backend **`POST /calendar/normalize`** with:
   - raw text
   - actor
   - Telegram source identifiers
   - prior clarification turns if any
   - `run_id`
3. backend returns one of:
   - `needs_clarification`
   - `ready_to_create`
   - `rejected`
4. if clarification is needed, n8n sends the question and binds the next non-command chat message to the latest open request (per §8.5)
5. if ready, n8n writes the event to Google Calendar
6. n8n sends a confirmation message, including conflict warnings when relevant
7. n8n calls backend **`POST /calendar/finalize`** with create outcome

Failure handling:

- Google create failure retries silently once
- if retry still fails, warn in Telegram and finalize as failed

### 8.3 Workflow C — `31 Calendar Read`

Scope for v1 query requests:

- events today
- events tomorrow
- events on one named weekday

The workflow should:

1. determine the target date window
2. query the PKM Google Calendar surface
3. include:
   - Telegram-authored events
   - invited visible events
   - forwarded visible events
4. format output for Telegram
5. call backend **`POST /calendar/observe`** for externally authored events that were observed and/or reported

### 8.4 Workflow D — `32 Calendar Report`

There are two scheduled workflows:

- `family-calendar-daily-report`
- `family-calendar-weekly-report`

Reports are generated in n8n, not backend.

#### Daily report

Schedule: **05:30 America/Chicago**  
Window: **today + next 2 days**

Rules:

- if **today** has no events, explicitly say so
- if either future day has no events, omit that day
- group by day
- list items chronologically
- use coded title for Telegram-authored events
- use as-is title for external visible events

#### Weekly report

Schedule: **Sunday 18:30 America/Chicago**  
Window: **next Monday–Sunday**

Rules:

- skip days with no events
- group by day
- list items chronologically
- use coded title for Telegram-authored events
- use as-is title for external visible events

#### Important v1 rule

There are **no backend reporting endpoints**. n8n owns Google query + report formatting.

### 8.5 Clarification request policy (v1)

Clarification handling in v1 uses a simple single-open model:

1. allow only **one open calendar-create request per Telegram chat** at a time
2. when a request is in `needs_clarification`, the next non-command message in that chat is treated as the answer for the **latest open request**
3. do not open a second concurrent clarification request in the same chat
4. if no open request exists, the message is handled as a fresh routed message

Future improvement (explicitly not in v1):

- reply-based linking to bind answers to a specific request thread

### 8.6 Hybrid backend orchestration (implemented shape)

Calendar routing and parsing use two small LangGraph graphs, not one monolith.

Routing graph (`src/server/telegram-router/`):

- `load`
- `rule_gate`
- `llm_route_if_needed`
- `parse_route_result`
- `write_log`

Calendar extraction graph (`src/server/calendar/`):

- `load`
- `prompt`
- `llm`
- `parse`
- `validate`
- `write_log`

Design constraints:

- deterministic rules run first for routing
- LLM routing is fallback-only when rule routing is unresolved
- calendar extraction can use LLM field candidates, but deterministic validation remains the final create gate
- both graphs must expose trace-ready outputs so eval harnesses can score routing and extraction quality without changing runtime architecture

---

## 9. Event normalization rules

### 9.1 Required fields for Telegram-authored events

Required before create:

- title
- date
- start time
- duration or end time
- people involved
- category

Optional:

- location

### 9.2 Accepted location forms

Location may be:

- plain text
- Google Maps link
- Apple Maps link

### 9.3 Clarification behavior

If required fields are missing or ambiguous, backend should return one fluent non-technical clarification prompt summarizing what is still missing.

Examples that should ask follow-up rather than infer:

- “lunch with Sarah next Thursday” when time is missing
- “kids dentist sometime next week”
- “birthday party Saturday” without time / people / category certainty

### 9.4 Auto-create policy

Auto-create is allowed when confidence is high and required fields are present.

### 9.5 Duration defaults

Initial default table (minutes), to be tuned later:

| Category code | Default duration (min) |
|---|---:|
| `FAM` | 120 |
| `MED` | 60 |
| `HOME` | 60 |
| `EVT` | 120 |
| `KID` | 60 |
| `ADM` | 30 |
| `DOG` | 60 |
| `SCH` | 60 |
| `TRV` | 120 |
| `OTH` | 60 |

Fallback behavior:

- if category is unknown or missing after normalization, use `60` minutes
- if text clearly indicates birthday semantics, use `180` minutes

### 9.6 Padding rule

If location is exactly `home`, do **not** pad.

Otherwise, including missing location:

- add `30` minutes before original start
- add `30` minutes after original end

The **blocked event** uses the padded time window.

The **title** must keep the **original start time**, not the padded block start.

### 9.7 Conflict handling

Conflict checking in v1 applies only against the family calendar surface.

If overlap exists:

- create anyway
- warn in confirmation

### 9.8 Recurrence

Telegram recurrence creation is out of scope for v1.

All-day Telegram event creation is also out of scope for v1.

---

## 10. Subject coding and display rules

### 10.1 Person registry and fixed order

Canonical people:

- Mila → `M`
- Iva → `Iv`
- Louie → `L`
- Igor → `Ig`
- Danijela → `D`

Whole-family shorthand:

- `FAM`

Order rule for subject generation and display:

- always order as `M`, `Iv`, `L`, `Ig`, `D`
- if all five are involved, use `FAM`

### 10.2 Category registry

Initial categories:

- `FAM` → family
- `MED` → medical
- `HOME` → home
- `EVT` → event
- `KID` → kids
- `ADM` → admin
- `DOG` → dog
- `SCH` → school
- `TRV` → travel
- `OTH` → other

Category registry must be shared-config-driven because the user expects it may change.

### 10.3 Subject format

Telegram-authored events should use:

```text
[people][category] 3:00p Title
```

Examples:

```text
[M][MED] 3:00p Dentist
[M,Iv][KID] 4:30p Swim
[L][DOG] 9:00a Vet
[FAM][EVT] 1:00p Birthday party
```

External visible events are **not rewritten** into this format in v1.

---

## 11. Color model

Colors are person-driven.

### 11.1 Color mapping

- Mila → purple
- Iva → yellow
- Igor → blue
- Danijela → white
- Louie → orange
- Family → green
- unresolved external visible event → grey

Initial implementation mapping table (can be adjusted later):

| Subject | Logical color | Google event `colorId` (initial) | Telegram marker |
|---|---|---|---|
| Mila | purple | `3` | `🟣` |
| Iva | yellow | `5` | `🟡` |
| Igor | blue | `9` | `🔵` |
| Danijela | white/light neutral | `1` | `⚪` |
| Louie | orange | `6` | `🟠` |
| Family (`FAM`) | green | `10` | `🟢` |
| unresolved external visible event | grey | n/a (read/report only) | `⚫` |

Guardrail:

- keep family mapping green and distinct from Igor blue.

### 11.2 Google Calendar color rule for Telegram-authored events

Because Google events allow one event color, use:

1. `FAM` → green
2. exactly one person → that person’s color
3. multi-person non-family event → first person in canonical order (`M`, `Iv`, `L`, `Ig`, `D`)

### 11.3 External visible events

In v1, external visible events are not rewritten. For report display, unresolved people map to grey.

### 11.4 Telegram report color rendering

Telegram reports should use the nearest available emoji / symbol color to reflect the same color rule. Exact glyph choice may vary by Telegram client.

---

## 12. Query and report formatting rules

### 12.1 Telegram-created events

Use stored coded title directly.

### 12.2 External visible events

Report them as-is. Do not rewrite titles.

If external event titles do not already contain time, the formatter may prepend the start time for readability, but must not rewrite the calendar event itself.

### 12.3 Empty-day behavior

Daily report:

- if today has no events, explicitly say so
- skip empty future days

Weekly report:

- skip empty days

### 12.4 Date-window and time semantics

Use timezone-aware calculations in `America/Chicago` for all query/report windows.

Rules:

1. day windows are half-open local windows: `[00:00 local, next 00:00 local)`
2. `today` and `tomorrow` are resolved in `America/Chicago`, not server UTC
3. named weekday resolves to the next matching local weekday; if it is already that weekday locally, use the current day window
4. DST transitions must use local calendar boundaries (not fixed 24h math)
5. all-day creation from Telegram is out of scope in v1; if external all-day events are visible, include them read-only and label as all-day in report text

---

## 13. Data model and schema changes

The design introduces **business log tables** in **prod schema `pkm` only**. These are separate from `pkm.pipeline_events` and are not controlled by `test_mode`.

### 13.1 Table: `pkm.calendar_requests`

Purpose:

- one row per Telegram calendar request
- keep clarification turns tied to the same request
- preserve a durable artifact for later evaluation and prompt improvement

Suggested fields:

- `request_id uuid pk`
- `created_at timestamptz`
- `updated_at timestamptz`
- `run_id text not null`
- `source_system text not null default 'telegram'`
- `actor_code text not null`
- `telegram_chat_id text not null`
- `telegram_message_id text not null`
- `route_intent text`
- `route_confidence numeric`
- `status text not null`
- `raw_text text not null`
- `clarification_turns jsonb not null default '[]'`
- `normalized_event jsonb`
- `warning_codes jsonb`
- `error jsonb`
- `google_calendar_id text`
- `google_event_id text`
- `idempotency_key_primary text not null`
- `idempotency_key_secondary text`

Requirements:

- unique on primary idempotency key
- partial unique index enforcing one open request per `telegram_chat_id` (open statuses defined in §14.1)
- index `(telegram_chat_id, updated_at desc)` for latest-open lookup
- store follow-up questions and answers inside the same request row via `clarification_turns`
- table lives in `pkm` only
- backend logging path must bypass active test-mode schema routing

### 13.2 Table: `pkm.calendar_event_observations`

Purpose:

- log externally authored visible events that were observed during read/report workflows
- capture which items were seen and/or reported without rewriting them

Suggested fields:

- `observation_id uuid pk`
- `created_at timestamptz`
- `updated_at timestamptz`
- `run_id text not null`
- `google_calendar_id text not null`
- `google_event_id text not null`
- `observation_kind text not null`  
  examples: `query_seen`, `daily_report_seen`, `weekly_report_seen`
- `source_type text not null`  
  examples: `invite`, `forwarded`, `external_unknown`
- `event_snapshot jsonb not null`
- `resolved_people jsonb`
- `resolved_color text`
- `was_reported boolean not null default false`

Requirements:

- compact event snapshot only
- do not turn this into a second event store
- prod schema only
- unaffected by test mode

### 13.3 Existing telemetry remains unchanged

Existing observability remains in place:

- transition telemetry → `pkm.pipeline_events`
- LLM spans → Braintrust

Calendar business tables complement this rather than replacing it.

---

## 14. Validation and state transitions

### 14.1 Calendar request states

Suggested state model:

- `received`
- `routed`
- `needs_clarification`
- `clarified`
- `normalized`
- `calendar_write_started`
- `calendar_created`
- `calendar_failed`
- `query_answered`
- `ignored`

State grouping for invariants:

- open (eligible for clarification continuation): `needs_clarification`
- terminal: `calendar_created`, `calendar_failed`, `query_answered`, `ignored`

Single-open invariant:

- at most one open request per `telegram_chat_id`

### 14.2 Clarification turn model

A clarification turn should retain:

- question text
- answer text
- timestamp
- actor
- missing fields before turn
- remaining missing fields after turn

Continuation resolution in v1:

1. find latest open request for the current `telegram_chat_id`
2. append the incoming answer as a clarification turn on that request
3. re-run normalization with accumulated turns
4. if no open request exists, treat as a new routed message

Future improvement:

- reply-based linking to a specific request/message thread

### 14.3 Duplicate handling

For Telegram-authored requests, primary idempotency should be tied to Telegram source identifiers.

Suggested primary key form:

```text
tgcal:<chat_id>:<message_id>
```

Secondary key may use a normalized event fingerprint when present.

Google-write idempotency requirement:

- n8n must write Telegram-authored events with deterministic machine metadata in Google event `extendedProperties.private`:
  - `pkm_request_id`
  - `pkm_idempotency_key_primary`
- before a create retry (or recovery after uncertain write outcome), n8n should check whether an event already exists for the same `pkm_request_id` and reuse that event instead of creating a duplicate
- backend finalize must be idempotent by `request_id`

---

## 15. Config surface

### 15.1 Shared config requirement

Calendar defaults must follow the existing shared-config methodology:

- repo-owned
- read through approved config loader
- shared between backend and externalized n8n code
- not hidden inside workflow literals unless truly workflow-local

### 15.2 Config items to introduce

Recommended shared config keys:

- family calendar id
- PKM recipient email (`pkm.gasovic`)
- allowed Telegram actor identities
- people registry:
  - names
  - codes
  - order
  - color mapping
  - family alias
- category registry
- default durations by category
- padding rule
- timezone (`America/Chicago`)
- location-home literal(s)
- prefix tokens (`cal:`, `pkm:`)

### 15.3 Scheduling values

For v1, daily and weekly report cadence is fixed business behavior and should not be user-runtime-configurable. The implementation may still centralize those constants in shared config or shared code, but should not treat them as runtime-mutable settings.

---

## 16. API and operational surfaces

### 16.1 Existing API constraint

The calendar design must not overload existing `POST /normalize/telegram`, which remains reserved for PKM capture.

### 16.2 New backend endpoints to document in `docs/api.md`

Security requirement for v1:

- require `x-pkm-admin-secret` on all new calendar endpoints and on `POST /telegram/route`

#### `POST /telegram/route`

Purpose:

- classify non-command Telegram input into `pkm_capture`, `calendar_create`, `calendar_query`, or `ambiguous`

High-level input:

- raw Telegram text
- actor identity
- Telegram source ids
- `run_id`
- admin header (`x-pkm-admin-secret`)

High-level output:

- route
- confidence
- optional clarification question

#### `POST /calendar/normalize`

Purpose:

- normalize Telegram calendar intent
- decide whether clarification is needed
- upsert request log state

High-level output:

- `needs_clarification | ready_to_create | rejected`
- missing fields
- normalized event payload
- subject code
- color choice
- block start/end
- original start time
- warning flags
- `request_id`
- malformed normalize inputs should be surfaced as `status="rejected"` payloads (HTTP 200) rather than transport-level 4xx, so workflow branching can return user-facing fallback text without failing the run

High-level input also includes admin header (`x-pkm-admin-secret`).

#### `POST /calendar/finalize`

Purpose:

- let n8n persist create outcome after Google write

High-level input:

- `request_id`
- Google create result
- `google_event_id`
- warnings / error
- final status
- admin header (`x-pkm-admin-secret`)

#### `POST /calendar/observe`

Purpose:

- let n8n log externally authored visible events that were seen during reads or reports

High-level input includes admin header (`x-pkm-admin-secret`).

### 16.3 No backend reporting endpoints

Do **not** add `POST /calendar/report/*` endpoints. Read/report formatting stays in n8n.

---

## 17. Observability and logging requirements

### 17.1 Established practice to follow

Implementation must follow the established backend observability pattern:

- accept `X-PKM-Run-Id` header, or body `run_id` if header absent
- propagate `run_id` through backend context
- emit lightweight transition events to `pkm.pipeline_events`
- log `start` / `end` / `error` with duration and compact summaries
- do **not** place heavy payloads such as `capture_text`, `extracted_text`, or `clean_text` into transition telemetry
- use Braintrust for LLM spans with `run_id` metadata

### 17.2 Calendar-specific logging

For this feature:

- use `src/server/logger`
- use `logger.step(...)` or equivalent established practice for boundary steps
- keep heavy request text in calendar business tables where needed for evaluation, not in `pipeline_events`
- keep external-event observation snapshots compact

### 17.3 If coding agent finds gaps

If implementation details are missing for a particular calendar flow, the coding agent should use the established logger / `pipeline_events` / Braintrust practice already in the repo rather than inventing a new telemetry pattern.

---

## 18. Migration and rollout plan

### 18.1 No historical backfill required

There is no dependency on backfilling old PKM entries.

### 18.2 Required rollout steps

1. add shared config entries and registry updates
2. add new backend API contract docs
3. add prod-only calendar business tables
4. implement backend routing / normalization / finalize / observe flows
5. extend `01 Telegram Router`
6. add workflows:
   - `30 Calendar Create`
   - `31 Calendar Read`
   - `32 Calendar Report` (daily + weekly)
7. share family calendar with Igor and Danijela accounts
8. verify invited events to `pkm.gasovic` appear on the queried family calendar surface
9. verify forwarded visible events appear on the same queried surface

### 18.3 n8n delivery model

Workflow wiring changes must be performed in n8n UI and synced back to repo. Larger JS logic should be externalized under `src/n8n/nodes/...` and kept as thin wrappers in the workflow JSON.

---

## 19. Success criteria

The feature is successful when all of the following are true:

1. Igor and Danijela can create family calendar events through Telegram free text.
2. Missing required fields trigger fluent clarification instead of silent bad inference.
3. Telegram-authored events appear on the family calendar surface with coded subjects.
4. Telegram-authored events use person-driven event colors.
5. Daily report arrives at 05:30 and covers today + next 2 days.
6. Weekly report arrives Sunday at 18:30 and covers next Monday–Sunday.
7. If there are no events today, the daily report explicitly says so.
8. Empty future days are omitted from the daily report.
9. Empty days are omitted from the weekly report.
10. Events created by Igor or Danijela on their own Google calendars and invited to `pkm.gasovic` are visible on the queried family calendar surface and are included in reads and reports.
11. Forwarded visible events are included in reads and reports.
12. Invited / forwarded events are reported as-is in v1.
13. Duplicate Telegram deliveries do not create duplicate family events.
14. Calendar request logs are written to Postgres in prod schema `pkm` and are not affected by `test_mode`.
15. `run_id` can be traced through backend transition telemetry and Braintrust spans.
16. The request logs are rich enough to export later for evaluation and prompt improvement.

---

## 20. Future improvements and TBD

### 20.1 Update / cancel

Not in v1. Requires:

- event matching strategy
- reply-context shortcut design
- ambiguity handling
- safe Google event mutation rules

### 20.2 External event enrichment

Future improvement:

- infer people from organizer / attendees / title / description
- color external visible events with better confidence than grey
- optionally canonicalize external titles without mutating source events

### 20.3 Google event metadata

Future improvement:

- store machine-readable metadata on Telegram-authored Google events where practical
- useful for update/cancel and report rendering

### 20.4 Home Assistant

Out of scope for v1 write path. Future role: downstream display / reminder consumer only.

### 20.5 Recurrence

Out of scope for Telegram create in v1.

### 20.6 Actor allowlist hardening

v1 now enforces creator authorization with shared-config Telegram numeric IDs and separate calendar vs PKM allowlists.

Future improvement:

- replace CSV env allowlists with a structured identity registry that maps Telegram user ids to canonical actor profiles and audit metadata

### 20.7 Endpoint auth hardening

v1 uses shared-secret header auth (`x-pkm-admin-secret`) for calendar endpoints. Future work can split a dedicated n8n service secret or move to stronger service-to-service auth.

### 20.8 Reply-based clarification linking and all-day support

Future improvements:

- bind clarification turns by Telegram reply context instead of latest-open-chat heuristic
- support all-day Telegram event creation with explicit normalization and formatting rules

### 20.9 Observation-log scale controls

If observation volume grows, add retention and/or deduplication policy for `pkm.calendar_event_observations` (for example periodic pruning or unique keys by event/day/kind).

---

## 21. Work packages

See companion document: `family-calendar-work-packages.md`
