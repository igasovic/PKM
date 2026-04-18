# PRD — Failure Pack Capture, Analysis, And Codex Retrieval For n8n / PKM

Status: active  
Surface owner: n8n failure capture + PKM failure tracking surface  
Scope type: canonical surface  
Baseline date: 2026-04-17  
Related authoritative docs: `docs/api.md`, `docs/database_schema.md`, `docs/env.md`, `docs/n8n_sync.md`, `docs/prd-expectations.md`  
Related work-package docs:
- `docs/PRD/failure-pack-wp1-root-dedupe-and-write-path.md`
- `docs/PRD/failure-pack-wp2-analysis-lifecycle-and-ui.md`
- `docs/PRD/failure-pack-wp3-codex-access-and-sidecars.md`

## Purpose

Define the failure-pack surface for:

- durable n8n failure capture,
- idempotent collapse of duplicate failure reports within one propagated failure tree,
- operator and agent retrieval,
- agent-authored analysis tracking,
- sidecar copy for local Codex analysis.

This PRD replaces the earlier v1 assumption that `run_id` is the correct write/upsert key for the failure-pack row.

## Use this PRD when

- changing WF99 failure-pack capture or write semantics,
- changing the persistence shape of `pkm.failure_packs`,
- changing failure-status lifecycle or analysis/resolution behavior,
- changing Codex-facing failure retrieval or sidecar-copy flows,
- changing the Failures page in the PKM debug UI.

## Fast path by agent

- Coding agent: read `Status and scope boundary`, `Current behavior`, `Target behavior`, `Write path`, `Data model`, `API and webhook surface`, `Sidecars`, and `Status model`.
- Planning agent: read `Problem`, `Goal`, `Scope boundary`, `Key product decisions`, and `Work-package split`.
- Reviewing agent: read `Contract delta table`, `Data model`, `Status model`, `API and webhook surface`, `Security and access model`, and `Risks`.
- Architect agent: read `Scope boundary`, `Write path`, `Deduplication model`, `API and webhook boundary`, and `Codex access model`.

## Section map

- Why this change exists: `Problem`, `Goal`
- Current vs target behavior: `Current behavior`, `Target behavior`, `Contract delta table`
- Capture and dedupe flow: `Write path`, `Deduplication model`
- Retrieval and agent flow: `API and webhook surface`, `Codex access model`, `Sidecars`
- Persistence and lifecycle: `Data model`, `Status model`
- Delivery plan: `Work-package split`

---

## Status and scope boundary

This PRD owns:

- WF99 failure-pack capture,
- propagated root execution correlation for nested workflow failures,
- PKM persistence of failure rows and analysis fields,
- PKM debug UI Failures page as a consumer of this surface,
- Codex-oriented retrieval and sidecar-copy flow,
- n8n webhook façade for non-UI agent operations.

This PRD does not own:

- generalized observability or log-search platform design,
- non-n8n execution paths,
- autonomous code application or self-healing,
- raw n8n execution browsing as the primary debugging interface,
- generalized ticketing or issue-tracker integration.

---

## Problem

Today all relevant workflows can trigger WF99 on failure. In nested execution chains such as:

- `WF01 -> WF02 -> WF22`

a single child failure can generate multiple WF99 invocations at different workflow boundaries. The current model stores each report independently, which produces duplicate failure entries for one logical incident.

That duplicate behavior was tolerable for manual debugging but becomes harmful once a coding agent or operator starts pulling “new failures” as work items.

At the same time, capturing only at the top-level orchestrator is not acceptable, because the most useful debugging context exists at the local failing workflow boundary:

- the real failing workflow execution id,
- the real failing node,
- failing node input,
- immediate prior-node context,
- local sidecars.

The design therefore needs to do both:

1. keep the local detailed capture where the failure actually happened,
2. collapse duplicate reports from the same propagated failure tree into one logical failure row.

A second gap is that the current failure-pack surface stores the raw failure record but does not provide a simple lifecycle for agent analysis:

- newly captured,
- analyzed with explanation and proposed fix,
- resolved by operator action in the UI.

A third gap is that Codex needs a safe way to retrieve a failure and its sidecars without becoming a first-class backend client.

---

## Goal

Add a first-class diagnostics and analysis path where:

1. every workflow in a nested failure tree propagates a shared `root_execution_id`,
2. WF99 keeps local detailed capture at the failing workflow boundary,
3. PKM stores one logical failure row per `root_execution_id`,
4. later duplicate reports for the same `root_execution_id` update the existing row instead of inserting a new row,
5. the canonical failing workflow identity remains separate from the list of propagation reporters,
6. the agent can submit explanation and proposed fix text without writing code or mutating runtime state,
7. the UI can mark a failure as resolved,
8. Codex can retrieve failure details and copy sidecars through a script layer without becoming a general backend client.

