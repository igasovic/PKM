# PRD — Core Ingest

Status: active  
Surface owner: n8n capture flows + backend ingest normalization/insert boundary  
Scope type: backfilled baseline  
Last verified: 2026-03-30  
Related authoritative docs: `docs/api_ingest.md`, `docs/api_read_write.md`, `docs/database_schema.md`, `docs/config_operations.md`, `docs/n8n_sync.md`, `docs/requirements.md`  
Related work-package doc: none

## Purpose
Baseline the ingest surface that turns external captures into PKM entry writes, while keeping classify and distill as separate downstream surfaces.

## Use this PRD when
- changing Telegram, email, Notion, or webpage ingest behavior before classify starts
- changing normalization output, idempotent insert/update semantics, or ingest-side quality/retrieval projections
- deciding whether email backlog import belongs with ingest or classify

## Fast path by agent
- Coding agent: read `Status and scope boundary`, `Control plane / execution flow`, `Method matrix`, `Write-boundary contract`, and `API / contract surfaces`.
- Planning agent: read `Goals`, `Boundaries and callers`, `Control plane / execution flow`, `Contract delta table`, and `Risks / open questions`.
- Reviewing agent: read `Status and scope boundary`, `Idempotency policy ownership`, `Content-hash invariants`, `Batch write expectations`, and `Validation / acceptance criteria`.
- Architect agent: read `Boundaries and callers`, `Contract delta table`, `Write-boundary contract`, `Config / runtime / topology implications`, and `Risks / open questions`.

## Section map
- Flow shape: `Control plane / execution flow`
- Ingest-method differences: `Method matrix`
- DB-write and idempotency rules: `Data model / state transitions`
- Endpoint ownership: `API / contract surfaces`
- Remaining uncertainty: `Known gaps requiring code deep-dive`, `TBD`

## Status and scope boundary
This PRD owns:
- normalization for Telegram, email, webpage/article text, and Notion
- idempotency and content-hash expectations for ingest payloads
- ingest-side use of `/db/insert` and `/db/update`
- email backlog import through the point where classify work is enqueued
- n8n workflows `02 Telegram Capture`, `03 E-Mail Capture`, `04 Notion Capture`, `22 Web Extraction`, and `23 E-Mail Batch Import` at the ingest boundary

This PRD does not own:
- Tier-1 classify semantics or batch lifecycle after enqueue
- Tier-2 distill behavior
- generic read/context-pack behavior
- working-memory artifacts
- family-calendar contracts

## Current behavior / baseline
Current repo behavior is:
- normalization orchestration is backend-owned in `src/server/ingestion-pipeline.js`, not in workflow-local helper code
- `content_hash` is derived only from persisted `clean_text`
- retrieval excerpt and quality fields are applied in the backend ingestion pipeline, not duplicated in n8n
- conflict resolution is enforced in backend DB insert logic, not in n8n
- Telegram, email, email-batch, and Notion ingest are fail-closed when required idempotency fields are missing
- `/normalize/webpage` returns DB-ready quality/retrieval projections for `/db/update`, but intentionally does not derive idempotency
- `/normalize/notion` runs `collect -> normalize -> idempotency -> quality`, with a non-fatal skip path for unsupported block types
- `/import/email/mbox` normalizes each message synchronously, inserts idempotently, records partial failures, and enqueues classify batches only for rows that were not skipped
- backlog import uses `source = "email-batch"` while preserving email idempotency semantics by aliasing `email-batch` to `email` during idempotency derivation

## Goals
- keep ingest deterministic and rerunnable
- keep idempotency and content-hash logic centralized in backend normalization and DB layers
- make every ingest method end in the same DB-ready entry contract
- keep backlog import grouped with ingest, but only up to the enqueue handoff into classify

## Non-goals
- defining Tier-1 output fields or classify state transitions
- exposing raw DB behavior directly to n8n
- turning every caller-specific workflow quirk into a backend contract
- moving prompt/instruction behavior into ingest docs

## Boundaries and callers
Primary callers:
- `02 Telegram Capture` -> `/normalize/telegram` -> `/db/insert`
- `03 E-Mail Capture` -> `/normalize/email` -> `/db/insert`
- `04 Notion Capture` -> `/normalize/notion` -> `/db/insert`
- `22 Web Extraction` -> `/normalize/webpage` -> `/db/update`
- `23 E-Mail Batch Import` -> `/import/email/mbox`

Boundary rule:
- ingest owns normalization, DB-ready payload construction, idempotent insert/update, and the decision about whether a row should continue downstream
- classify owns what happens after a row or batch is handed off for Tier-1 processing

## Contract delta table
| Surface | Changes? | Baseline known? | Notes |
|---|---|---|---|
| Internal backend API | no | yes | routes and write-boundary behavior recovered from code and current API docs |
| Public webhook API | no | yes | out of scope here |
| Database schema | no | yes | schema facts stay in `docs/database_schema.md`; this PRD owns ingest expectations that rely on them |
| Config / infra | no | mostly | import root and Notion token dependency are known; no new config surface added here |
| n8n workflows / nodes | no | yes | current workflow callers recovered for `02`, `03`, `04`, `22`, `23` |
| Runtime topology | no | yes | existing backend-only ingest path remains in place |
| Docs | yes | yes | this pass backfills deeper ingest ownership into the canonical PRD |
| Tests | no | yes | normalization/idempotency/email-import tests already cover key behaviors |

