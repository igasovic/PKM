# MCP-PRD.md

Status: Transition plan approved for n8n-first replacement of public MCP (2026-03-26)  
Owner: Igor / ChatGPT  
Date: 2026-03-26

## 1. Purpose

Replace the public ChatGPT-facing MCP path with an n8n-orchestrated ChatGPT integration that:

1. keeps `pkm-server` and generic backend APIs internal,
2. preserves the existing topic-first PKM workflow,
3. automates write first, then read,
4. uses no more than two new n8n workflows,
5. requires no environment or database changes unless explicitly approved later by the user.

This PRD supersedes the earlier assumption that ChatGPT would connect directly to a public MCP endpoint on `pkm-server`.

## 2. Product outcome

Target user loop after the transition:

1. User starts chat by naming a topic.
2. ChatGPT uses a GPT/custom-action-backed n8n webhook to retrieve PKM context.
3. n8n routes the read request to the correct internal backend read path.
4. Conversation proceeds with additional implicit or explicit reads as needed.
5. On `wrap` or `/wrap`, ChatGPT previews two markdown artifacts:
   - session summary note,
   - updated working memory.
6. On explicit `commit` or `/commit`, ChatGPT sends one write request to n8n.
7. n8n orchestrates the backend capture flow.
8. Backend writes or updates both artifacts idempotently.

## 3. Scope

### In scope

- Disable public MCP as the active ChatGPT integration path.
- Replace direct public MCP usage with GPT/custom-action -> n8n webhook orchestration.
- Keep generic backend APIs internal-only.
- Add one write workflow in n8n.
- Add one read-router workflow in n8n.
- Move appropriate ChatGPT-facing read/write application methods into `pkm-server` internal app/backend surface.
- Keep DB-layer active-schema resolution silent and unchanged.
- Preserve write preview -> explicit commit.
- Preserve two persisted artifacts:
  - session summary note,
  - working-memory entry.
- Add eval and observability for read/write success and visible failure handling.

### Out of scope

- Any new public backend API directly exposed to ChatGPT.
- More than two new n8n workflows.
- Environment changes or new deployment config without explicit user approval.
- Database changes or migrations without explicit user approval.
- Admin/debug ChatGPT tools.
- Generic CRUD or orchestration exposure to ChatGPT.
- Retrieval optimization beyond faithful routing to the current backend behavior.

## 4. Design principles

1. **n8n is the only public ChatGPT integration boundary.**
   - ChatGPT talks to n8n webhooks/actions only.
   - `pkm-server` stays internal.
   - Generic `/db/*` APIs stay internal.

2. **Public ChatGPT contracts are semantic.**
   - ChatGPT does not call generic DB or backend CRUD methods.
   - n8n exposes only purpose-built read/write action contracts.

3. **Routing lives in n8n.**
   - If ChatGPT asks for a read, n8n decides whether to call `last`, `find`, `continue`, `pull`, or `pull_working_memory` backend logic.
   - ChatGPT should not be responsible for low-level routing once the action contract exists.

4. **DB layer owns schema routing.**
   - n8n and app layer do not choose prod vs test schema.
   - Existing active-schema resolution remains silent.

5. **Write is higher priority than read.**
   - Phase 2 ships automated write first.
   - Phase 3 adds read via the dedicated n8n router.

6. **Wrap remains preview-first.**
   - `wrap` and `/wrap` preview only.
   - Persist occurs only on explicit `commit` or `/commit`.

7. **Failures must be visible.**
   - Any read or write failure must stop the flow and be reported explicitly.
   - ChatGPT must not continue as if retrieval or persistence succeeded.

## 5. Transition plan

The transition is intentionally four-phase.

### Phase 1 — Disable MCP API as the active path

Goal:
- stop treating public MCP as the supported ChatGPT integration path.

Requirements:
- mark MCP docs and code path as legacy/disabled for ChatGPT use,
- do not add new MCP-facing capabilities,
- do not require env or routing changes unless explicitly approved,
- do not delete old docs yet.

Implementation guidance:
- application-level disable is sufficient for this phase,
- if `/mcp` is still reachable internally or historically, it should not be used by project instructions or new workflows,
- if code changes are needed, prefer returning a clear disabled/legacy response rather than extending the protocol.

### Phase 2 — Add write through n8n

Goal:
- automate the higher-value save-back step first.

Public path:
- ChatGPT/GPT custom action -> n8n webhook -> `pkm-server` internal capture flow.

Allowed new n8n workflow:
- `05 ChatGPT Wrap Commit`

