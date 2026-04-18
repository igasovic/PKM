# Work Packages — Failure Pack Root Dedupe, Analysis Lifecycle, and Codex Access

Status: active companion  
Related PRD: `docs/PRD/failure-pack-prd.md`

Read this alongside the canonical PRD. This companion breaks the work into implementation slices and does not replace the canonical surface owner.

---

# WP1 — Failure Pack Root Dedupe And Write Path

Status: active companion  
Related PRD: `docs/PRD/failure-pack-prd.md`

## Goal

Change failure-pack write semantics so one propagated failure tree produces one stored failure row while preserving local failing-workflow detail.

## Scope

- propagate `root_execution_id` through relevant workflows,
- keep local failing `execution_id` on the row,
- change failure-pack insert/update logic from `run_id`-centric assumptions to `root_execution_id`-centric logical identity,
- append `reporting_workflow_names` on duplicate reports,
- preserve canonical failing `workflow_id` / `workflow_name` from first insert,
- keep sidecar and pack write semantics compatible with the new dedupe model.

## Components touched

- `wf99` workflow wiring and helper logic
- parent -> child workflow payload propagation
- PKM write endpoint for `POST /debug/failures`
- DB migration and persistence logic
- `docs/api.md`
- `docs/database_schema.md`
- failure-pack PRD

## Deliverables

- propagated `root_execution_id` contract for nested workflows
- updated failure-pack write contract
- DB migration for minimal new fields and indexes
- deterministic insert/update behavior keyed by logical failure tree

## Required behavior

### Insert
When PKM sees a new `root_execution_id`:

- insert one row,
- store the local failing `execution_id`,
- store canonical failing `workflow_id` / `workflow_name`,
- store failure details and pack,
- initialize `reporting_workflow_names`.

### Update
When PKM sees an existing `root_execution_id`:

- do not insert a second row,
- append the current reporting workflow name if new,
- keep canonical failing workflow fields unchanged,
- keep the first local failing `execution_id` unchanged for v1,
- update `updated_at`,
- do not reopen a resolved row.

### Separate incidents
A later, separate incident with a different `root_execution_id` must insert a new row even if all visible failure details match.

## DB changes

Minimal additive schema changes to `pkm.failure_packs`:

- `root_execution_id text not null`
- `reporting_workflow_names text[] not null default '{}'`

Index/constraint target:

- unique `(root_execution_id)`
- review current `run_id` uniqueness and update only if required by actual implementation

This work package must not add a second failure table.

## Acceptance criteria

- nested failure tree writes one row keyed by `root_execution_id`
- duplicate parent-level WF99 calls update the existing row
- `reporting_workflow_names` stores propagation reporters only
- canonical failing workflow fields are not replaced during duplicate updates
- repeated later incidents with different `root_execution_id` create new rows
- sidecar metadata still resolves correctly after the new write path

## Test cases

- single workflow failure, no nested propagation
- `WF01 -> WF02 -> WF22` with child failure
- duplicate parent workflow report names do not double-append
- repeated separate run with same failure text inserts a new row
- resolved row receives later duplicate report for same `root_execution_id` and remains resolved
- missing `root_execution_id` is rejected or explicitly handled according to final contract

## Risks

- wrong `root_execution_id` propagation will defeat dedupe
- current `run_id` uniqueness may conflict with the target model
- first-insert canonical workflow may be wrong if event ordering is not what is assumed

## Out of scope

- analysis lifecycle
- UI resolve action
- Codex-facing scripts
- sidecar local copy implementation


---

# WP2 — Failure Analysis Lifecycle And UI

Status: active companion  
Related PRD: `docs/PRD/failure-pack-prd.md`

## Goal

Add the minimal operator/agent lifecycle for failure rows:

- newly captured,
- analyzed with explanation and proposed fix,
- resolved by explicit UI action.

## Scope

- define one status field with `captured | analyzed | resolved`
- add minimal analysis text fields to `pkm.failure_packs`
- add analyze endpoint
- add resolve endpoint
- add “read captured failures” endpoint for summary rows
- update PKM debug UI Failures page to display analysis and resolve failures

## Components touched

- PKM backend failure endpoints
- `pkm.failure_packs` schema
- PKM debug UI Failures page
- `docs/api.md`
- `docs/database_schema.md`
- failure-pack PRD

## DB changes

Minimal additive schema changes to `pkm.failure_packs`:

- `status text not null default 'captured'`
- `analysis_reason text`
- `proposed_fix text`
- `analyzed_at timestamptz`

Do not add a second status field for v1.

Do not add `resolved_at` for v1.

## Status rules

### Status values

- `captured`
- `analyzed`
- `resolved`

### Analyze behavior

Analyze endpoint:

- writes `analysis_reason`
- writes `proposed_fix`
- sets `status = analyzed`
- sets `analyzed_at = now()`

Overwrite is allowed when current status is already `analyzed`.

### Resolve behavior

Resolve endpoint:

- sets `status = resolved`
- allowed from any prior state
- terminal for v1

### Duplicate-report behavior

Later duplicate propagation reports for the same `root_execution_id` may still update reporter metadata, but must not reopen a resolved row.

## API target

### 1. Read captured failures
`GET /debug/failures/open`

Return summary rows, not ids only:

- `failure_id`
- `failed_at`
- `workflow_name`
- `node_name`
- `has_sidecars`
- `status`

### 2. Read one failure
`GET /debug/failures/:failure_id`

