# Todoist LLM Planning Assistant PRD

## Title
Todoist LLM Planning Assistant

## Status
Active (V1 implemented)

## Surface owner
PKM / planning workflow

## Scope type
Canonical surface

## Baseline date
2026-04-10

## Related authoritative docs
- docs/api.md
- docs/database_schema.md
- docs/env.md
- docs/config_operations.md
- docs/prd-expectations.md
- AGENTS.md

## Related work-package doc
`docs/PRD/todoist-llm-planning-work-packages.md`

## Use this PRD when
- Adding Todoist-backed planning behavior to PKM
- Changing task normalization, review, ranking, or briefing logic
- Building the PKM UI review surface for task interpretation corrections
- Defining success metrics for the planning assistant

## Fast path by agent
- Coding agent: start with Current behavior, Data model, Sync/state transitions, and Output contracts
- Planning agent: start with Goals, Non-goals, Execution flow, and Success metrics
- Reviewing agent: start with Risks/open questions, Validation/acceptance, and Output contracts
- Architect agent: start with Boundaries and callers, Runtime/config implications, and API/config TBDs

## Section map
1. Purpose
2. Current behavior / baseline
3. Goals
4. Non-goals
5. Boundaries and callers
6. Data model
7. Review model
8. Normalization model
9. Sync / state transitions
10. Ranking and output contracts
11. PKM UI review surface
12. Runtime / topology implications
13. Success metrics
14. Validation / acceptance criteria
15. Risks / open questions
16. TBD

---

## 1. Purpose

Define a narrow v1 planning assistant built on Todoist, n8n, PKM backend, Postgres, and an LLM normalization node.

The assistant does not manage tasks directly. It interprets Todoist tasks, routes risky parses to review, and produces recommendation surfaces:
- daily focus brief
- waiting follow-up radar
- weekly pruning suggestions

The system must prioritize trust, simplicity, and reviewability over maximal automation.

---

## 2. Current behavior / baseline

### User task system baseline
- Todoist is the execution surface for all task management
- Projects in active scope for v1:
  - Home 🏡
  - Personal
  - work
  - Inbox
- Waiting is a first-class section semantics across scoped projects
- Work sections besides Waiting are fluid and must not affect behavior in v1
- Inbox is a capture buffer and should not directly influence planning surfaces
- User sometimes inputs tasks in English, Serbian, or mixed language; output should be English only

### Product baseline for v1
- n8n fetches Todoist projects first, filters to allowed projects, then fetches sections/tasks for those projects only
- backend owns state transitions, normalization calls, review rules, ranking, and database writes
- a LangGraph node performs task normalization only
- PKM UI is a backend correction surface, not a task manager
- close and delete are treated the same in backend lifecycle: `closed`
- parser logic changes do not trigger global reparses in v1
- no dedicated override-history persistence layer in v1; manual overrides directly update current parsed fields and emit an event

---

## 3. Goals

### Primary goals
1. Reduce overdue task sprawl
2. Surface a realistic daily focus set at 5:45am
3. Prevent low-quality or risky parses from polluting recommendation surfaces
4. Make waiting/follow-up work more actionable, including grouped nudges by likely person/entity
5. Provide a fast correction loop through PKM UI so backend interpretation errors can be fixed quickly
6. Preserve enough event history to later expand eval coverage and behavior analysis

### Secondary goals
1. Keep architecture simple and explainable
2. Make ranking weights configurable
3. Use deterministic logic for selection and LLM only for normalization + rationale wording
4. Keep v1 narrow enough to ship and evaluate without large automation risk

---

## 4. Non-goals

### Explicit non-goals for v1
- writing normalized titles back to Todoist
- changing Todoist lifecycle/project/section/due fields from PKM UI
- persistent override history beyond append-only task events
- parser versioning as a user-visible/runtime surface
- global reparse when parser logic changes
- full task-manager functionality inside PKM UI
- label automation as a core system behavior
- LLM-driven ranking/selection
- closed-task fetch for stronger completion semantics
- Inbox tasks participating directly in briefs

