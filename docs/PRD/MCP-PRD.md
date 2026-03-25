# MCP-PRD.md

Status: Implemented baseline v1 (2026-03-24)  
Owner: Igor / ChatGPT  
Date: 2026-03-24

## 1. Purpose

Build a dedicated ChatGPT MCP surface for PKM on `pkm-server` that:

1. replaces manual context-pack pull-in with live PKM retrieval,
2. replaces manual save-back with a controlled `wrap` / `/wrap` -> preview -> `commit` / `/commit` flow,
3. creates and maintains two distinct PKM artifacts:
   - a per-conversation **session summary note**,
   - a per-topic **working memory** entry.

This MCP surface is separate from the existing generic backend API. ChatGPT must not have access to generic `/db/*` orchestration endpoints.

## 2. Product outcome

Target user loop:

1. User starts chat by naming a topic.
2. ChatGPT pulls **working memory** for that topic.
3. ChatGPT pulls additional PKM context using one of `last`, `continue`, `find`.
4. Conversation proceeds with implicit and explicit MCP reads as needed.
5. On `wrap` or `/wrap`, ChatGPT previews two markdown artifacts:
   - session summary note,
   - updated working memory.
6. On explicit `commit` or `/commit`, ChatGPT makes **one write call**.
7. Backend capture flow writes or updates both artifacts idempotently.

## 3. Scope

### In scope

- Public MCP endpoint on `pkm-server`.
- MCP-only tool contracts and docs in a separate `mcp_api.md`.
- Read tools for:
  - `last`
  - `find`
  - `continue`
  - `pull`
  - `pull_working_memory`
- One write tool that commits both artifacts in one backend flow.
- Topic-based working memory retrieval and update.
- Session-summary note creation/update.
- Explicit preview and explicit commit gesture.
- Reuse of active-schema selection at the DB layer.
- MCP eval and observability focused on tool success, payload completeness, and visible failure handling.

### Out of scope

- Exposing generic `/db/*` endpoints to ChatGPT.
- Admin or debug MCP tools.
- Generic update/delete/move tools.
- Automatic end-of-session detection.
- Reworking retrieval ranking or context-pack optimization beyond faithful v1 behavior.
- Removing legacy `working_memory.md` immediately. It remains temporarily as a legacy artifact/reference.

## 4. Design principles

1. **MCP is separate from generic backend API.**
   - Public ChatGPT-facing contract is MCP-only.
   - Generic backend endpoints remain internal-only and are not exposed to ChatGPT.
   - MCP tools use dedicated application flow, even if implementation reuses lower-level service code.

2. **Read and write are semantic, not CRUD-shaped.**
   - Tools are named and described for ChatGPT use clarity.
   - ChatGPT never sets arbitrary DB fields directly.

3. **DB layer owns schema routing.**
   - App/MCP layer does not choose prod vs test schema.
   - Existing active-schema resolution remains silent.

4. **Working memory is a first-class artifact.**
   - Dedicated content type.
   - Dedicated retrieval path keyed by topic.
   - Never summarized on pull.

5. **Wrap is preview-first.**
   - `wrap` and `/wrap` preview markdown artifacts only.
   - Persist happens only on explicit `commit` or `/commit`.

6. **One write call per wrap.**
   - Commit sends one structured payload.
   - Backend writes both session note and working memory in one capture flow.

7. **MCP failures must be visible.**
   - ChatGPT must not silently ignore read or write failures.
   - Missing required inputs and backend/tool failures must be surfaced to the user immediately.
   - ChatGPT must stop and report the failure rather than pretending the operation succeeded.

## 5. User workflow

### 5.1 Standard conversation

1. User starts by specifying a topic.
2. ChatGPT calls `pull_working_memory(topic)`.
3. Based on topic and intent, ChatGPT calls one of:
   - `continue`
   - `last`
   - `find`
4. During discussion, ChatGPT may call more reads implicitly or explicitly:
   - `last`
   - `continue`
   - `find`
   - `pull`
5. User says `wrap` or `/wrap`.
6. ChatGPT previews:
   - session summary note markdown,
   - working memory markdown.
7. User approves, edits, or rejects.
8. User says `commit` or `/commit`.
9. ChatGPT makes one write call.
10. Backend updates:
   - conversation session note,
   - topic working memory.

### 5.2 Continue same conversation after wrap

If user continues the same conversation on the same topic after a wrap:

1. ChatGPT refreshes working memory via `pull_working_memory(topic)`.
2. Subsequent `wrap` / `/wrap` produces updated preview artifacts.
3. Commit updates the same session note and the same working-memory entry.

### 5.3 New conversation, same topic

If user starts a new conversation on the same topic:

1. ChatGPT pulls existing working memory for that topic.
2. New wrap updates working memory.
3. Commit creates a new session summary note for the new conversation.

