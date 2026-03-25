# MCP-work-packages.md

Status: Implemented baseline v1 (2026-03-24)  
Owner: Igor / ChatGPT  
Date: 2026-03-24

## Goal

Implement the MCP surface on `pkm-server` in a way that keeps ChatGPT isolated from generic backend APIs, preserves current retrieval behavior for v1, writes two artifacts through one dedicated capture flow, and makes MCP failures measurable and visible.

## Sequence and dependency order

Recommended order:

1. docs and contract lock
2. backend surface isolation
3. read-path implementation
4. write-path implementation
5. observability and eval
6. ChatGPT project instruction update and end-to-end verification

---

## WP1 — Contract lock and doc baseline

### Objective
Freeze the intended MCP workflow and contracts before coding the endpoint layer.

### Deliverables
- finalized `MCP-PRD.md`
- new `docs/mcp_api.md`
- updated `project_instructions.md`
- explicit note in docs that MCP is separate from generic backend API

### Tasks
- resolve remaining PRD open items:
  - session note title convention
  - working-memory title convention
  - runtime `session_id` availability in real MCP execution
  - final payload minimization
- document final tool list:
  - `pkm.last`
  - `pkm.find`
  - `pkm.continue`
  - `pkm.pull`
  - `pkm.pull_working_memory`
  - `pkm.wrap_commit`
- define request and response contracts for each tool
- define canonical markdown format for:
  - session summary note
  - working memory
- define failure contract and user-visible failure wording expectations

### Exit criteria
- user signs off on PRD and tool contracts
- no unresolved scope ambiguity on read/write behavior

---

## WP2 — MCP surface isolation on `pkm-server`

### Objective
Expose a public MCP surface without giving ChatGPT access to generic internal APIs.

### Deliverables
- MCP endpoint on `pkm-server`
- MCP router / handler layer
- explicit separation from generic `/db/*` routes
- deployment notes for public exposure

### Tasks
- add MCP transport entrypoint
- ensure only MCP tools are exposed through the public ChatGPT-facing path
- prevent direct generic `/db/*` passthrough from MCP
- define service/module boundaries:
  - MCP tool handlers
  - application services reused internally
  - generic orchestration routes remain internal-only
- wire public exposure path in deployment config later as separate deployment task

### Design checks
- ChatGPT must not be able to invoke `/db/update`, `/db/delete`, `/db/move`, or generic insert/update flows
- MCP should reuse service logic where sensible, but contracts must remain MCP-specific

### Exit criteria
- MCP endpoint exists
- tool discovery only shows the approved toolset
- generic backend endpoints remain inaccessible through MCP

---

## WP3 — Read-path implementation

### Objective
Implement faithful v1 MCP retrieval behavior using existing read semantics and context-pack conventions.

### Deliverables
- MCP handlers for `last`, `find`, `continue`, `pull`, `pull_working_memory`
- standardized JSON response shapes
- topic-keyed working-memory pull in regular app layer and MCP layer

### Tasks
- map MCP tools to existing read services / query builders
- preserve current excerpt preference order
- preserve standardized context-pack field shape where applicable
- implement `pull_working_memory(topic)` as separate retrieval path
- ensure `pull_working_memory` returns canonical working-memory text without summarization
- define `pull` long-context response shape and variants
- test no-result paths explicitly

### Required tests
- success per tool
- no-result per tool where applicable
- malformed input validation
- topic miss for working memory
- regression check against existing context-pack builder expectations

### Exit criteria
- all five read tools return contract-compliant JSON
- working memory never gets summarized on pull
- v1 behavior is faithful to current context-pack behavior

---

## WP4 — Write capture flow and artifact rendering

### Objective
Implement one MCP write that updates both session note and working memory through a dedicated ChatGPT capture flow.

### Deliverables
- `pkm.wrap_commit` handler
- dedicated ChatGPT capture-flow service
- canonical markdown renderer for session note
- canonical markdown renderer for working memory
- insert-or-update behavior for both artifacts

### Tasks
- accept one structured write payload
- validate required fields:
  - `session_id`
  - `resolved_topic_primary`
  - any other final locked fields