Purpose:
- accept one structured write payload,
- validate required fields,
- call the internal backend capture path,
- write/update both artifacts in one orchestrated flow,
- return explicit success or failure.

### Phase 3 — Add read through n8n

Goal:
- automate PKM retrieval without exposing backend APIs directly.

Public path:
- ChatGPT/GPT custom action -> n8n webhook -> n8n router -> `pkm-server` internal read methods.

Allowed new n8n workflow:
- `11 ChatGPT Read Router`

Purpose:
- accept a semantic read request,
- choose the correct backend read method,
- normalize response shape for ChatGPT,
- return explicit success, no-result, or failure.

### Phase 4 — Sunset MCP API docs

Goal:
- remove obsolete public-MCP documentation once the n8n-backed path is live and validated.

Requirements:
- remove or archive `mcp_api.md`,
- remove MCP-specific instructions from project operating docs,
- keep historical references only if useful for implementation history,
- do not keep two active public integration stories in the repo.

## 6. Public integration surface

### 6.1 Supported ChatGPT path

Supported path after this transition:

```text
ChatGPT / GPT custom action
-> n8n public webhook
-> n8n orchestration
-> pkm-server internal app/backend methods
-> database
```

### 6.2 Unsupported ChatGPT path

Unsupported path after this transition:

```text
ChatGPT
-> public MCP endpoint on pkm-server
```

### 6.3 Separation requirement

- ChatGPT must not have direct access to generic `/db/*` endpoints.
- ChatGPT must not call internal backend routes directly.
- n8n is the only public orchestration layer.

## 7. n8n workflow constraints

Exactly two new n8n workflows are allowed.

### 7.1 `05 ChatGPT Wrap Commit`

Responsibilities:
- validate commit payload,
- enforce required-field checks,
- call internal backend capture logic,
- return structured success/failure,
- log outcome for eval.

### 7.2 `11 ChatGPT Read Router`

Responsibilities:
- accept a semantic read request,
- decide which backend read method to call,
- normalize output shape,
- return structured success/no-result/failure,
- log outcome for eval.

No other new n8n workflows should be introduced for this integration without explicit user approval.

## 8. Backend application surface

### 8.1 Principle

Appropriate MCP-era application methods should be moved or retained inside `pkm-server`, but they become **internal app/backend methods**, not public MCP methods.

### 8.2 Internal methods required

Internal backend support is required for:
- `last`
- `find`
- `continue`
- `pull`
- `pull_working_memory`
- `wrap_commit` capture flow

These may be implemented as:
- internal routes only reachable by n8n, or
- application services called by thin internal routes,
- but not as public ChatGPT-facing MCP methods.

### 8.3 Routing rule

If routing is needed to decide which read method to call:
- n8n performs the routing,
- not ChatGPT,
- not the database layer.

## 9. User workflows

Only two user-facing workflows are defined here.

### 9.1 Workflow A — Write-first wrap/commit

1. User works in ChatGPT normally.
2. User says `wrap` or `/wrap`.
3. ChatGPT previews:
   - session summary note markdown,
   - working-memory markdown.
4. User approves or requests edits.
5. User says `commit` or `/commit`.
6. ChatGPT calls the write action.
7. n8n workflow `05 ChatGPT Wrap Commit` validates and orchestrates the backend write.
8. Backend writes/updates:
   - session summary note,
   - working-memory entry.
9. ChatGPT reports explicit success or explicit failure.

### 9.2 Workflow B — Topic-first read

1. User starts or shifts to a topic.
2. ChatGPT calls the read action.
3. n8n workflow `11 ChatGPT Read Router` routes to:
   - `pull_working_memory` first when appropriate,
   - then `continue`, `last`, `find`, or `pull` based on request semantics.
4. n8n returns normalized JSON.
5. ChatGPT uses the returned PKM context in the conversation.
6. If read fails, ChatGPT stops and reports the failure.

## 10. Read behavior

### 10.1 Read goals

ChatGPT should be best at:
1. searching PKM for relevant prior notes / newsletters / thoughts,
2. pulling one entry with short and long context,
3. browsing recent items by topic or keyword.

### 10.2 Read methods supported internally

The read router must be able to reach these backend methods:
- `last`
- `find`
- `continue`
- `pull`
- `pull_working_memory`

### 10.3 Routing behavior

Default topic-first behavior:
- prefer `pull_working_memory(topic)` first when topic is clear,
- then choose among `continue`, `last`, `find`, `pull`.