---

## 5. Boundaries and callers

### Todoist
Source of truth for:
- task existence
- title
- description
- project
- section
- due state
- priority

### n8n
Owns:
- scheduled triggers
- Todoist API fetches
- allowed-project filtering
- section resolution for scoped projects
- backend endpoint calls
- downstream delivery of daily/weekly outputs

### PKM backend
Owns:
- `todoist_task_current` reconciliation
- `todoist_task_events` writes
- lifecycle transitions
- parse trigger decisions
- LangGraph normalization invocation
- validation + fallback behavior
- deterministic review rules
- deterministic ranking and grouping
- JSON output assembly for all briefs
- LLM rationale generation on already-selected items

### LangGraph normalization node
Owns:
- conservative task normalization only
- strict JSON output for parsed fields only

Does not own:
- lifecycle state
- review status
- ranking
- grouping
- DB writes

### PKM UI
Owns:
- review queue
- parsed-field inspection
- accept action
- override action
- read-only event history display

Does not own:
- raw Todoist editing
- task closure
- due/priority/project/section edits

---

## 6. Data model

### `todoist_task_current`
One row per Todoist task, representing latest backend understanding.

Fields:
- `id`
- `todoist_task_id`
- `todoist_project_id`
- `todoist_project_name`
- `todoist_section_id`
- `todoist_section_name`
- `raw_title`
- `raw_description`
- `todoist_priority`
- `todoist_due_date`
- `todoist_due_string`
- `todoist_due_is_recurring`
- `project_key` (`home | personal | work | inbox`)
- `lifecycle_status` (`open | waiting | closed`)
- `normalized_title_en`
- `task_shape` (`project | next_action | micro_task | follow_up | vague_note | unknown`)
- `suggested_next_action`
- `parse_confidence`
- `review_status` (`needs_review | no_review_needed | accepted | overridden`)
- `todoist_added_at`
- `last_seen_at`
- `waiting_since_at`
- `closed_at`
- `parsed_at`

### `todoist_task_events`
Append-only event log.

Fields:
- `id`
- `task_id`
- `event_at`
- `event_type`
- `changed_fields`
- `before_json`
- `after_json`
- `reason`

Core event types:
- `first_seen`
- `title_changed`
- `description_changed`
- `project_changed`
- `section_changed`
- `entered_waiting`
- `left_waiting`
- `closed`
- `reopened`
- `parse_updated`
- `parse_failed`
- `review_accepted`
- `override_applied`

---

## 7. Review model

### Review states
- `needs_review`
- `no_review_needed`
- `accepted`
- `overridden`

### Review precedence
1. Manual states win if still current
2. Parser fallback failure -> `needs_review`
3. Inbox tasks -> `needs_review`
4. Confidence below threshold -> `needs_review`
5. Waiting confidence below stricter threshold -> `needs_review`
6. Risky shapes (`project`, `vague_note`, `unknown`) -> `needs_review`
7. Waiting + inferred next action -> `needs_review`
8. Reparse after override -> `needs_review`
9. Otherwise -> `no_review_needed`

### Inbox rule
All `project_key = inbox` tasks are always `needs_review` with high queue priority.

### Manual correction model
- Accept: marks current parse as accepted
- Override: directly overwrites current parsed fields and emits `override_applied`
- No dedicated override-history table in v1
- A later reparse may overwrite a prior manual override in v1

---

## 8. Normalization model

### Inputs to LangGraph node
- `raw_title`
- `raw_description`
- `project_key`
- `todoist_section_name`
- `lifecycle_status`

### Output schema
- `normalized_title_en`
- `task_shape`
- `suggested_next_action`
- `parse_confidence`

