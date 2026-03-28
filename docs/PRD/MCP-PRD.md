# MCP / Custom GPT Integration PRD (Canonical)

Status: Active canonical PRD (consolidated)  
Owner: Igor / ChatGPT  
Last updated: 2026-03-27

## 1) Baseline and decision

The integration has transitioned from public MCP to **Custom GPT actions over n8n webhooks**.

Current baseline:
- Public MCP path is legacy-disabled (`POST /mcp` returns `410 legacy_disabled`).
- Public ChatGPT boundary is n8n webhook endpoints only.
- n8n performs command parsing, routing, and context-pack building.
- Backend stays internal (`/db/read/*`, `/chatgpt/*`).

This PRD is the single source of truth for this surface.

## 2) Goals

1. Keep ChatGPT integration public surface narrow and stable.
2. Preserve topic-first PKM workflow with working-memory support.
3. Keep backend/API/DB boundaries internal and unchanged where possible.
4. Make failure states explicit (no silent success claims).
5. Maintain write preview (`wrap`) -> explicit persist (`commit`) behavior.

## 3) Non-goals

- Re-introducing public MCP as an active path.
- Exposing backend generic endpoints directly to Custom GPT.
- Adding new DB schema or environment dependencies for this surface without explicit approval.
- Replacing existing read semantics (`pull/continue/last/find`) with a new retrieval system.

## 4) Control plane and execution flow

Supported public flow:

```text
Custom GPT action
-> n8n webhook (public)
-> n8n parse + route + context-pack build
-> internal backend route
-> Postgres
-> n8n normalized response
-> Custom GPT
```

Write path:

```text
wrap (preview only)
commit (explicit)
-> POST /pkm/chatgpt/wrap-commit (n8n)
-> POST /chatgpt/wrap-commit (internal backend)
-> upsert session note + working memory
```

Read path:

```text
POST /pkm/chatgpt/read (n8n)
-> parse command
-> switch by method
-> one backend call
-> build context pack
-> normalized envelope response
```

## 5) External API surface (public)

Public webhook endpoints (Custom GPT-facing):
- `POST /pkm/chatgpt/read`
- `POST /pkm/chatgpt/wrap-commit`

Canonical contract location:
- `docs/external_api.md`
- `chatgpt/action_schema.yaml` (OpenAPI for Custom GPT actions)

### 5.1 Read command set

WF11 supports:
- `pull`
- `last`
- `continue`
- `find`
- `working_memory`

Command parsing supports explicit method fields (`cmd`/`method`/`read_method`), intent aliases, and command text fallback.

### 5.2 Response model

Read responses are normalized envelopes with:
- `ok`
- `action`
- `method`
- `outcome` (`success|no_result|failure`)
- `context_pack_markdown`
- `result`
- `error`

Wrap-commit response envelope includes:
- `ok`
- `action=chatgpt_wrap_commit`
- `outcome`
- `result`

## 6) Internal API surface (n8n -> backend)

Internal backend routes used by workflows:

Read router (`WF11`):
- `POST /db/read/pull`
- `POST /db/read/last`
- `POST /db/read/continue`
- `POST /db/read/find`
- `POST /chatgpt/working_memory`

Wrap commit (`WF05`):
- `POST /chatgpt/wrap-commit`

Important:
- `POST /chatgpt/read` is removed.
- `/mcp` remains legacy-disabled and not part of active ChatGPT integration.

## 7) Workflow responsibilities

### 7.1 WF05 — `05 ChatGPT Wrap Commit`

Responsibilities:
- validate required payload fields (`session_id`, `resolved_topic_primary`),
- normalize write payload,
- call internal backend wrap-commit route,
- return action result envelope.

### 7.2 WF11 — `11 ChatGPT Read Router`

Responsibilities:
- parse and validate command,
- route via switch to one backend read call,
- build context pack in n8n,
- return normalized success/no-result/failure envelope,
- respond via webhook response node (not immediate webhook ack).

## 8) Data model and idempotency

Persisted artifacts on commit:
1. Session summary note
   - `source=chatgpt`, `content_type=note`, `intent=thought`
   - policy: `chatgpt_session_note_v1`
   - primary key shape: `chatgpt:<session_id>`
2. Topic working memory
   - `source=chatgpt`, `content_type=working_memory`, `intent=thought`
   - policy: `chatgpt_working_memory_v1`
   - primary key shape: `wm:<normalized_topic_primary>`

Both may use `sha256(clean_text)` as secondary key.

## 9) Validation and state transitions

Write (`wrap-commit`) states:
1. validate input (required fields)
2. backend capture flow
3. artifact upsert outcome
4. response envelope (`ok=true/false`)

Read (`read`) states:
1. parse request -> resolve method
2. validate required params per method
3. call one backend endpoint
4. build context pack
5. return `success`, `no_result`, or `failure`

Failure policy:
- failures must be explicit in response.
- assistant behavior on failure: stop and report; do not claim success.

## 10) Observability

Minimum events/fields expected from workflow + backend logs:
- action name
- routed method (for reads)
- request/run id
- outcome (`success|no_result|failure|validation_error`)
- short error code/message

Success criteria for quality checks:
- no silent failures,
- no false success claims,
- measurable success/failure rates for read and write.

## 11) Documentation ownership

- `docs/external_api.md`: public Custom GPT webhook contracts.
- `chatgpt/action_schema.yaml`: action schema consumed by Custom GPT builder.
- `docs/api.md`: internal backend API used by n8n.
- `chatgpt/project_instructions.md`: runtime assistant behavior contract.
- `docs/PRD/project_instructions.v3.md`: PRD copy of instruction contract.

## 12) Work packages

Implementation planning and sequencing live in:
- `docs/PRD/MCP-work-packages-v2.md`

Current status snapshot:
- Public MCP path disabled: complete
- WF05 wrap commit path: complete
- WF11 n8n read routing + context-pack build: complete
- Public action schema + external API docs: complete
- Legacy MCP API doc archived at `docs/archive/mcp_api.md`

## 13) Acceptance criteria

This PRD is satisfied when:
1. Custom GPT uses only n8n webhook actions.
2. `/mcp` is not used for active ChatGPT integration.
3. WF11 routes commands in n8n and returns normalized envelopes.
4. WF05 persists both artifacts through one commit call.
5. Topic working-memory retrieval is supported through `working_memory` command.
6. Contracts remain split cleanly between `docs/external_api.md` and `docs/api.md`.
7. Failure behavior is explicit and observable.

## 14) TBD

- Exact long-term minimal write payload (after stable usage data).
- Whether to simplify read aliases and keep only canonical request fields in v2.
- Additional automated contract tests for public webhook envelopes.