### 5.4 Same conversation, topic shift

If the active topic changes mid-conversation:

1. ChatGPT resolves and uses a new explicit topic.
2. ChatGPT pulls working memory for the new topic.
3. Reads continue against the new topic.
4. On wrap, commit targets the new topic’s working memory.

Requirement: write payload must contain explicit resolved topic fields. Backend must not infer working-memory topic solely from free text.

## 6. MCP surface

### 6.1 Public exposure

- Public ChatGPT entrypoint: `POST /mcp`
- Dedicated tool documentation file: `docs/mcp_api.md`

### 6.2 Separation requirement

- MCP tools must not expose or proxy generic `/db/*` endpoints directly.
- Generic API remains for internal systems such as n8n orchestration.
- ChatGPT must have access only to the MCP toolset.

### 6.3 Tool namespace

Use `pkm.*` namespace.

Initial tool set:

- `pkm.last`
- `pkm.find`
- `pkm.continue`
- `pkm.pull`
- `pkm.pull_working_memory`
- `pkm.wrap_commit`

Notes:
- Preview generation for wrap can be implemented by the assistant from retrieved/contextual state; it does not need to be a separate persistence tool.
- The one explicit write tool is `pkm.wrap_commit`.

## 7. Read tools

### 7.1 Read goals

ChatGPT should be best at:

1. searching PKM for relevant prior notes / newsletters / thoughts,
2. pulling one entry with short and long context,
3. browsing recent items by topic or keyword.

Admin/debug use cases are intentionally excluded.

### 7.2 Tool semantics

#### `pkm.last`
Purpose: find the last / best relevant instances of a vaguely remembered idea when keywords are unclear.

#### `pkm.find`
Purpose: locate a specific detail or phrase (“I know it exists; I need it now”).

#### `pkm.continue`
Purpose: continue an active thinking thread on a topic with the most relevant prior context.

#### `pkm.pull`
Purpose: deterministic “give me the source” path without bloating Context Packs.

#### `pkm.pull_working_memory`
Purpose: retrieve the topic’s working-memory entry as a first-class artifact.

Special rule:
- `pull_working_memory` returns working memory without summarization.
- It is keyed by topic, not `entry_id`.
- It must exist in both regular backend application surface and MCP tool surface.

### 7.3 Read response contract

Read responses should be:

- structured JSON,
- row-based,
- faithful to existing context-pack conventions,
- standardized across methods where possible.

Priority order for v1 behavior:

1. faithfulness,
2. retrieval quality,
3. token footprint.

### 7.4 Standard read response shape

For `last`, `find`, and `continue`:

```json
{
  "meta": {
    "method": "continue",
    "q": "ai",
    "days": 90,
    "limit": 10
  },
  "rows": [
    {
      "entry_id": 90,
      "content_type": "newsletter",
      "author": "Lenny Rachitsky",
      "title": "My biggest takeaways from Sherwin Wu",
      "created_at": "2026-02-13T00:00:00.000Z",
      "topic_primary": "ai",
      "topic_secondary": "ai driven coding",
      "keywords": ["ai", "codex"],
      "gist": "...",
      "distill_summary": "...",
      "distill_why_it_matters": "...",
      "excerpt": "...",
      "url": "https://..."
    }
  ]
}
```

Notes:
- This is row-based JSON with metadata wrapper.
- Field set should stay aligned with the existing context-pack builder.
- `last`, `find`, and `continue` should return the same standardized shape; only retrieval behavior / ordering differs.

### 7.5 Excerpt policy

Default read behavior should aim for:

- summary plus raw excerpt,
- longer raw text only in dedicated context retrieval,
- full `clean_text` only when source text is short.

Implications:
- Search/browse methods return compact rows.
- `pull` is the long-context method.
- `pull_working_memory` returns canonical working-memory text without summarization.

### 7.6 Faithfulness to current context-pack behavior

v1 should preserve the current context-pack extraction order and field usage rather than re-optimizing retrieval/rendering.

Relevant current behavior to preserve:
- excerpt preference order:
  1. `distill_summary`
  2. `gist`
  3. `retrieval_excerpt` / `excerpt`
  4. `snippet`
  5. `clean_text`
  6. `capture_text`
- standardized context-pack fields include:
  - `entry_id`
  - `content_type`
  - `author`
  - `title`
  - `date`
  - `url`
  - `topic_primary`
  - `topic_secondary`
  - `keywords`
  - `why_it_matters`
  - `content`

Optimization can be done later in separate work.

## 8. Working memory artifact

### 8.1 Artifact definition

Working memory becomes a PKM-native artifact with:

- `source = chatgpt`
- `content_type = working_memory`
- `intent = thought`

### 8.2 Cardinality

- One working-memory entry per active topic.
- Keyed by normalized topic.

### 8.3 Canonical format

Working memory should stay close to the current `working_memory.md` topic structure:

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