- render canonical session note markdown
- render canonical working-memory markdown
- map structured fields directly into:
  - `gist`
  - `topic_primary`
  - `topic_secondary`
  - `topic_secondary_confidence`
  - `distill_why_it_matters`
  - `distill_summary`
  - `excerpt`
- store canonical markdown in `capture_text`
- define `clean_text` derivation and hashing path
- write two artifacts in one backend flow
- ensure chatgpt-authored session notes written through this path never go through T1 or T2
- verify current idempotency behavior before changing any semantics

### Required tests
- successful write with complete payload
- repeated write with same canonical text
- repeated write after additional discussion
- same topic across new conversation
- topic shift in same conversation
- validation failure on missing `session_id`
- validation failure on missing primary topic

### Exit criteria
- one write call updates both artifacts correctly
- session note and working memory use the agreed idempotency policies
- no T1/T2 processing is triggered for these MCP-authored session notes

---

## WP5 — Eval, observability, and failure surfacing

### Objective
Make MCP reliability measurable and prevent silent failure.

### Deliverables
- structured MCP event logging
- eval harness or scripted test plan
- success/failure rate report output
- explicit failure surfacing behavior in project instructions and implementation

### Tasks
- emit structured events for every MCP tool call with:
  - timestamp
  - request id
  - tool name
  - session id when present
  - topic fields when present
  - outcome
  - error code
  - short error summary
- implement metrics counters for:
  - read success/failure by tool
  - write success/failure
  - missing required fields
  - visible failure count
  - silent failure count
- create scripted eval cases for:
  - read success
  - read no-result
  - read tool failure
  - write success
  - missing required fields
  - backend validation failure
  - backend transport/tool failure
  - repeated commit same content
  - same conversation second wrap
  - new conversation same topic
  - topic shift
- verify the assistant-facing operating protocol stops and reports any MCP failure

### Exit criteria
- eval can report measured success/failure rates
- silent failure rate is demonstrably zero in scripted evals
- failure cases are visible to the user rather than hidden

---

## WP6 — End-to-end project workflow validation

### Objective
Verify the actual user loop works in ChatGPT with the intended operating protocol.

### Deliverables
- updated `project_instructions.md`
- one or more real end-to-end transcripts or test runs
- implementation notes for any runtime gaps discovered

### Tasks
- validate topic-first start flow
- validate wrap preview behavior
- validate explicit `commit` / `/commit`
- validate continue-after-wrap flow
- validate new conversation same topic flow
- validate topic-shift flow
- verify ChatGPT suggests commit after an approved preview
- verify MCP failures stop the flow and are surfaced
- verify whether real runtime metadata provides a usable `session_id`
- if `session_id` is unavailable, stop and bring fallback options back for review before implementation continues

### Exit criteria
- real end-to-end usage matches PRD
- any runtime gap is documented with evidence
- no hidden MCP failure observed in validation runs

---

## Suggested implementation order by code area

1. docs
2. MCP endpoint/router
3. read tool handlers
4. working-memory retrieval path
5. wrap commit service
6. artifact renderers
7. idempotent write integration
8. logging and eval instrumentation
9. end-to-end validation

## Risks to watch closely

### 1. `session_id` availability
This is the biggest contract risk. Do not guess. Verify in real MCP execution before locking implementation details that depend on it.

### 2. Hidden tool failures in chat
This is the biggest UX risk. Treat silent failure as a release blocker.

### 3. Leakage from generic backend API
Do not let MCP become a thin proxy to generic `/db/*`.

### 4. Unintended T1/T2 processing
Session notes produced through the ChatGPT capture flow are already processed. They must not enter standard enrichment flows.

### 5. Payload overreach
The current payload is intentionally broad. Trim only after the end-to-end flow is proven.

## Definition of done

Implementation is done when:
- approved MCP tools are exposed and nothing broader
- read flow works from topic start through iterative retrieval
- wrap previews both artifacts
- commit persists both artifacts through one dedicated write call
- ChatGPT-authored session notes bypass T1/T2 entirely
- MCP failures are surfaced immediately and never hidden
- eval reports measured tool success and failure rates
