# PRD — Generic Read And Context Pack

Status: active  
Surface owner: backend read APIs + shared context-pack builder  
Scope type: backfilled baseline  
Last verified: 2026-03-30  
Related authoritative docs: `docs/api_read_write.md`, `docs/database_schema.md`, `docs/requirements.md`, `docs/n8n_node_style_guide.md`  
Related work-package doc: none

## Purpose
Baseline the generic PKM retrieval surface and the shared context-pack builder used by workflows and the PKM UI.

## Status and scope boundary
This PRD owns:
- `POST /db/read/continue`
- `POST /db/read/find`
- `POST /db/read/last`
- `POST /db/read/pull`
- shared context-pack rendering rules and builder usage
- `10 Read` workflow at the generic read boundary
- PKM UI Read page behavior as a consumer of the generic read surface

This PRD does not own:
- topic working-memory retrieval
- ChatGPT public webhook behavior
- smoke-only selectors such as `/db/read/smoke`
- failure-pack or debug-run APIs
- classify or distill batch status semantics, even if workflow command grammar can reference them

## Current behavior / baseline
Current repo behavior is:
- backend exposes `continue`, `find`, `last`, and `pull` as separate internal read routes
- `10 Read` uses those routes through backend HTTP only
- the PKM UI Read page currently exposes `continue`, `find`, and `last`
- context-pack generation is centralized in `src/libs/context-pack-builder.js`
- both n8n and the PKM UI use the shared builder rather than maintaining divergent templates
- read projections include `keywords`, and can include `distill_summary` and `distill_why_it_matters` when present
- context-pack output omits `run_id` from the rendered text and skips `is_meta=true` rows
- the `10 Read` command parser supports command-specific `--help` / `-h` without calling backend APIs
- `/help` currently advertises read and distill-related operator commands from the read workflow shell
- `/distill-run` is parsed in the read workflow shell, but execution semantics remain owned by the Distill PRD

## Goals
- keep read semantics stable across n8n, UI, and ChatGPT-facing orchestration
- keep context-pack generation centralized and faithful
- prevent entrypoint-specific formatting drift between UI and n8n
- keep working-memory retrieval separate from generic read semantics

## Non-goals
- owning public webhook request/response envelopes
- defining topic working-memory semantics
- absorbing smoke selectors or debug investigation tools into the generic read surface
- turning UI-only affordances into backend contracts without review

## Boundaries and callers
Primary callers:
- `10 Read` workflow
- PKM UI Read page
- `11 ChatGPT Read Router` for generic methods only (`working_memory` is excluded from this PRD)

Boundary rule:
- this PRD owns the generic read methods and the shared context-pack builder
- working-memory is a separate surface even when the ChatGPT read router can expose it beside generic read methods
- this PRD also owns the user-facing read command parser/help shell in `10 Read`, except for feature-specific semantics that belong to another PRD

## Control plane / execution flow
1. caller selects one generic read method.
2. backend executes the corresponding read query.
3. caller normalizes the returned rows for presentation.
4. shared context-pack builder renders the selected rows into markdown or JSON context-pack output.

### Command parser / help shell
- The `10 Read` workflow command parser must support `--help` and `-h` on user-facing commands and return usage immediately without backend API calls.
- `/help` returns an overview block that includes current distill command forms and option flags.
- Read-surface commands such as `find`, `continue`, `last`, and `pull` keep their shell/help behavior here even when the downstream execution route lives elsewhere.
- `/distill-run` help text and shell parsing live in the read workflow command parser, while execution-mode semantics live in `docs/PRD/Distill-PRD.md`.

## Data model / state transitions
Read is a query surface, not a mutation surface.

Important returned fields for this PRD:
- row identity and timestamps
- topical metadata
- `keywords`
- excerpt / clean-text snippets as appropriate
- distill summary fields when present and relevant to ranking/rendering

### Context-pack contract
- Context-pack generation is centralized in `src/libs/context-pack-builder.js`.
- Both the PKM UI and n8n read surfaces use the shared builder rather than maintaining divergent templates.
- Output variants:
  - UI: regular Markdown using the compact UI layout
  - n8n / Telegram: MarkdownV2-safe escaped output