---

## Current behavior

Current baseline:

- WF99 captures a normalized failure pack for a failed workflow execution.
- PKM persists failure-pack metadata and full `pack` JSON in `pkm.failure_packs`.
- The earlier PRD models write/upsert by `run_id`.
- The earlier PRD models a capture-oriented status concept centered on `captured`, `partial`, and `failed`.
- The earlier PRD assumes failure-pack retrieval by backend endpoints and a one-call bundle path.

Current shortcomings:

- nested failure propagation creates duplicate rows,
- `run_id` is not the right logical dedupe key for nested workflow failure trees,
- top-level-only capture loses useful child-workflow detail,
- there is no minimal agent lifecycle for explanation/proposed fix,
- there is no explicit operator resolve flow,
- there is no Codex script layer contract for open-failure polling and sidecar copy.

---

## Target behavior

### Capture and dedupe

- Every relevant workflow propagates `root_execution_id`.
- WF99 still captures at the local failing workflow boundary.
- First report for a given `root_execution_id` inserts a failure row.
- Later reports for the same `root_execution_id` update the existing row.
- The update path appends `reporting_workflow_names`.
- The update path does not replace the canonical failing workflow id/name captured on first insert.
- Repeated identical failures in a later, separate top-level run are new failures and must insert a new row.

### Lifecycle

Failures move through one minimal status model:

- `captured`
- `analyzed`
- `resolved`

The agent can only provide:

- `analysis_reason`
- `proposed_fix`

The agent does not apply a fix and does not mutate runtime state.

The UI can mark a failure as resolved from any prior state. For v1, resolved is terminal.

### Retrieval

- The UI can list current `captured` failures with summary metadata.
- Codex scripts can list open failures, fetch one failure, copy all sidecars for one failure, and submit analysis.
- Codex scripts prefer local trusted-network access when available and otherwise fall back to n8n webhook access.
- Non-UI agent operations are exposed through n8n webhook façades so PKM UI and n8n remain the only backend API consumers.

---

## Contract delta table

| Surface | Changes? | Baseline known? | Notes |
|---|---|---|---|
| n8n failure write path | yes | yes | propagate `root_execution_id`; update insert/update semantics |
| PKM backend failure endpoints | yes | yes | add analyze, resolve, open-failure read semantics; keep backend owned by PKM |
| n8n webhook façade | yes | no | new façade for Codex-facing read/analyze actions |
| Database schema | yes | yes | minimal additive changes to `pkm.failure_packs` |
| Sidecar handling | yes | partial | backend still stores metadata; copy is local script over SSH |
| PKM debug UI | yes | yes | Failures page gains analysis and resolve actions |
| Codex scripts | yes | no | new script surface and agent instructions |
| Docs | yes | yes | PRD, API docs, DB schema docs, any Failures-page docs |

---

## Key product decisions

### 1. Logical failure identity

`root_execution_id` is the logical failure key for collapse of duplicate reports within one propagated failure tree.

`execution_id` remains the local failing workflow execution id and is stored as recorded fact.

### 2. Dedupe boundary

Deduplication applies only within one propagated failure tree.

Rules:

- same `root_execution_id` -> update existing row
- different `root_execution_id` -> insert new row, even if the workflow name, node name, and error text are identical

### 3. Canonical failing workflow vs propagation reporters

Keep the canonical failing workflow separate from propagation reporters.

Use:

- existing canonical `workflow_id` / `workflow_name` columns for the actual failing workflow captured on first insert,
- new `reporting_workflow_names text[]` for the names of outer workflows that also reported the same logical failure.

This array is propagation-only and must not replace the canonical failing workflow fields.

### 4. Single lifecycle status

Use only one status field with three values:

- `captured`
- `analyzed`
- `resolved`

Remove the earlier capture-quality lifecycle from top-level row status.

### 5. Agent role

The agent may submit explanation and proposed fix text only.

The agent may not:

- mark resolved,
- apply code changes through this surface,
- mutate workflow runtime state,
- mutate sidecars.

### 6. Resolve behavior

Resolve is an explicit PKM UI action.

Rules:

- it can set `status = resolved` from any prior state,
- it does not require the failure to be analyzed first,
- it is terminal for v1.

### 7. Sidecar copy model

Sidecars remain on the Pi shared data path and are referenced through relative paths stored in `pack.artifacts`.

Codex does not fetch sidecars through backend APIs. A local helper script copies all sidecars for one failure over SSH into a gitignored local directory.

### 8. Backend API ownership rule

PKM UI and n8n are the only backend API consumers.

Therefore:

- PKM backend still owns the failure data model and row updates,
- PKM UI may call backend APIs directly,
- Codex-facing remote operations go through n8n webhook façades,
- local helper scripts may prefer the existing trusted local reachability path when available, but that does not create a new public backend surface.