### Normalization principles
- English-only output
- preserve meaning rather than optimize phrasing
- prefer `unknown` over fake certainty
- prefer `null` next action over invented next action
- treat Waiting as context, not proof
- do not infer urgency, owner, or duration

### Validation / fallback
- strict JSON parse
- deterministic cleanup only
- no second LLM repair pass in v1
- fallback on invalid output:
  - `normalized_title_en = raw_title`
  - `task_shape = unknown`
  - `suggested_next_action = null`
  - `parse_confidence = 0.0`
  - `review_status = needs_review`
- emit `parse_failed` event on fallback

### LangGraph note
Task normalization is implemented as a LangGraph node and must be covered by evals.

---

## 9. Sync / state transitions

### n8n-side sequence
1. fetch projects
2. filter to allowed project set
3. fetch sections for allowed projects
4. fetch active tasks for allowed projects
5. build resolved sync payload
6. call backend sync surface

### Allowed projects in v1
- Home 🏡
- Personal
- work
- Inbox

### Project mapping
- `Home 🏡` -> `home`
- `Personal` -> `personal`
- `work` -> `work`
- `Inbox` -> `inbox`

### Lifecycle mapping
- section `Waiting` -> `waiting`
- other active sections -> `open`
- absent from active fetch -> `closed`

### Reparse triggers
Reparse when:
- title changes
- description changes
- `project_key` changes
- task enters Waiting
- task leaves Waiting
- task reopens

Do not reparse when only:
- due changes
- priority changes
- non-Waiting section changes
- display-name-only changes that do not affect `project_key`

### Key transitions
- first seen -> insert row, parse, emit `first_seen`
- entered Waiting -> set `waiting_since_at`, reparse, recompute review
- left Waiting -> clear `waiting_since_at`, reparse, recompute review
- disappeared -> mark `closed`, emit `closed`
- reopened -> restore active state, reparse, recompute review

---

## 10. Ranking and output contracts

### General build rule for all outputs
Use hybrid generation:
- deterministic selection/ranking/grouping/JSON assembly
- LLM writes rationale text only

LLM does not:
- choose tasks
- reorder tasks
- assign recommendation types
- override grouping

### A. Daily focus brief
Purpose: 5:45am daily planning surface.

Deterministic sections:
1. `top_3`
2. `overdue_now`
3. `waiting_nudges`
4. `quick_win`

Rules:
- exclude `closed`
- exclude `needs_review`
- exclude `inbox`
- use only `home`, `personal`, `work`
- max 2 work items in top 3
- include at least 1 overdue item somewhere if a safe overdue item exists
- waiting nudges capped and grouped by likely person/entity when possible

Rationale text is written by LLM after deterministic shortlist selection.

### B. Waiting follow-up radar
Purpose: highlight waiting items most worth nudging now.

Rules:
- only waiting tasks
- exclude `needs_review`
- exclude `inbox`
- deterministic waiting-age scoring
- deterministic grouping by person/entity when reasonably clear
- LLM writes `why_nudge` only

### C. Weekly pruning suggestions
Purpose: surface tasks that should probably not stay exactly as they are.

Recommendation types:
- `delete`
- `defer`
- `convert_to_next_action`
- `keep_waiting`
- `keep_as_note`
- `move_to_someday`

Rules:
- consider open and waiting tasks
- include `needs_review` tasks here
- exclude `inbox`
- deterministic prune scoring
- deterministic recommendation assignment
- LLM writes `why_recommended` only

---

## 11. PKM UI review surface

### Role
PKM UI is a review/correction surface for backend fields only.

### Main views
- Needs review
- Unreviewed
- Accepted
- Overridden
- All

### Default Needs review sorting
1. inbox
2. waiting
3. low confidence first
4. work -> personal -> home
5. older Todoist tasks first

### Editable fields
- `normalized_title_en`
- `task_shape`
- `suggested_next_action`

### Actions
- Accept
- Override
- Re-run parse
- Next item

