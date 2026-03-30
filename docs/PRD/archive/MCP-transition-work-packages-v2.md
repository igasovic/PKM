# Work Packages — MCP To n8n-first Transition (Archived)

Status: archived historical transition plan for n8n-first ChatGPT integration  
Owner: Igor / ChatGPT  
Date: 2026-03-26

Superseded by:
- `docs/PRD/gpt-actions-integration-prd.md`
- `docs/external_api.md`

Read this only for transition history, not for the active public ChatGPT contract.

## Goal

Replace the public MCP integration path with an n8n-first ChatGPT integration that preserves the PKM workflow, automates write first, adds read second, and then removes obsolete MCP documentation.

## Guardrails

- Add no more than two new n8n workflows.
- Use only:
  - `05 ChatGPT Wrap Commit`
  - `11 ChatGPT Read Router`
- Keep `pkm-server` internal.
- Keep generic backend APIs internal.
- Do not modify environment or require additional config without explicit user approval.
- Do not modify database without explicit user approval.

## Phase sequence

1. disable MCP API as the active path
2. add write through n8n
3. add read through n8n
4. sunset MCP docs

---

## WP1 — Disable MCP as the active integration path

### Objective
Stop using public MCP as the supported ChatGPT path and prevent new work from extending it.

### Deliverables
- PRD updated to n8n-first architecture
- project instructions updated to stop referring to MCP as the active path
- legacy status note for `mcp_api.md`
- implementation note clarifying that generic backend APIs remain internal

### Tasks
- update architecture docs to make n8n the only supported public boundary
- mark `/mcp` and `mcp_api.md` as legacy during the transition period
- ensure no new feature work is added to public MCP contracts
- if code disable is needed, prefer an explicit disabled/legacy response rather than extending the MCP surface

### Exit criteria
- docs no longer present public MCP as the active plan
- active implementation plan points only to n8n orchestration

---

## WP2 — Implement write via `05 ChatGPT Wrap Commit`

### Objective
Automate save-back first through a single n8n workflow that calls internal backend capture logic.

### Deliverables
- new n8n workflow: `05 ChatGPT Wrap Commit`
- stable public webhook/action contract for write
- backend internal capture method usable by n8n
- structured success/failure response contract
- write eval instrumentation

### Tasks
- define webhook/action request schema for wrap commit
- validate required fields at n8n layer:
  - `session_id`
  - `resolved_topic_primary`
  - any other final required fields
- call the internal backend capture path from n8n
- ensure backend writes both artifacts in one flow:
  - session summary note
  - working-memory entry
- ensure session notes written through this path bypass T1/T2
- return explicit action result and artifact identifiers
- log success, validation error, backend error, and unchanged/no-op outcomes

### Required tests
- successful write with complete payload
- missing `session_id`
- missing `resolved_topic_primary`
- backend validation error
- repeated commit with same canonical text
- repeated commit after additional discussion
- same topic across new conversation
- topic shift in same conversation

### Exit criteria
- one public write action exists and works through n8n
- backend remains internal-only
- both artifacts persist correctly from one write call

---

## WP3 — Implement read via `11 ChatGPT Read Router`

### Objective
Automate PKM retrieval through one n8n workflow that routes to the correct internal backend read method.

### Deliverables
- new n8n workflow: `11 ChatGPT Read Router`
- semantic public read request contract
- routing logic in n8n
- normalized JSON read response shape
- read eval instrumentation

### Tasks
- define one public read action schema that supports topic-first retrieval
- implement routing in n8n for:
  - `continue`
  - `last`
  - `find`
  - `pull`
- call internal backend read methods from n8n
- normalize result shapes before returning to ChatGPT
- preserve current context-pack faithfulness and excerpt rules
- handle no-result distinctly from failure
- log routed method, success, no-result, and failure outcomes

### Required tests
- `continue` success
- `last` success
- `find` success
- `pull` success
- malformed input validation
- backend transport/tool failure

### Exit criteria
- one public read action exists and works through n8n
- routing happens in n8n, not in ChatGPT
- read responses are contract-compliant and faithful to current behavior

---

## WP4 — Eval, failure surfacing, and sunset docs

### Objective
Prove the n8n-first integration is reliable enough to replace the MCP story, then remove obsolete MCP docs.

### Deliverables
- eval report for write and read
- failure visibility verification
- final project instructions update
- sunset or archive of `mcp_api.md`

### Tasks
- instrument both workflows for measurable outcomes
- run scripted eval scenarios from the PRD
- verify visible failure behavior in real GPT/project runs
- verify ChatGPT stops and reports on any failed read or write
- once read and write are validated, remove or archive `mcp_api.md`
- clean up docs so only one public integration story remains

### Exit criteria
- measured success/failure rates exist for both workflows
- silent failure rate is zero in scripted evals
- `mcp_api.md` is no longer an active contract
- project instructions reflect the final n8n-backed workflow only

---

## Suggested implementation order

1. docs reset for n8n-first architecture
2. `05 ChatGPT Wrap Commit`
3. write eval + failure surfacing
4. `11 ChatGPT Read Router`
5. read eval + failure surfacing
6. sunset obsolete MCP docs

## Risks to watch

### 1. Hidden failure in GPT/tool use
Treat silent failure as a release blocker.

### 2. n8n routing drift
Keep read routing in one place and document it tightly.

### 3. Backend surface leakage
Do not let ChatGPT-facing actions become thin wrappers around generic internal APIs.

### 4. Premature config changes
Do not change env, routing, or deployment shape without explicit approval.

### 5. Premature schema changes
Database is assumed ready. Do not add migrations without explicit approval.

## Definition of done

This work is done when:
- public MCP is no longer the supported path,
- write works through `05 ChatGPT Wrap Commit`,
- read works through `11 ChatGPT Read Router`,
- backend remains internal-only,
- only two new n8n workflows were added,
- failures are surfaced immediately and never hidden,
- eval reports measurable success/failure rates,
- obsolete MCP docs are removed or archived.
