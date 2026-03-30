# Work Packages — Failure Pack Capture And Retrieval (Archived)

Status: archived completed companion (implemented-v1 on 2026-03-28)  
Related PRD: `docs/PRD/failure-pack-prd.md`

---

## WP1 — Contracts, schema, and doc updates

### Goal
Define the persisted failure-pack contract and align backend docs before implementation begins.

### Scope
- finalize `failure-pack.v1` JSON contract,
- add failure-pack endpoints to `docs/api.md`,
- add `pkm.failure_packs` to `docs/database_schema.md`,
- document that one table covers both test and production mode runs,
- update PRD references and any related repo docs,
- document the shared sidecar storage root,
- note that retention is indefinite in v1 and cleanup is future work.

### Components touched
- `docs/api.md`
- `docs/database_schema.md`
- `docs/env.md` if storage-root documentation needs tightening
- PRD doc

### Deliverables
- approved JSON schema for `failure-pack.v1`
- approved endpoint list and request/response shapes
- approved table definition and retention notes

### Acceptance criteria
- contract answers all of these without ambiguity:
  - required keys,
  - direct-parent rule,
  - sidecar rules,
  - delta rules,
  - redaction rules,
  - upsert key,
  - retrieval keys,
  - mode handling,
  - n8n-only scope boundary
- docs and PRD agree on names and shapes

### Risks / notes
- avoid naming churn after `wf99` and PKM implementation starts

---

## WP2 — `wf99` pack builder and sidecar writer

### Goal
Implement the n8n-side write path that captures a failed run and emits one normalized failure pack.

### Scope
- assemble failure context from the shared error-workflow path,
- run lightweight static ignore-rule matching keyed by workflow + message,
- resolve failing node metadata,
- resolve immediate parent node metadata,
- capture failing node input,
- capture immediate parent input,
- compute duplication delta for parent input,
- write sidecars first to shared storage,
- apply redaction,
- post normalized envelope to PKM via standard n8n `HTTP Request` node,
- keep message composition isolated to a compose-only node.

### Components touched
- `wf99` workflow wiring
- any externalized n8n node helpers under `src/n8n/nodes/...`
- shared error workflow handoff payload if needed

### Deliverables
- `wf99` can persist a failure pack for a representative failed run
- alert path reports whether pack persistence succeeded or failed

### Acceptance criteria
- for a simple failed run, `wf99` stores:
  - `run_id`,
  - workflow metadata,
  - execution mode,
  - failing node input,
  - parent input context,
  - artifact refs for sidecars
- identical parent-input fields are omitted from delta and listed in `duplicate_paths_omitted`
- secret fields are redacted before persistence
- sidecars are written under the shared mounted path using relative references
- `wf99` writes sidecars before posting the envelope to PKM

### Test cases
- single-item failure
- multi-item failure
- large JSON body failure
- payload containing auth header or bearer token
- failure with no resolvable parent node
- test-mode run
- production-mode run
- pack post failure after sidecar write

### Dependencies
- WP1 complete

---

## WP3 — PKM write endpoint and persistence

### Goal
Give PKM a narrow admin-only write endpoint that stores failure-pack rows keyed by `run_id`.

### Scope
- add new database table `pkm.failure_packs`,
- ensure one shared table covers both test and production runs,
- add DB methods for insert/upsert/read summary,
- add `POST /debug/failures`,
- validate incoming envelope,
- project searchable summary fields,
- store full `pack` jsonb.

### Components touched
- `src/server/**`
- DB migration / schema-owned files
- `docs/api.md`
- `docs/database_schema.md`

### Deliverables
- migration or schema change for `pkm.failure_packs`
- admin-protected write endpoint
- server-side validation and persistence logic

### Acceptance criteria
- upsert is keyed by `run_id`
- repeated posts for same `run_id` are idempotent and deterministic
- invalid schema version is rejected
- artifact paths are stored but not dereferenced on write
- endpoint returns `failure_id`, `run_id`, and write action
- `mode` is projected for filtering but does not require a second table

### Test cases
- insert new pack
- upsert existing `run_id`
- reject missing `run_id`
- reject malformed artifact path
- reject invalid schema version
- insert test-mode pack
- insert production-mode pack

### Dependencies
- WP1 complete