---

## Write path

### Initial insert path

1. A workflow execution fails.
2. The workflow passes or reconstructs `root_execution_id`.
3. WF99 receives the local failure event with:
   - `root_execution_id`
   - local failing `execution_id`
   - failing workflow id/name
   - failing node metadata
   - error details
   - local payload context and sidecars
4. WF99 writes sidecars first to the shared storage root if needed.
5. WF99 builds the normalized failure-pack envelope.
6. WF99 posts the envelope to PKM through the existing backend write path.
7. PKM checks for an existing row keyed by `root_execution_id`.
8. If none exists:
   - insert the row,
   - set canonical failing workflow fields from this first insert,
   - initialize `reporting_workflow_names` with the current reporting workflow if it differs from the canonical failing workflow.

### Duplicate report update path

If a row already exists for `root_execution_id`:

- do not insert a second row,
- append the new reporting workflow name if not already present,
- keep canonical failing workflow id/name unchanged,
- keep local failing `execution_id` from the first canonical insert unchanged for v1,
- update `updated_at`,
- do not reopen a resolved row.

### Repeated later incidents

If the same workflow fails again in a separate top-level run:

- the new run has a different `root_execution_id`,
- PKM inserts a new row,
- later agent or operator logic may recognize that it is semantically similar, but storage does not collapse those rows.

---

## Data model

### Table

Continue using `pkm.failure_packs`.

### Existing retained fields

Retain the current failure-pack fields that still matter, including:

- `failure_id`
- `created_at`
- `updated_at`
- `run_id`
- `execution_id`
- `workflow_id`
- `workflow_name`
- `failed_at`
- `node_name`
- `node_type`
- `error_name`
- `error_message`
- `has_sidecars`
- `sidecar_root`
- `pack`

### Minimal new fields

Add:

- `root_execution_id text not null`
- `reporting_workflow_names text[] not null default '{}'`
- `status text not null default 'captured'`
- `analysis_reason text`
- `proposed_fix text`
- `analyzed_at timestamptz`

### Removed top-level meaning

The previous top-level status semantics of `captured | partial | failed` are removed from the PRD model.

### Recommended indexes

Add or update indexes for:

- unique `(root_execution_id)`
- `(status, failed_at desc)`
- partial `(failed_at desc) where status = 'captured'`
- `(workflow_name, failed_at desc)`
- `(node_name, failed_at desc)`

### Notes

- `run_id` remains useful correlation metadata and may remain unique only if current production behavior requires it, but it is no longer the logical failure-row dedupe key in this PRD.
- If the implementation must relax a current unique index on `run_id`, that must be called out explicitly in the migration and docs.
- `reporting_workflow_names` stores propagation reporters only, not the full execution chain.

---

## Status model

### States

- `captured`
- `analyzed`
- `resolved`

### Transitions

#### Captured -> analyzed
Triggered by the analyze API.

Effects:

- write `analysis_reason`
- write `proposed_fix`
- set `analyzed_at = now()`
- set `status = analyzed`

#### Captured -> resolved
Triggered by PKM UI resolve action.

Effects:

- set `status = resolved`

#### Analyzed -> analyzed
Allowed for overwrite.

Effects:

- replace `analysis_reason`
- replace `proposed_fix`
- refresh `analyzed_at`

#### Analyzed -> resolved
Triggered by PKM UI resolve action.

Effects:

- set `status = resolved`

#### Resolved
Terminal for v1.

Later duplicate propagation reports may still append new reporter names and update `updated_at`, but they must not reopen the row.

---

## API and webhook surface

## Backend-owned surface

PKM backend continues to own persistence and the canonical failure row contract.

### 1. Write / upsert

`POST /debug/failures`

Purpose:

- WF99 writes or updates a failure row keyed by `root_execution_id`.

Behavior:

- insert on first `root_execution_id`
- update on later duplicate reports for same `root_execution_id`
- append `reporting_workflow_names`
- return stored identifiers and action

### 2. Read one

`GET /debug/failures/:failure_id`

Purpose:

- PKM UI retrieves one failure row and full pack

### 3. Read captured failures

`GET /debug/failures/open`

Purpose:

- PKM UI reads failures where `status = captured`

Response should include summary rows, not ids only:

- `failure_id`
- `failed_at`
- `workflow_name`
- `node_name`
- `has_sidecars`
- `status`

### 4. Analyze one

`POST /debug/failures/:failure_id/analyze`

Purpose:

- n8n webhook façade or local trusted helper submits agent analysis text

Body:

- `analysis_reason`
- `proposed_fix`

Behavior:

- valid only when current status is `captured` or `analyzed`
- overwrite allowed
- set `status = analyzed`
- set `analyzed_at = now()`

### 5. Resolve one

`POST /debug/failures/:failure_id/resolve`

Purpose:

- PKM UI marks a failure resolved

Behavior:

- set `status = resolved` regardless of prior state
- terminal for v1

## n8n webhook façade

For Codex-facing operations that are not PKM-UI-exclusive, expose n8n webhook façades backed by the backend endpoints above.

Minimum façade operations:

- list current captured failures
- get one failure by `failure_id`
- submit analysis for one failure

These webhook façades exist so PKM UI and n8n remain the only direct backend API consumers.

---

## Sidecars

### Storage model

Retain the current shared-disk model:

- sidecars written by WF99 to the shared mounted path,
- relative artifact references stored in `pack.artifacts`.

### Copy model

Add a local helper script that:

1. resolves a failure row and its artifact list,
2. copies all related sidecars from Pi to a local gitignored folder over SSH,
3. returns the local destination paths for Codex.

### Local destination

Use a gitignored local folder such as:

- `.codex/failure-sidecars/<failure_id>/`

The exact folder name is implementation-owned, but it must be gitignored and stable.

### Copy scope

For v1, copy all sidecars for one failure id. No per-artifact selection is required.

---

## Codex access model

Codex interacts with this surface only through local helper scripts.

Recommended scripts:

- `list-open-failures`
- `get-failure <failure_id>`
- `copy-failure-sidecars <failure_id>`
- `analyze-failure <failure_id> --reason-file <path> --fix-file <path>`

### Access order

Scripts prefer:

1. local trusted-network access path when available,
2. n8n webhook fallback when not.

This is a transport decision inside the script layer, not a separate product surface.

### Non-goals

This surface does not make Codex:

- a general backend client,
- a general n8n API client,
- a sidecar browser over raw SSH without helper constraints.

---

## PKM debug UI

The Failures page remains in scope and gains:

- recent captured failures list,
- analysis display,
- resolve action,
- detail view for one failure,
- sidecar metadata visibility.

V1 UI does not need:

- bulk actions,
- reopen action,
- issue-tracker integration,
- code-apply flow.

---

## Security and access model

- secrets stay off-repo,
- PKM backend remains admin-protected,
- PKM UI is local-network constrained,
- Codex scripts should not hold raw backend credentials as a general-purpose interface,
- remote Codex usage should prefer the n8n webhook façade,
- sidecar copy uses constrained helper logic and relative artifact paths,
- no backend path traversal is allowed when resolving artifact metadata.

---

## Validation and acceptance criteria

This change is complete when all of the following are true:

1. A nested failure tree such as `WF01 -> WF02 -> WF22` produces one failure row keyed by `root_execution_id`.
2. That one row preserves the local failing workflow identity from the first insert.
3. Later WF99 calls from parent workflows append `reporting_workflow_names` without creating extra rows.
4. A repeated later incident with a different `root_execution_id` creates a new row even if the failure text is identical.
5. `GET /debug/failures/open` returns summary rows for `captured` failures.
6. Agent analysis can move a row to `analyzed` and store explanation plus proposed fix.
7. PKM UI can mark a row `resolved`.
8. Resolved rows are not reopened by later duplicate reports for the same `root_execution_id`.
9. Sidecar copy works from Pi to a local gitignored folder for one `failure_id`.
10. Codex instructions can complete the full read-analyze path using scripts only.

---

## Risks

- migration from `run_id`-keyed assumptions to `root_execution_id`-keyed row identity may require careful constraint/index changes,
- workflows that fail to propagate `root_execution_id` will bypass intended dedupe,
- first-insert canonical identity may be wrong if propagation ordering is inconsistent,
- remote Codex usage depends on webhook auth and reliability,
- repeated overwrite of analysis text may hide earlier drafts,
- terminal resolved state may be too rigid if operator needs reopen later.

---

## Open questions / REVIEW_REQUIRED

### REVIEW_REQUIRED: exact handling of existing `run_id` uniqueness
The current table and prior PRD assume strong row identity around `run_id`. The migration must state explicitly whether:

- `run_id` remains unique as a recorded per-failure fact,
- or uniqueness moves fully to `root_execution_id`.

This must be verified against current code and current write behavior before implementation.

### REVIEW_REQUIRED: canonical first-insert selection
The target model keeps the canonical failing workflow from the first insert for a given `root_execution_id`. This assumes the first report received is also the most local and useful one. That should be verified against actual WF99 invocation ordering in nested workflow failures.

---

## Work-package split

- `failure-pack-wp1-root-dedupe-and-write-path.md`
- `failure-pack-wp2-analysis-lifecycle-and-ui.md`
- `failure-pack-wp3-codex-access-and-sidecars.md`