Routing heuristics:
- `continue`: continue an active thinking thread on a topic with the most relevant prior context,
- `last`: find the last/best relevant instances of a vaguely remembered idea when keywords are unclear,
- `find`: locate a specific detail or phrase,
- `pull`: deterministic give-me-the-source path,
- `pull_working_memory`: retrieve topic working memory without summarization.

### 10.4 Read response contract

Read responses should be:
- structured JSON,
- row-based,
- faithful to current context-pack conventions,
- normalized by n8n before returning to ChatGPT.

Priority order for v1:
1. faithfulness,
2. retrieval quality,
3. token footprint.

### 10.5 Excerpt policy

Default behavior should aim for:
- summary plus raw excerpt,
- longer raw text only in dedicated context retrieval,
- full `clean_text` only when source text is short.

Implications:
- browse/search methods return compact rows,
- `pull` is the long-context method,
- `pull_working_memory` returns canonical working-memory text without summarization.

## 11. Working memory artifact

### 11.1 Artifact definition

Working memory remains a PKM-native artifact with:
- `source = chatgpt`
- `content_type = working_memory`
- `intent = thought`

### 11.2 Cardinality

- one working-memory entry per active topic,
- keyed by normalized primary topic.

### 11.3 Canonical format

Baseline format:

```markdown
## Topic: <Name>
**Why this matters (1–2 lines)**
...

**Current mental model (5–7 bullets max)**
- ...

**Tensions / uncertainties**
- ...

**Open questions**
- ...

**Next likely step**
- Next: ...
- If-success-then: ...

**Last updated**
- YYYY-MM-DD
```

### 11.4 Retrieval rule

Working memory must never be summarized on pull.

## 12. Session summary note artifact

### 12.1 Artifact definition

Session summary note remains a PKM entry with:
- `source = chatgpt`
- `content_type = note`
- `intent = thought`

### 12.2 Cardinality

- one continuously updated session note per conversation,
- recomputed canonically on each commit.

### 12.3 Canonical markdown structure

```markdown
# Session

## Goal
...

## Summary
...

## Context used
- ...

## Key insights
- ...

## Decisions
- ...

## Tensions / uncertainties
- ...

## Open questions
- ...

## Next steps
- ...

## Working-memory updates to consider
- ...

## Meta

### Why it matters
- ...

### Gist (1 sentence)
...

### Topic Primary
...

### Topic Secondary
...

### Topic Secondary confidence
...
```

### 12.4 Direct field mapping requirement

ChatGPT-authored session notes are already processed artifacts.

Required direct mappings:
- `gist`
- `topic_primary`
- `topic_secondary`
- `topic_secondary_confidence`
- `distill_why_it_matters`
- `distill_summary`
- `excerpt`

Requirement:
- full canonical markdown goes into `capture_text`,
- backend maps structured fields directly,
- session notes written through this flow must not enter T1 or T2 processing.

## 13. Write flow

### 13.1 Trigger

Write is explicit only.
- `wrap` and `/wrap` preview artifacts,
- `commit` and `/commit` persist.

### 13.2 Preview behavior

On wrap, ChatGPT shows both artifacts separately in markdown:
1. session summary note preview,
2. working-memory preview.

No write occurs on wrap alone.

### 13.3 Commit behavior

On explicit commit:
- ChatGPT sends one JSON payload to n8n,
- n8n workflow `05 ChatGPT Wrap Commit` validates and orchestrates,
- backend writes or updates both artifacts.

### 13.4 Write payload baseline

Initial payload:

```json
{
  "session_id": "...",
  "resolved_topic_primary": "parenting",
  "resolved_topic_secondary": "overload management",
  "topic_secondary_confidence": 0.92,
  "chat_title": "...",
  "session_summary": "...",
  "context_used": ["..."],
  "key_insights": ["..."],
  "decisions": ["..."],
  "tensions": ["..."],
  "open_questions": ["..."],
  "next_steps": ["..."],
  "working_memory_updates": ["..."],
  "why_it_matters": ["..."],
  "gist": "...",
  "excerpt": "...",
  "source_entry_refs": [90, 85, 21]
}
```

Notes:
- payload is intentionally still broader than the likely long-term minimum,
- trim later only after real usage validates reliability.

### 13.5 Topic requirement

Write payload must contain explicit resolved topic fields.

At minimum:
- `resolved_topic_primary`

Recommended:
- `resolved_topic_secondary`
- `topic_secondary_confidence`

## 14. Capture-flow requirement

ChatGPT must not set DB fields directly.

Instead:
- ChatGPT sends a structured wrap payload to n8n,
- n8n validates and calls backend capture logic,
- backend renders canonical markdown/text and maps fields,
- backend performs idempotent insert-or-update for both artifacts.