## Control plane / execution flow
### Sync capture flows
1. n8n receives source-specific input.
2. Backend normalization converts that input into the canonical PKM entry shape.
3. n8n sends the normalized payload to `/db/insert`.
4. backend DB conflict handling returns `inserted`, `updated`, or `skipped`.
5. only non-skipped rows are eligible for downstream classify handoff.

### Web extraction update flow
1. workflow or caller provides extracted or cleaned webpage text.
2. `/normalize/webpage` recalculates clean-text-derived retrieval and quality fields.
3. caller updates the existing entry through `/db/update`.

### Email backlog import
1. `/import/email/mbox` reads an `.mbox` file from the approved import root.
2. each message is parsed and normalized through the same email-ingest pipeline used by normal capture.
3. inserts run in chunked batch mode with per-item failure isolation.
4. non-skipped rows with usable `clean_text` are accumulated for classify batch enqueue.
5. classify batch enqueue happens through `/enrich/t1/batch`, but the classify lifecycle after enqueue belongs to `docs/PRD/classify-prd.md`.

## Method matrix

| Method | Backend sequence | Output intent | Write boundary |
|---|---|---|---|
| Telegram | `normalize -> quality -> idempotency` | note/thought or link/archive | `/db/insert` |
| Email | `normalize -> quality -> idempotency` | newsletter, correspondence, or note | `/db/insert` |
| Notion | `collect -> normalize -> skip-or-idempotency -> quality` | note/archive depending on content type | `/db/insert` |
| Webpage | `normalize -> quality` | update existing entry projections | `/db/update` |
| Email backlog import | `parse mbox -> normalize email -> batch insert -> classify enqueue` | backlog ingest up to classify handoff | `/db/insert` then `/enrich/t1/batch` |

### Telegram normalization modes
- If the message starts with a JSON object followed by remainder text, Telegram normalization treats it as a note/thought path:
  - `content_type = note`
  - `intent = think`
  - `clean_text = remainder after the parsed JSON object`
- Otherwise Telegram normalization checks for the first URL in the message text:
  - if present, it becomes a link/newsletter-style ingest path
  - `content_type = newsletter`
  - `intent = archive`
  - `url_canonical` is derived in backend normalization
- Otherwise the message remains a note/thought path without a URL.

### Email normalization modes
- Email normalization first performs transport cleanup, forwarded-envelope detection, mojibake cleanup, and body extraction.
- Intent and `content_type` are then chosen from cleaned core text:
  - newsletter
  - correspondence
  - note
- When forwarded-envelope headers are detected, they override top-level header values for author/title/idempotency source metadata.
- Email correspondence and newsletter normalization use different text-clean paths, but both still end in the same DB-ready entry contract.

### Notion normalization modes
- Notion page-content collection happens before normalization through the backend Notion client.
- Unsupported blocks are handled as a non-fatal skip path rather than a transport failure.
- Idempotency runs before quality/retrieval enrichment for the normal Notion path.

### Webpage normalization mode
- Webpage normalization is update-oriented, not insert-oriented.
- If normalized clean text is empty, the response sets `retrieval_update_skipped = true` and `content_hash = null`.
- Callers should treat that as a skip-overwrite signal for retrieval fields rather than forcing an empty update.

## Data model / state transitions
Ingest is responsible for producing or updating these entry-shaping fields before persistence:
- canonical source and content-type metadata
- `clean_text`
- `content_hash`
- idempotency policy key and conflict keys
- retrieval/quality projections when normalization owns them

State outcomes expected from ingest write paths:
- `inserted`
- `updated`
- `skipped`
- explicit error on invalid or incomplete ingest input

### Idempotency policy ownership
This PRD owns the ingest requirement that normalization and DB writes agree on these policy families:

| Policy | Source/method | Conflict action | Primary key shape | Secondary key shape |
|---|---|---|---|---|
| `telegram_thought_v1` | Telegram thought/note path | `update` | `tg:{chat_id}:{message_id}` | `sha256(clean_text)` when available |
| `telegram_link_v1` | Telegram link path | `skip` | canonical URL | `sha256(canonical_url)` |
| `email_newsletter_v1` | Email and email-batch newsletter path | `skip` | `message_id` when present | `sha256(from_addr + subject_base + date_bucket)` |
| `email_correspondence_thread_v1` | Email correspondence path | `update` | `sha256(subject_base)` | none |
| `notion_note_v1` | Notion note | `update` | `notion:{page_id}` | `sha256(created_at + title)` when available |
| `notion_newsletter_v1` | Notion newsletter | `update` | `notion:{page_id}` | `sha256(created_at + title)` when available |
| `notion_correspondence_v1` | Notion correspondence | `update` | `notion:{page_id}` | `sha256(created_at + title)` when available |
| `notion_other_v1` | Notion other | `update` | `notion:{page_id}` | `sha256(created_at + title)` when available |