- Generic read hit rows include:
  - `keywords`
  - `distill_summary` when present
  - `distill_why_it_matters` when present
- Builder behavior:
  - skip `is_meta = true` rows
  - omit `run_id` from rendered context-pack text
  - include only hit rows
- Content selection priority:
  - `distill_summary`
  - `gist`
  - `retrieval_excerpt`
  - `snippet`
  - snipped `clean_text`
  - snipped `capture_text`
  - fallback `JSON keys: ...`
- For roughly the top quarter of ranked rows, include `why_it_matters` when `distill_why_it_matters` is present.
- Large string guardrail:
  - never inline full heavy payload strings in UI copy/render paths
  - prefer compact size/hash/preview summaries

### Fixed UI layout expectations
Current compact UI context-pack template:
- `## Context Pack`
- `retrieval: {method} | q="{query}" | days={days_or_default} | limit={limit_or_default}`
- `Entry {entry_id} | {content_type} | {author_or_-} | {title_or_-} | {yyyy_mm_dd}`
- `topic: {topic_primary_or_-} -> {topic_secondary_or_-}`
- `keywords: {k1, k2, k3_or_-}`
- `url: {url_or_-}`
- `content: {selected_content}`
- optional `why_it_matters: {distill_why_it_matters}` for top-ranked rows

### Payload-shape tolerance
UI read/context-pack consumers must tolerate:
- `{ run_id, rows }`
- `[{ run_id, rows }]`
- `{ rows }`, deriving `run_id` from returned rows when needed

## API / contract surfaces
Owned routes:
- `POST /db/read/continue`
- `POST /db/read/find`
- `POST /db/read/last`
- `POST /db/read/pull`

Coupled docs:
- `docs/api_read_write.md`
- `docs/database_schema.md`
- `docs/requirements.md`

## Config / runtime / topology implications
Relevant surfaces:
- n8n workflow and node code for `10 Read` and `11 ChatGPT Read Router`
- PKM UI frontend code and proxy config
- shared builder modules under `src/libs/` and `src/web/pkm-debug-ui/src/lib/`

## Evidence / recovery basis
Recovered from:
- `src/server/index.js`
- `src/libs/context-pack-builder.js`
- `src/n8n/nodes/10-read/command-parser__926eb875-5735-4746-a0a4-7801b8db586f.js`
- `src/n8n/nodes/10-read/format-help-message__83d12448-5f97-48f1-9ece-de61a9756db3.js`
- `src/web/pkm-debug-ui/src/lib/contextPackBuilder.ts`
- `src/web/pkm-debug-ui/src/pages/ReadPage.tsx`
- `src/n8n/workflows/10-read*`
- `src/n8n/workflows/11-chatgpt-read-router*`
- `docs/requirements.md`
- `docs/changelog.md`
- `test/server/n8n.command-parser.test.js`
- `test/server/context-pack-builder.test.js`

## Known gaps requiring code deep-dive
- `REVIEW_REQUIRED: verify the full command-alias grammar inside `10 Read` before rewriting user-facing command docs. This pass confirmed the canonical backend methods, but not every parser alias and operator-only shortcut exposed by the workflow node code.`
- `REVIEW_REQUIRED: decide whether `pull` should become a first-class PKM UI operation or remain workflow-only. The backend contract is stable, but the UI intentionally exposes only `continue`, `find`, and `last` today.`

## Validation / acceptance criteria
This PRD remains accurate if:
- generic read continues to use the four documented backend routes
- UI and n8n continue to use the shared context-pack builder
- working-memory remains documented separately
- read projection or context-pack changes update `docs/api_read_write.md` and any fixed builder requirements in `docs/requirements.md`
- user-facing read help continues to be immediate and does not require backend calls

## Risks / open questions
- the shared builder makes UI and n8n more consistent, but it also means output-template changes are cross-surface by default
- ChatGPT read routing sits close to this surface; changes there must preserve the distinction between generic read and working-memory behavior

## TBD
- whether generic read should own a more explicit selector contract for operator/debug shortcuts now handled only in workflow code