This remains a dedicated ChatGPT capture flow and is separate from generic insert/update endpoints used elsewhere.

## 15. Idempotency

### 15.1 Session summary note

Policy:
- `idempotency_policy_key = chatgpt_session_note_v1`
- `source = chatgpt`
- `content_type = note`
- `conflict_action = update`

Keys:
- primary: session identifier only
- secondary: hash of canonical `clean_text`

Proposed shape:
- `idempotency_key_primary = "chatgpt:<session_id>"`
- `idempotency_key_secondary = sha256(clean_text)`

### 15.2 Working memory

Policy:
- `idempotency_policy_key = chatgpt_working_memory_v1`
- `source = chatgpt`
- `content_type = working_memory`
- `conflict_action = update`

Keys:
- primary: normalized primary topic
- secondary: hash of canonical `clean_text`

Proposed shape:
- `idempotency_key_primary = "wm:<normalized_topic_primary>"`
- `idempotency_key_secondary = sha256(clean_text)`

### 15.3 No-op save behavior

Preferred behavior:
- if primary matches and secondary hash is unchanged, backend may effectively skip/no-op.

Implementation rule:
- do not change current idempotency semantics without verification and explicit user approval.

## 16. Constraints and non-goals

### 16.1 No environment changes without approval

Implementation must not:
- add new environment variables,
- change public routing,
- change deployment topology,
- require new config,
without explicit user approval.

### 16.2 No database changes without approval

Implementation must not:
- add migrations,
- alter schema,
- introduce new tables,
- change idempotency schema,
without explicit user approval.

The database is assumed already modified as needed for this work.

## 17. Documentation requirements

During the transition:
- keep `api.md` as the internal/generic backend API reference,
- update this PRD to reflect n8n-first architecture,
- create new work packages for the transition,
- update GPT project instructions for the new operating model.

At sunset:
- remove or archive `mcp_api.md` so it is no longer an active contract.

## 18. Eval and observability

### 18.1 Goal

Measure success rate of read/write operations and prevent silent failure.

### 18.2 Required metrics

Track at minimum:
- read call count by routed method,
- read success count by method,
- read failure count by method,
- read no-result count by method,
- write call count,
- write success count,
- write failure count,
- missing-required-field count for write payloads,
- missing-`session_id` count,
- missing-topic count,
- backend validation failure count,
- visible-failure count in eval sessions,
- silent-failure count.

### 18.3 Definitions

- **success**: action returns a valid response satisfying contract requirements,
- **failure**: validation rejects input, orchestration fails, backend errors, or response cannot be used safely,
- **visible failure**: assistant explicitly reports the failure and does not claim success,
- **silent failure**: assistant continues as if retrieval or persistence succeeded when it did not.

### 18.4 Acceptance thresholds

For eval to pass:
- read success rate must be measured per routed method,
- write success rate must be measured for the wrap commit action,
- silent failure rate must be `0`,
- false-success claim rate must be `0`,
- every induced failure in scripted evals must be surfaced visibly.

### 18.5 Required eval scenarios

At minimum, run scripted evals for:
1. write success with complete payload,
2. missing `session_id`,
3. missing `resolved_topic_primary`,
4. backend validation error on write,
5. repeated commit with unchanged canonical text,
6. same conversation second wrap after additional discussion,
7. new conversation on same topic,
8. topic shift in same conversation,
9. `pull_working_memory` success on valid topic,
10. `pull_working_memory` miss / no-result path,
11. routed `last` / `find` / `continue` success,
12. routed `pull` success with long-context result,
13. backend transport/tool failure on read,
14. backend transport/tool failure on write.

### 18.6 Logging requirements

n8n and/or backend should emit structured events that make the above measurable, including:
- timestamp,
- request id,
- action name,
- routed backend method when applicable,
- session id when present,
- topic fields when present,
- outcome (`success`, `validation_error`, `tool_error`, `no_result`),
- error code,
- short error summary.

## 19. Acceptance criteria

This transition is successful when:
1. public MCP is no longer the supported ChatGPT integration path,
2. automated write works through `05 ChatGPT Wrap Commit`,
3. automated read works through `11 ChatGPT Read Router`,
4. ChatGPT never has direct access to generic internal APIs,
5. working memory remains retrievable without summarization,
6. wrap previews both artifacts,
7. commit persists both artifacts through one write call,
8. session notes still bypass T1/T2 processing,
9. failures are surfaced explicitly and never hidden,
10. eval reports measured success and failure rates,
11. `mcp_api.md` is removed or archived in the sunset phase.