### Content-hash invariants
- `content_hash` is derived only from `clean_text`.
- Algorithm:
  - SHA-256
  - UTF-8 bytes of the persisted `clean_text`
  - lowercase hex digest
- `content_hash` is `null` when `clean_text` is missing or blank after trim.
- Any ingest/update flow that recalculates `clean_text` must recalculate `content_hash` in the same step before persistence.

### Write-boundary contract
- `POST /db/insert` is the canonical ingest insert boundary.
- `POST /db/update` is the canonical ingest update boundary for webpage and downstream writeback flows.
- For `entries` writes, backend resolves idempotency behavior from the active schema's `idempotency_policies` table.
- Required idempotency sources are:
  - `telegram`
  - `email`
  - `email-batch`
  - `notion`
- Conflict behavior is backend-owned:
  - `skip` returns the existing row with `action = "skipped"`
  - `update` updates the existing row in place and returns `action = "updated"`
  - fresh inserts return `action = "inserted"`
- Immutable denylist for idempotent updates:
  - `id`
  - `entry_id`
  - `created_at`
- When policy `update_fields` is absent, backend updates all allowed incoming columns.
- When policy `update_fields` is present, backend updates only those allowed columns.
- `metadata` is recursively merged for idempotent updates instead of being blindly overwritten.

### Batch write expectations
- `/db/insert` and `/db/update` both support `items: []` batch mode.
- Batch mode with `continue_on_error = true` must return per-item result rows with:
  - `_batch_index`
  - `_batch_ok`
  - `error` on failures
- Email backlog import relies on this contract and must not abort the whole request when one item fails.
- Backend currently includes a bulk fast path for homogeneous `skip`-policy insert batches, with fallback to per-item insert behavior when shapes or policies require it.

### Retrieval / quality ownership at ingest time
- Shared quality logic is applied in backend ingestion orchestration, not copied into n8n nodes.
- Returned retrieval/quality fields must stay DB-ready for direct `/db/insert` or `/db/update` usage.
- This includes:
  - `retrieval_excerpt`
  - `clean_word_count`
  - `clean_char_count`
  - `extracted_char_count`
  - `link_count`
  - `link_ratio`
  - `boilerplate_heavy`
  - `low_signal`
  - `quality_score`
  - `metadata.retrieval`

## API / contract surfaces
Owned or coupled internal routes:
- `POST /normalize/telegram`
- `POST /normalize/email/intent`
- `POST /normalize/email`
- `POST /normalize/webpage`
- `POST /normalize/notion`
- `POST /import/email/mbox`
- `/db/insert` and `/db/update` as the ingest write boundary

Related docs that must move with contract changes:
- `docs/api_ingest.md`
- `docs/database_schema.md`
- `docs/requirements.md` when idempotency or ingest invariants change

## Config / runtime / topology implications
Relevant config/runtime surfaces:
- Notion collector token and backend runtime config needed for Notion block fetches
- n8n workflow authoring and sync surfaces under `src/n8n/`
- host-mounted import root used by `/import/email/mbox`

No new config surface should be introduced here without updating `docs/config_operations.md`.

## Evidence / recovery basis
Recovered from:
- `src/server/index.js`
- `src/server/ingestion-pipeline.js`
- `src/server/normalization.js`
- `src/server/idempotency.js`
- `src/server/db.js`
- `src/server/email-importer.js`
- `src/n8n/workflows/02-telegram-capture*`
- `src/n8n/workflows/03-e-mail-capture*`
- `src/n8n/workflows/04-notion-capture*`
- `src/n8n/workflows/22-web-extraction*`
- `src/n8n/workflows/23-e-mail-batch-import*`
- `docs/requirements.md`
- `docs/changelog.md`
- `test/server/normalization.test.js`
- `test/server/idempotency.test.js`

## Known gaps requiring code deep-dive
- `REVIEW_REQUIRED: confirm whether `/normalize/email/intent` should remain a separate stable ingest contract or become a private helper behind `/normalize/email`. The current repo still exposes and documents it, but long-term ownership is not yet explicit.`

## Validation / acceptance criteria
This PRD remains accurate if:
- ingest normalization continues to own idempotency-key and content-hash construction
- n8n callers continue to use backend normalization and backend DB methods rather than hand-crafting ingest rows
- email backlog import remains ingest-owned only through the enqueue boundary
- changes to ingest methods update `docs/api_ingest.md` and any impacted invariants in `docs/requirements.md`

## Risks / open questions
- ingest and classify are tightly coupled in some workflows; changes must preserve the handoff boundary rather than collapsing the two surfaces back together
- Notion remains backend-owned for page-content collection; if collection moves elsewhere, this PRD and `docs/api_ingest.md` must move together

## TBD
- whether webpage normalization should remain a caller-visible contract or become purely internal to web-extraction workflows
- whether email-intent detection remains a first-class endpoint long-term