---

## WP4 — PKM read endpoints and failure bundle

### Goal
Expose a narrow read surface so agents can retrieve one failure bundle without talking to n8n directly.

### Scope
- add `GET /debug/failures/:failure_id`
- add `GET /debug/failures/by-run/:run_id`
- add `GET /debug/failures`
- add `GET /debug/failure-bundle/:run_id`
- join or compose with existing run-trace retrieval from `pipeline_events`

### Components touched
- `src/server/**`
- DB read helpers
- `docs/api.md`

### Deliverables
- one-call bundle response for agents
- recent-failure listing response for operators/agents

### Acceptance criteria
- bundle returns:
  - failure summary,
  - full stored pack,
  - PKM run trace
- read paths are admin-protected
- list endpoint supports at least `limit`, `before_ts`, `workflow_name`, `node_name`, and `mode`
- list endpoint does not require workflow-id filtering
- bundle does not depend on live n8n access

### Test cases
- fetch by `failure_id`
- fetch by `run_id`
- list recent failures
- list filtered by workflow name
- list filtered by node name
- list filtered by mode
- bundle with populated run trace
- bundle when run trace is empty but pack exists

### Dependencies
- WP3 complete

---

## WP5 — Debug UI Failures page

### Goal
Expose failures to operators in the existing debug UI app.

### Scope
- add side-menu entry for `Failures`
- add recent-failures list view backed by PKM endpoints
- add filters for `workflow_name`, `node_name`, and `mode`
- add detail page/view for one failure
- display failure summary, stored pack, sidecar refs, and PKM run trace

### Components touched
- current debug UI app
- debug UI routing/navigation
- PKM read endpoints as consumed by UI
- docs if the debug UI is documented

### Deliverables
- operator-accessible Failures page in the existing debug UI
- basic failure detail drill-down

### Acceptance criteria
- Failures appears in the side menu
- operator can browse recent failures without using raw API calls
- operator can open one failure and inspect stored detail
- UI works for both test-mode and production-mode runs using the same backend table

### Test cases
- load recent failures page
- filter failures by workflow name
- filter failures by node name
- filter failures by mode
- open detail page for stored failure
- open detail page when sidecars exist
- open detail page when run trace is empty

### Dependencies
- WP4 complete

---

## WP6 — Redaction hardening and operational guardrails

### Goal
Prevent the diagnostics surface from turning into an unsafe or fragile payload sink.

### Scope
- harden redaction rules,
- add file-path safety checks,
- add operator docs for failure-pack storage,
- add alert wording for “pack stored” vs “pack capture failed”,
- explicitly defer retention cleanup implementation to later work.

### Components touched
- backend validation or helpers
- `wf99` alert text
- docs

### Deliverables
- validated redaction ruleset
- relative-path enforcement
- documented operational notes and deferred-cleanup note

### Acceptance criteria
- relative-path enforcement prevents path traversal
- secrets are not persisted in known sensitive fields
- normal alerts remain readable and concise
- docs clearly state that retention is indefinite in v1 and cleanup is future work

### Test cases
- redact known secrets in headers/body
- reject `../` traversal attempt in artifact path
- alert text on pack success
- alert text on pack failure

### Dependencies
- WP2 and WP3 complete

---

## Suggested sequence

1. WP1 — lock the contract first
2. WP2 — build `wf99` capture path
3. WP3 — persist to PKM
4. WP4 — expose read bundle for agents
5. WP5 — add the debug UI Failures page
6. WP6 — harden redaction and guardrails

---

## Thin-slice milestone

A useful first slice is complete when all of the following work:

- one failed n8n-orchestrated workflow produces a stored failure pack,
- pack is retrievable by `run_id`,
- bundle returns PKM run trace plus stored pack,
- sidecars work for one large payload case,
- alert text tells operator whether the pack was stored,
- debug UI shows the failure on the new Failures page.

That slice is enough to prove the workflow before deeper hardening.

---

## Out-of-scope follow-ons

These can come later if the first slice proves valuable:

- retention and cleanup jobs
- artifact preview endpoint
- workflow-level retention overrides
- agent-side semantic search across failure packs
- richer dedupe/compaction across repeated failures
- extending the same model to non-n8n execution paths