This is the working-memory format baseline for v1.

### 8.4 Retrieval rule

Working memory must not be summarized on pull.

## 9. Session summary note artifact

### 9.1 Artifact definition

Session summary note is a PKM entry with:

- `source = chatgpt`
- `content_type = note`
- `intent = thought`

### 9.2 Cardinality

- One continuously updated session note per conversation.
- Recomputed canonically on each commit.

### 9.3 Canonical markdown structure

Proposed v1 structure:

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

Notes:
- This structure is based on the provided session-note example.
- `Summary` is explicitly required.
- Final wording/format still requires user signoff before implementation is locked.

### 9.4 Direct field mapping requirement

ChatGPT session notes are already processed artifacts. The write flow must map the structured payload directly into existing fields so that Tier-1 and Tier-2 processing is never run for these rows.

Required direct mappings:

- `gist`
- `topic_primary`
- `topic_secondary`
- `topic_secondary_confidence`
- `distill_why_it_matters`
- `distill_summary`
- `excerpt`

Requirement:
- full canonical markdown structure is stored in `capture_text`.
- backend sets the above fields directly from the wrap payload.
- chatgpt-authored session notes written through this MCP capture flow must not enter standard T1 or T2 processing.

## 10. Write flow

### 10.1 Write trigger

Write is explicit only.

- `wrap` and `/wrap` preview artifacts.
- no write occurs on wrap alone.
- persist occurs only after explicit `commit` or `/commit`.

This is separate from any OpenAI UI-level tool approval semantics.

### 10.2 Preview behavior

On wrap, ChatGPT should show both artifacts separately in markdown:

1. session summary note preview,
2. working-memory preview.

User can:
- approve as-is,
- request edits,
- continue conversation.

### 10.3 Commit behavior

On explicit commit, ChatGPT sends one JSON payload into the dedicated wrap capture flow.

Backend then writes/updates:

1. session summary note,
2. working-memory entry.

### 10.4 One-call commit contract

Commit must be a single MCP tool call containing all relevant inputs needed to derive both artifacts.

### 10.5 Write payload baseline

Initial payload:

```json
{
  "session_id": "...",
  "resolved_topic_primary": "parenting",
  "resolved_topic_secondary": "overload management",
  "chat_title": "...",
  "session_summary": "...",
  "context_used": ["..."],
  "decisions": ["..."],
  "tensions": ["..."],
  "open_questions": ["..."],
  "next_steps": ["..."],
  "working_memory_updates": ["..."],
  "why_it_matters": ["..."],
  "gist": "...",
  "topic_secondary_confidence": 0.92,
  "source_entry_refs": [90, 85, 21]
}
```

Notes:
- `gist` is a one-sentence summary.
- Payload is intentionally still broader than the likely long-term minimum.
- Final payload should be reviewed and trimmed before implementation lock.

### 10.6 Topic requirement

Write payload must contain explicit resolved topic fields.

At minimum:
- `resolved_topic_primary`

Recommended:
- `resolved_topic_secondary`
- `topic_secondary_confidence`

## 11. Capture-flow requirement

ChatGPT must not set DB fields directly.

Instead:
- ChatGPT sends a structured wrap payload.
- Backend-owned capture flow renders canonical markdown/text and maps fields.
- Backend performs idempotent insert-or-update for both artifacts.

This is a dedicated ChatGPT capture flow and is separate from generic insert/update endpoints used by n8n.

## 12. Idempotency

### 12.1 Session summary note

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

Behavior goal:
- one continuously updated note per conversation
- repeated commits update the same logical note
- unchanged canonical text may skip depending on current idempotency behavior

### 12.2 Working memory

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

Behavior goal:
- one durable working-memory row per topic
- update same logical entry on subsequent wraps

### 12.3 No-op save behavior

Preferred behavior:
- if primary matches and secondary hash is unchanged, backend may effectively skip/no-op.

However:
- do not change current idempotency implementation assumptions without verification.
- if current component cannot cleanly represent this as no-op, prefer existing `updated` semantics over idempotency redesign.

Implementation requirement:
- coding agent must verify actual current idempotency behavior with evidence and confirm with user before changing behavior.

## 13. Session identifier

v1 decision:
- use only `session_id`
- do not require `project_id`

Assumption:
- ChatGPT / MCP layer provides a usable session identifier or equivalent runtime conversation identifier.

Implementation requirement:
- verify actual runtime/session identifier availability during implementation.
- if unavailable, implementation must stop and confirm fallback strategy with user before proceeding.

## 14. Response and rendering rules

### 14.1 Session note rendering

- backend renders canonical markdown/text from structured payload
- canonical rendered text is the basis for:
  - `capture_text`
  - `clean_text`
  - secondary idempotency hash

### 14.2 Source reference storage

Persist source references as entry ids only unless a stronger reason emerges during implementation.