### Non-goals
- editing Todoist source fields
- completing tasks
- moving tasks between sections/projects
- due edits
- bulk overrides
- reverting to prior override state

---

## 12. Runtime / topology implications

### Runtime roles
- n8n: orchestration + scheduled fetch/delivery
- backend: sync/state/ranking/rationale orchestration
- LangGraph: normalization node
- LiteLLM: model gateway
- Postgres: persistence
- PKM UI: review surface

### Config implications
The API contract is implemented in `docs/api_todoist.md`. Remaining tuning knobs for this surface include:
- project allowlist
- review thresholds
- ranking weights
- schedule timing
- output caps

---

## 13. Success metrics

### Primary success metrics
1. **Overdue reduction**
   - median count of overdue active tasks decreases after adoption
   - target direction: down, measured weekly

2. **Daily brief usefulness**
   - percentage of days where at least one Top 3 task is completed same day
   - target direction: up

3. **Review queue containment**
   - Needs review queue does not grow without bound
   - practical target: median time-to-review for new Inbox items and risky parses remains low enough that briefs stay trusted

4. **Parse trust**
   - low rate of manual correction among items marked `no_review_needed`
   - target direction: down

5. **Waiting hygiene**
   - waiting items older than threshold decrease over time or are actively cycled through nudges/pruning
   - target direction: fewer stale waiting items

### Secondary success metrics
1. **Brief adoption**
   - user opens / consumes daily brief consistently
2. **Correction efficiency**
   - median time to accept/override a review item stays low
3. **Inbox processing**
   - Inbox items do not linger unreviewed for long
4. **Pruning effectiveness**
   - weekly pruning suggestions lead to real task cleanup decisions

### Anti-metrics / failure signals
- overdue count stays flat or increases
- top 3 regularly filled with low-value busywork
- many manual overrides on supposedly safe items
- review queue becomes too large to process
- waiting nudges feel noisy or repetitive

---

## 14. Validation / acceptance criteria

### Minimum functional acceptance
1. Allowed-project sync works through n8n -> backend path
2. Current/task event tables update correctly across key transitions
3. LangGraph normalization produces valid parse or safe fallback
4. Inbox tasks always route to `needs_review`
5. Review queue can accept and override parsed fields
6. Daily brief JSON is generated deterministically with LLM rationale text attached
7. Waiting radar JSON is generated deterministically with grouped nudges when clear
8. Weekly pruning JSON is generated deterministically with bounded recommendation types

### Trust acceptance
1. Parse failures never silently enter recommendation surfaces
2. `needs_review` items are excluded from daily focus and waiting radar
3. Overridden items can later be reparsed and return to review when appropriate
4. All surfaced rationale text is based only on deterministic shortlist input

### Usability acceptance
1. Review queue default sort feels operationally sensible
2. Accept / override / next-item loop is fast enough for regular use
3. Brief outputs are small enough to scan quickly

---

## 15. Risks / open questions

### Open questions intentionally parked
1. Should reviewed `project` tasks get a controlled “big thing” slot in the daily brief?
2. Should waiting-group extraction remain purely heuristic, or later use an LLM fallback?
3. Should some personal/home vague items migrate to a note surface later?

### Risks
1. Conservative review routing may keep too many important-but-broad tasks out of the daily brief
2. Parser errors on mixed-language shorthand may still be common early on
3. Waiting grouping may under-group if the heuristic is too cautious
4. Overwrite-on-reparse may occasionally replace a useful manual correction in v1
5. Weekly pruning may feel naggy if caps and scoring are not tuned carefully

---

## 16. TBD

- Config surface ownership and exact config file/DB placement for long-term tuning ergonomics
- Eval plan and corpus design for normalization/ranking quality tracking
- Success metric thresholds / baselines once first instrumentation exists
- Whether daily brief should later include a reviewed “big thing worth advancing” slot
