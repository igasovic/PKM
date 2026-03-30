# PRD — PKM UI Shell

Status: active  
Surface owner: PKM debug/read UI shell and shared UI conventions  
Scope type: backfilled baseline  
Last verified: 2026-03-30  
Related authoritative docs: `docs/api_read_write.md`, `docs/api_control.md`, `docs/env.md`, `docs/requirements.md`  
Related work-package doc: none

## Purpose
Baseline the PKM UI as a real product surface without making it the owner of individual feature semantics that already belong to other PRDs.

## Status and scope boundary
This PRD owns:
- the existence and role of the PKM UI shell under `src/web/pkm-debug-ui`
- page and navigation structure
- the rule that the UI talks to backend HTTP only
- shared UI conventions for read/debug/failure investigation
- the sidebar test-mode control as a UI surface
- local development and proxy expectations for the UI shell

This PRD does not own:
- generic read semantics themselves
- failure-pack semantics
- test-mode routing semantics
- debug-run query semantics
- public ChatGPT behavior

Feature-specific behavior stays with the owning feature PRD; this document owns the UI shell and cross-feature constraints.

## Current behavior / baseline
Current repo behavior is:
- the UI is a React + Tailwind app under `src/web/pkm-debug-ui`
- the fixed UI stack is React + TypeScript + TailwindCSS
- pages currently exposed are:
  - `Read`
  - `Debug`
  - `Failures`
- navigation is sidebar-based with routes `/read`, `/debug`, `/debug/run/:runId`, and `/failures`
- the UI includes a bottom-left test-mode state/toggle control
- the UI uses backend HTTP only and does not connect directly to Postgres
- Vite proxy forwards `/db` and `/debug` to the backend and injects the admin secret for debug routes in local development
- current UI is dark-mode only
- the Debug page supports run lookup, recent runs, table/tree/span investigation views, and JSON copy affordances
- the Failures page supports list filters for `workflow_name`, `node_name`, and `mode`, plus detail inspection and run jump-through

## Goals
- keep one consistent operator-facing UI shell for read/debug/failure work
- keep feature pages aligned around backend API contracts rather than ad hoc local data access
- preserve a clean split between UI-shell ownership and feature-surface ownership
- make cross-feature UI changes reviewable in one place

## Non-goals
- owning the domain semantics of read, failure packs, or test mode
- becoming a second source of truth for backend contracts
- exposing direct DB access or UI-only hidden backend paths
- formalizing every CSS or component detail as product policy

## Boundaries and callers
Current pages and their primary dependencies:
- Read page -> generic read APIs and shared context-pack builder
- Debug page -> debug run APIs
- Failures page -> failure-pack APIs
- Sidebar test-mode control -> test-mode endpoints

Boundary rule:
- feature PRDs define what a page must expose for that feature
- this PRD defines shell-level conventions, navigation, and backend-only access constraints

## Control plane / execution flow
1. operator opens the UI shell.
2. shell routes to a feature page.
3. feature page calls backend HTTP through relative UI API paths.
4. shell provides shared navigation and test-mode affordances.

### Debug page feature contract
- Debug page supports:
  - direct run lookup by `run_id`
  - recent run summaries from `GET /debug/runs`
  - timeline inspection in table view
  - call-tree inspection in tree view
  - span pairing view
  - paired span health states:
    - `ok`
    - `error`
    - `missing_end`
    - `orphan_end`
    - `orphan_error`
  - a detail drawer for event/span/tree-node inspection
  - JSON copy actions for rows, spans, and tree nodes

### Failures page feature contract
- Failures page supports:
  - recent failure listing from `GET /debug/failures`
  - lookup by `run_id`
  - filters for `workflow_name`, `node_name`, and `mode`
  - failure summary and stored-pack inspection
  - merged failure-bundle inspection including run trace
  - jump-through to `/debug/run/:runId`

## Data model / state transitions
The UI is primarily a read and control surface.

Owned shell state examples:
- current route/page
- current test-mode indicator state
- per-page local UI state such as filters, selection, and open detail panes
- active debug view mode (`events`, `tree`, `spans`)
- recent-run filter state and pagination cursor
- selected failure row/detail state

## API / contract surfaces
The UI depends on, but does not own, these backend surfaces:
- generic read APIs
- debug run APIs
- failure-pack APIs
- test-mode APIs

Any UI change that requires a new backend route or contract change must update the owning contract docs and PRDs in the same change set.

## Config / runtime / topology implications
Relevant surfaces:
- `src/web/pkm-debug-ui/.env` local development config
- Vite proxy config and admin-secret forwarding for local development
- backend reachability and admin-secret requirements documented elsewhere

Shell rules:
- UI must read debug and failure investigation data only through PKM HTTP `/debug/*` endpoints.
- UI must not introduce direct DB coupling.
- Large payloads should be previewed or copied safely rather than fully inlined by default.

## Evidence / recovery basis
Recovered from:
- `src/web/pkm-debug-ui/README.md`
- `src/web/pkm-debug-ui/src/App.tsx`
- `src/web/pkm-debug-ui/src/pages/ReadPage.tsx`
- `src/web/pkm-debug-ui/src/pages/DebugPage.tsx`
- `src/web/pkm-debug-ui/src/pages/FailuresPage.tsx`
- `src/web/pkm-debug-ui/src/components/SpanList.tsx`
- `src/web/pkm-debug-ui/src/components/TreeView.tsx`
- `src/web/pkm-debug-ui/src/components/JsonCard.tsx`
- `docs/requirements.md`
- `docs/changelog.md`

## Known gaps requiring code deep-dive
- `REVIEW_REQUIRED: confirm the intended long-term authentication and deployment model for the UI beyond local Vite proxy development. Current docs establish local proxy behavior, but not a fully normalized production/operator access story.`

## Validation / acceptance criteria
This PRD remains accurate if:
- the UI continues to use backend HTTP only
- page structure remains centered on read/debug/failure investigation plus shell-level controls
- feature behavior changes are documented in the owning feature PRDs rather than duplicated here

## Risks / open questions
- without a shell-level PRD, feature PRDs tend to silently absorb cross-feature UI conventions
- if the UI grows beyond operator/debug use, this PRD may need a clearer user/persona and hosting section

## TBD
- whether the UI should eventually expose `pull` or other advanced read operations directly