Return full detail for UI display.

### 3. Analyze one failure
`POST /debug/failures/:failure_id/analyze`

Body:

- `analysis_reason`
- `proposed_fix`

### 4. Resolve one failure
`POST /debug/failures/:failure_id/resolve`

No additional body required for v1.

## UI scope

Add or update Failures page behavior so operator can:

- list current captured failures,
- open a failure detail view,
- view any stored analysis text,
- mark a failure resolved.

V1 UI does not need:

- reopen action,
- bulk resolve,
- assignment,
- activity history beyond normal timestamps.

## Acceptance criteria

- newly written rows default to `captured`
- open-failure list returns only `captured` rows
- analyze action stores explanation and proposed fix and sets `analyzed`
- analyze action refreshes `analyzed_at`
- resolve action sets `resolved` regardless of prior state
- resolved rows do not appear in the open-failure list
- Failures page exposes the full minimal lifecycle

## Test cases

- insert new row and verify default `captured`
- analyze captured row
- analyze already analyzed row and verify overwrite
- resolve captured row
- resolve analyzed row
- verify resolved rows drop from open list
- verify duplicate propagation update does not reopen resolved row

## Risks

- removing old capture-oriented status semantics may conflict with current code assumptions
- overwrite-only analysis model may hide earlier drafts
- terminal resolved state may be too rigid if operators later need reopen

## Out of scope

- issue tracker integration
- assignment / ownership
- historical analysis revision log
- autonomous fix application


---

# WP3 — Codex Access And Sidecars

Status: active companion  
Related PRD: `docs/PRD/failure-pack-prd.md`

## Goal

Give Codex a safe, script-mediated way to:

- discover captured failures,
- fetch one failure,
- copy all related sidecars locally,
- submit analysis text,

without making Codex a first-class backend or n8n runtime client.

## Scope

- define Codex helper script surface
- define local-first and webhook-fallback transport policy
- define n8n webhook façade requirements for non-UI agent operations
- define sidecar copy behavior over SSH
- define the local gitignored destination for copied sidecars
- define agent instructions for using the scripts

## Components touched

- local helper scripts
- n8n webhook workflows or routes used as façades
- PKM backend endpoints consumed by those façades
- gitignore for local sidecar destination
- `docs/failure-pack-codex.md`
- failure-pack PRD

## Script surface

Use one script per action.

### 1. `list-open-failures`
Purpose:

- return summary rows for failures where `status = captured`

Expected output includes at least:

- `failure_id`
- `failed_at`
- `workflow_name`
- `node_name`
- `has_sidecars`

### 2. `get-failure <failure_id>`
Purpose:

- return full normalized failure detail for one failure

### 3. `copy-failure-sidecars <failure_id>`
Purpose:

- copy all sidecars for one failure from Pi to a local gitignored folder

Behavior:

- resolve artifact list from failure detail
- copy all referenced sidecars over SSH
- print local destination paths

### 4. `analyze-failure <failure_id> --reason-file <path> --fix-file <path>`
Purpose:

- submit agent explanation and proposed fix

Behavior:

- sends text to the analyze path
- causes the row to move to `analyzed`

## Transport policy

Scripts prefer:

1. local trusted-network access path when available,
2. n8n webhook façade when not.

This keeps remote Codex usage working without making Codex a general backend client.

The transport policy lives inside the script layer and should not change the backend contract.

## n8n webhook façade

For Codex-facing remote usage, add façade operations for:

- list captured failures
- get one failure
- analyze one failure

The façade may call PKM backend internally, but Codex should not need to know backend credentials or raw backend routes.

## Sidecar copy

### Source of truth
Sidecar metadata comes from `pack.artifacts`.

### Transfer
Copy is done by local helper script over SSH from the Pi shared root.

### Destination
Use a stable gitignored local destination such as:

- `.codex/failure-sidecars/<failure_id>/`

### Scope
For v1, copy all sidecars for one failure id.

No per-artifact selection is required.

## Agent instruction contract

The agent instruction doc should tell Codex to:

1. call `list-open-failures`
2. choose one failure id
3. call `get-failure <failure_id>`
4. call `copy-failure-sidecars <failure_id>` if sidecars exist
5. write explanation and proposed fix
6. call `analyze-failure <failure_id> ...`

The instruction doc must explicitly prohibit:

- direct backend API calls,
- direct n8n API calls,
- direct ad hoc SSH browsing outside the helper scripts,
- any attempt to resolve or apply fixes through this surface.

## Acceptance criteria

- scripts work end-to-end for one captured failure
- remote Codex usage can still retrieve and analyze through webhook fallback
- sidecars land in a predictable gitignored local directory
- agent can complete read + analyze flow without direct backend credentials
- helper scripts fail clearly on missing failure id, missing sidecars, or auth failures

## Test cases

- list captured failures locally
- list captured failures remotely through webhook fallback
- fetch one failure locally
- fetch one failure remotely
- copy sidecars for failure with artifacts
- copy sidecars for failure without artifacts
- submit analysis for captured row
- submit analysis overwrite for analyzed row
- ensure helper scripts do not expose raw secrets in normal output

## Risks

- remote webhook access adds another reliability hop
- local-first transport policy can drift if not documented carefully
- SSH copy assumptions may break if artifact paths or mount paths change
- large sidecar volumes can make copy slow for some failures

## Out of scope

- direct sidecar download over backend HTTP
- per-artifact interactive browsing
- autonomous code application
- issue tracker creation