Do not persist full raw MCP request/response dumps by default.

## 15. ChatGPT operating protocol changes

This project’s instructions must be updated to reflect MCP-native workflow.

Required changes:

1. stop requiring manual paste of `working_memory.md` on wrap,
2. teach ChatGPT to pull working memory first for the active topic,
3. teach ChatGPT to use MCP reads throughout discussion,
4. define `wrap` / `/wrap` as preview of two artifacts,
5. define `commit` / `/commit` as explicit persist gesture,
6. treat legacy `working_memory.md` as obsolete but not yet deleted,
7. require ChatGPT to stop and report any MCP failure immediately.

A proposed updated instruction-set draft should be created alongside this PRD.

## 16. Documentation requirements

At minimum, implementation must update:

- `MCP-PRD.md`
- `docs/mcp_api.md`
- `project_instructions.md`
- any implementation-facing docs needed to keep MCP separate from generic backend API

Recommended doc boundary:

- `api.md` continues documenting internal/generic backend API
- `mcp_api.md` documents ChatGPT-facing MCP tools and payloads

## 17. Eval and observability

### 17.1 Goal

Detect whether MCP operations succeed reliably in real ChatGPT usage and prevent silent failure.

### 17.2 Required metrics

Track at minimum:

- read tool call count by tool
- read tool success count by tool
- read tool failure count by tool
- write tool call count
- write tool success count
- write tool failure count
- missing-required-field count for write payloads
- missing-`session_id` count
- missing-topic count
- backend validation failure count
- visible-failure count in chat-driven eval sessions
- silent-failure count

### 17.3 Definitions

- **success**: tool returns a valid response that satisfies contract requirements
- **failure**: tool errors, validation rejects input, required inputs are absent, or response cannot be used safely
- **visible failure**: assistant explicitly reports the MCP failure to the user and does not claim success
- **silent failure**: assistant continues as if MCP succeeded when it did not

### 17.4 Acceptance thresholds

For eval to pass:

- read success rate must be measured per tool
- write success rate must be measured for `pkm.wrap_commit`
- silent failure rate must be `0`
- false-success claim rate must be `0`
- every induced failure in scripted evals must be surfaced visibly to the user

Numeric thresholds can be tightened once baseline measurements exist, but visibility requirements are strict from v1.

### 17.5 Required eval scenarios

At minimum, run scripted evals for:

1. `pull_working_memory` success on valid topic
2. `pull_working_memory` miss / no-result path
3. `last` / `find` / `continue` success with normal payload
4. `pull` success with long-context result
5. `wrap_commit` success with complete payload
6. missing `session_id`
7. missing `resolved_topic_primary`
8. backend validation error on write
9. backend transport/tool failure on read
10. backend transport/tool failure on write
11. repeated commit with unchanged canonical text
12. same conversation second wrap after additional discussion
13. new conversation on same topic
14. topic shift in same conversation

### 17.6 Logging requirements

The MCP/backend layer should emit structured events that make the above measurable, including:

- timestamp
- tool name
- request id
- session id when present
- topic fields when present
- outcome (`success`, `validation_error`, `tool_error`, `no_result`)
- error code
- error message summary

## 18. Implementation notes and remaining follow-up

Implemented baseline decisions:
1. Session summary note canonical title:
   - `Session: <chat_title>` when `chat_title` is present
   - fallback: `Session: <resolved_topic_primary> (<YYYY-MM-DD>)`
2. Working-memory canonical title:
   - `Working Memory: <resolved_topic_primary>`
3. MCP write contract enforces explicit `session_id` and `resolved_topic_primary`.
4. MCP write flow maps structured payload directly into capture text + mapped PKM fields and writes both artifacts via one MCP tool call (`pkm.wrap_commit`).

Follow-up still required in live runtime validation:
1. Confirm real ChatGPT MCP runtime always supplies stable `session_id` value expected by the write contract.
2. Perform payload minimization pass after observing real usage and failure telemetry.

## 19. Acceptance criteria for v1

v1 is successful when:

1. User can start a topic-led conversation without manually pasting a context pack.
2. ChatGPT automatically pulls working memory for the topic.
3. ChatGPT can use `last`, `continue`, `find`, and `pull` during the conversation.
4. `wrap` and `/wrap` preview two markdown artifacts.
5. `commit` or `/commit` triggers one write call only.
6. Backend writes/updates:
   - one session note for the conversation,
   - one working-memory entry for the topic.
7. Generic internal APIs are not exposed to ChatGPT.
8. Working memory is retrievable without summarization.
9. Session summary note fields are mapped directly into `gist`, topics, topic confidence, summary, why-it-matters, and excerpt without requiring T1/T2 processing.
10. MCP failures are surfaced explicitly to the user and never hidden.
11. Eval results report measured MCP success and failure rates.
