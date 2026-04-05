# Recipes Surface PRD

- **Title:** Recipes surface
- **Status:** active
- **Surface owner:** PKM backend + Telegram/n8n integration surface
- **Scope type:** canonical surface
- **Baseline date / last verified date:** 2026-04-02
- **Related authoritative docs:** `docs/api.md`, `docs/api_recipes.md`, `docs/database_schema.md`, `docs/env.md`, `docs/n8n_sync.md`, `docs/n8n_node_style_guide.md`, `docs/prd-expectations.md`, `AGENTS.md`
- **Related work-package doc:** `recipes-work-packages.md`

## Use this PRD when
- adding a dedicated recipe capture/retrieval surface on top of PKM
- introducing recipe-specific backend API routes, table schema, Telegram flows, or debug UI support
- planning rollout for recipe ingestion that is intentionally separate from `entries`

## Fast path by agent
- **Planning agent:** start with sections 3, 5, 6, 7, 10, 12, 14
- **Coding agent:** start with sections 5, 6, 7, 8, 9, 10, 12
- **Reviewing agent:** start with sections 4, 7, 8, 10, 11, 12, 14
- **Architect agent:** start with sections 2, 4, 5, 7, 9, 13, 14, 15

## Section map
1. Purpose
2. Status and scope boundary
3. Current behavior / baseline
4. Goals
5. Non-goals
6. Boundaries and callers
7. Control plane / execution flow
8. Data model / state transitions
9. API / contract surfaces
10. Config / runtime / topology implications
11. Migration / rollout / rollback
12. Validation / acceptance criteria
13. Risks / open questions
14. Work-package plan
15. Target behavior
16. TBD

## 1. Purpose
Define the dedicated recipes surface for PKM DEV. This surface is intentionally **not** built on `entries`; it introduces a recipe-specific storage model, capture flow, retrieval flow, and debug tooling while still using the existing PKM backend, n8n orchestration, and Telegram interaction model.

The initial target is a narrow, high-confidence surface optimized for one user workflow:
- capture a full recipe card via Telegram
- retrieve a recipe later when the user vaguely remembers the title or dish identity
- return one likely best match plus two alternatives
- support direct retrieval by a recipe-specific public ID (`R<number>`)

## 2. Status and scope boundary
This PRD defines a **new major functionality surface**.

In scope for V1:
- dedicated `recipes` database table
- recipe-specific backend API routes
- Telegram one-shot recipe capture from structured or semi-structured pasted text
- lexical search over title, ingredients, and selected static metadata columns
- direct retrieval by public recipe ID (`R42` shape)
- full overwrite and patch update APIs
- review queue support for incomplete non-required metadata
- debug UI page for searching, reading, and updating recipes

Out of scope for V1:
- reuse of `entries` as recipe storage
- URL recipe import
- Notion recipe import
- image, OCR, or voice-note recipe capture
- weak captures / recipe fragments / multilingual note fragments
- embeddings or semantic vector fallback
- meal planning or inspiration browsing
- grocery list generation
- family feedback / ratings / made-history

## 3. Current behavior / baseline
### 3.1 Confirmed baseline
The recipes V1 surface is implemented and documented:
- dedicated mirrored `recipes` tables in `pkm` and `pkm_test`
- backend `/recipes/*` endpoints for create/search/get/patch/overwrite/review
- debug UI `/recipes` operator page
- Telegram command path in `10 Read` (`/recipe`, `/recipes`, `/recipe-save`)

### 3.2 Consequence for this PRD
This PRD is now a canonical active-surface owner and should be updated alongside schema/API/workflow changes instead of treated as proposal-only text.

### 3.3 Baseline assumptions
- generic `/db/insert`, `/db/update`, `/db/read/*`, and `/db/read/pull` exist for `entries`
- current normalization endpoints are `entries`-compatible rather than recipe-native
- debug endpoints already exist and are admin-protected, which provides a precedent for adding recipe support to the debug UI
- existing Telegram workflow patterns and n8n/backend separation remain the default integration style

### 3.4 REVIEW_REQUIRED items
- none currently

## 4. Goals
### 4.1 Primary user goal
Allow the user to recover a saved recipe later when they only vaguely remember its name or identity.

### 4.2 Product goals
- keep capture fast enough for Telegram use
- keep retrieval precise enough that the top result is usually correct
- keep recipe data clean by storing only full recipes in V1
- keep recipe and entry IDs visibly distinct
- keep recipe logic isolated from `entries` to avoid bending generic ingestion and T1/T2 flows around recipe-specific needs

### 4.3 Operational goals
- keep backend contract explicit and documented before implementation
- keep schema, API, n8n, and UI changes aligned in one surface plan
- keep future embeddings as an additive change rather than a V1 dependency

## 5. Non-goals
- build a broad culinary knowledge system
- normalize arbitrary freeform household recipe notes in V1
- support multilingual weak captures in V1
- maximize recall at the expense of false positives
- support inspiration/discovery as a first-class use case
- create a recipe-specific LLM pipeline in V1
- add config-driven business logic unless clearly required

## 6. Boundaries and callers
### 6.1 External user boundary
Primary user interaction happens through Telegram.

### 6.2 n8n boundary
n8n remains the orchestration layer for Telegram-triggered workflows and backend calls.

### 6.3 Backend boundary
PKM backend owns recipe API contracts, validation, read/write logic, and debug UI support.

### 6.4 Database boundary
Recipes use a dedicated `recipes` table rather than `pkm.entries`.

### 6.5 Debug UI boundary
Debug UI gets a dedicated **Recipes** page for search/read/update support. The debug UI is not the primary user surface; it is an operator/developer surface.

### 6.6 Deliberate exclusions
- Notion import is intentionally excluded from V1 even though recipe content may currently exist in Notion
- URL import is intentionally excluded from V1 due to poor extraction quality and SEO-heavy recipe pages

## 7. Control plane / execution flow
### 7.1 V1 capture flow: Telegram one-shot paste
1. User sends a recipe in structured or semi-structured Markdown/text to Telegram.
2. Telegram entry workflow validates sender according to existing Telegram workflow conventions.
3. n8n parses the message into a recipe-create payload.
4. Backend validates required fields:
   - `title`
   - `ingredients`
   - `instructions`
   - `servings`
5. Backend normalizes stored fields:
   - normalized title for dedupe
   - flattened `search_text`
   - computed `total_time_minutes`
   - review reasons if configured review-trigger fields are missing
6. Backend writes the row to `recipes`.
7. Telegram replies with create status and review status/reasons when applicable.

### 7.2 V1 search flow
1. User sends a recipe retrieval request via Telegram.
2. n8n sends query to recipe search API.
3. Backend filters out `archived` rows.
4. Backend ranks candidates using lexical scoring with this priority order:
   1. title exact/partial match
   2. ingredient overlap
   3. metadata match
   4. weak recency tie-breaker
5. Backend returns:
   - one full top hit
   - two compact alternatives
6. Telegram renders the same compact/full recipe card shape used for direct lookup.

### 7.3 V1 direct lookup flow
1. User sends `/recipe R42`.
2. n8n resolves the command and calls recipe get-by-public-id API.
3. Backend returns the full recipe object.
4. Telegram renders the user-facing recipe card with all ingredients, instructions, and notes.
5. Direct ID lookup may return archived recipes; search results may not.

### 7.4 V1 update flow
1. Operator or future user-facing flow submits full overwrite or patch.
2. Backend applies update.
3. Backend recomputes review status automatically on every write.
4. `archived` remains explicit and is not overwritten by review recomputation.

### 7.5 V1 review queue flow
1. Backend records `needs_review` when configured review-trigger fields are missing.
2. Backend stores machine-readable review reasons in metadata JSONB.
3. `GET /recipes/review` returns recipe ID, title, and reasons for recipes requiring follow-up.

## 8. Data model / state transitions
### 8.1 Table choice
Use a dedicated `recipes` table.

### 8.2 Identity model
- internal primary key: `id bigint generated by default as identity`
- public ID: `public_id text generated always as ('R' || id::text) stored`
- public ID is the user-facing identifier for Telegram and API payloads
- preferred implementation uses generated stored columns for both `public_id` and `total_time_minutes` rather than trigger/app-layer maintenance unless implementation constraints force otherwise

### 8.3 Proposed V1 columns
Required/core:
- `id bigint primary key`
- `public_id text unique`
- `created_at timestamptz`
- `updated_at timestamptz`
- `title text not null`
- `title_normalized text not null`
- `servings int not null`
- `ingredients text[] not null`
- `instructions text[] not null`
- `notes text null`
- `search_text text not null`
- `status text not null default 'active'`
- `metadata jsonb null`
- `source text null`

Static metadata columns:
- `cuisine text null`
- `protein text null`
- `prep_time_minutes int null`
- `cook_time_minutes int null`
- `total_time_minutes int generated always as (coalesce(prep_time_minutes, 0) + coalesce(cook_time_minutes, 0)) stored`
- `difficulty text null`
- `tags text[] null`
- `url_canonical text null`
- `capture_text text not null`
- `overnight boolean not null default false`

### 8.4 Explicitly not in JSONB for V1
- searchable static metadata columns listed above
- primary recipe identity and retrieval fields

### 8.5 JSONB metadata use in V1
`metadata` remains available for:
- review metadata
- parser warnings
- future-compatible non-core annotations

Recommended initial shape:
```json
{
  "review": {
    "required": true,
    "reasons": ["missing_cuisine", "missing_difficulty"]
  },
  "parser": {
    "mode": "semi_structured",
    "warnings": []
  }
}
```

### 8.6 Review-trigger fields
Missing any of these fields triggers `needs_review`:
- `cuisine`
- `protein`
- `prep_time_minutes`
- `cook_time_minutes`
- `difficulty`
- `servings`

### 8.7 Status values
Allowed V1 statuses:
- `active`
- `needs_review`
- `archived`

### 8.8 State transition rules
- new valid write with all review-trigger fields present -> `active`
- new valid write with missing review-trigger fields -> `needs_review`
- explicit archive action -> `archived`
- overwrite/patch recomputes `active` vs `needs_review` automatically unless row is explicitly archived

### 8.9 Dedupe rule
V1 dedupe rule is case-insensitive exact-title dedupe.

Behavior:
- duplicate title blocks create
- response shows existing recipe public ID
- caller/user must rename the variant explicitly

### 8.10 Search visibility rule
- `archived` rows are excluded from normal search
- `needs_review` rows are fully searchable
- direct lookup by `public_id` can return archived rows

## 9. API / contract surfaces
This section defines target contract shapes for implementation. Request/response examples must be attached in `docs/api.md` or a recipe domain API doc before implementation begins.

### 9.1 Create API
Purpose:
- create one recipe from structured or semi-structured pasted text payload

Expected behavior:
- validates required fields
- blocks duplicate title
- stores recipe row
- returns standard response shape

Standard response shape:
- `public_id`
- `title`
- `status`
- `review_reasons`
- selected key metadata used by Telegram confirmation

### 9.2 Search API
Purpose:
- retrieve one best match plus two alternatives

Expected response shape:
- `top_hit`: full recipe payload used for Telegram card rendering
- `alternatives`: compact recipe records for two additional candidates

### 9.3 Get-by-ID API
Purpose:
- fetch a recipe by `public_id`

Behavior:
- supports `/recipe R42`
- returns full recipe object including archived rows

### 9.4 Update APIs
Support both:
- full overwrite
- patch selected fields

Behavior:
- recompute review status on every write
- preserve explicit `archived` status unless explicitly changed

### 9.5 Review queue API
`GET /recipes/review` returns recipes needing follow-up.

Minimum response fields:
- `id`
- `public_id`
- `title`
- `status`
- `review_reasons`
- `created_at`

Operational note:
- recipe APIs should support `test_mode` using the same pattern already used for `entries`-related surfaces rather than inventing a recipe-specific variant

### 9.6 Debug UI surface
Add a **Recipes** page in the debug UI with support for:
- search
- read
- update

The debug UI should consume full backend recipe payloads, including `search_text`, and remain an operator/developer surface rather than the primary user interface.

### 9.7 Direct Telegram command contract
Initial direct command:
- `/recipe R42`

Other Telegram search/capture commands remain implementation-defined in V1 and should be finalized in API/examples before coding.

### 9.8 Input format contract for one-shot paste
#### Canonical structured format
```md
# Title

- Servings: 4
- Cuisine: Italian
- Protein: Chicken
- Prep time: 15
- Cook time: 30
- Difficulty: Easy
- Tags: weeknight, pasta
- Overnight: false
- URL: https://example.com

## Ingredients
- 500 g chicken thighs
- 250 g pasta

## Instructions
1. ...
2. ...

## Notes
- optional
```

Notes:
- ingredients may use metric or non-metric units
- `Notes` section is optional
- parser may accept semi-structured variations under V1 guardrails

#### Semi-structured guardrails
- headings may vary slightly
- ingredients and instructions sections must still be identifiable
- freeform blob parsing is out of scope
- failure to identify required sections results in rejection rather than weak inference

## 10. Config / runtime / topology implications
### 10.1 Expected touched surfaces
- backend routes/controllers/stores for recipes
- database schema and migration files
- n8n Telegram workflow(s)
- debug UI page(s)
- API and schema docs
- PRD registry/docs

### 10.2 Non-goal on config
V1 should avoid introducing new business defaults as ad hoc config unless implementation proves a real need.

### 10.3 Topology
No intended new external service in V1.

### 10.4 Debug UI security
Recipes debug UI should follow existing debug UI/admin protection patterns already in the repo. No new proxy/admin-secret handling is intended beyond existing patterns.

### 10.5 Telemetry / pipeline events
Recipe flows should follow the existing `pipeline_events` pattern rather than inventing an unrelated telemetry surface. Recipe-specific event naming and payload conventions are captured in `docs/recipes_telemetry_conventions.md` and should be reflected in authoritative docs if they become contractual.

## 11. Migration / rollout / rollback
### 11.1 Migration plan
- add new `recipes` table migration
- add indexes and constraints
- add recipe API routes
- add n8n workflow changes for recipe capture/retrieval
- add debug UI Recipes page
- update docs in same change set

### 11.2 Backfill
No data backfill required for V1 because Notion import and URL import are deferred.

### 11.3 Rollout order
1. schema + backend stores
2. API routes + tests
3. debug UI support
4. n8n workflow wiring
5. Telegram command rollout
6. docs alignment and PRD registry update

### 11.4 Rollback
Rollback should be straightforward because V1 introduces an isolated table and surface.

Rollback scope:
- disable Telegram workflow branch
- remove UI entry points
- stop calling recipe APIs
- optionally retain dormant table/data unless schema rollback is explicitly required

## 12. Validation / acceptance criteria
### 12.1 Capture acceptance
- structured recipe paste with title, servings, ingredients, and instructions saves successfully
- semi-structured recipe paste saves only when ingredients and instructions sections are identifiable
- missing required fields reject the write
- missing named review-trigger fields save as `needs_review` with machine-readable reasons
- duplicate title returns error plus existing `public_id`

### 12.2 Retrieval acceptance
- lexical search returns one best full hit plus two compact alternatives
- archived rows do not appear in normal search
- `/recipe R42` returns the target recipe card if it exists
- `/recipe R42` can return archived rows

### 12.3 Update acceptance
- patch and overwrite paths both work
- review status is recomputed automatically on every write
- archived status is not accidentally cleared by recomputation

### 12.4 UX acceptance
User-facing recipe card includes:
- title and `#R42`
- review badge when `needs_review`
- servings / cuisine / protein / difficulty when present
- prep / cook / total time when present
- tags when present
- all ingredients
- all instructions
- all notes

### 12.5 Debug acceptance
Debug UI Recipes page can:
- search recipes
- open recipe detail
- edit recipes
- surface full payload including `search_text`

## 13. Risks / open questions
### 13.1 Main risks
- semi-structured parsing may still be brittle if source formatting drifts
- case-insensitive title dedupe may be too strict for near-identical recipes with legitimate same-name variants
- storing full instructions in user-facing card may produce long Telegram responses for very verbose recipes
- review-trigger fields may create too many `needs_review` rows if capture discipline is weak

### 13.2 Open questions
- whether a compact Telegram result needs explicit truncation rules for very long instructions/notes

## 14. Work-package plan
Implementation should be broken into an optional work-package companion rather than encoded only as prose. See `recipes-work-packages.md`.

## 15. Target behavior
### 15.1 Post-V1 direction
After V1 is stable, expand the surface cautiously.

Likely next additions:
- URL import once extraction quality is good enough
- weak/fragment capture flows
- richer operator review tooling
- semantic fallback for retrieval

### 15.2 Embeddings direction
Embeddings are **not** part of V1.

Preferred V2 direction:
- add recipe-level embeddings only after lexical retrieval baseline is stable
- prefer `pgvector` for vector storage/query inside Postgres
- use embeddings as a fallback/hybrid layer rather than the primary retrieval mechanism
- keep one recipe-level embedding derived from flattened retrieval text rather than per-field embeddings initially

### 15.3 Retrieval target for V2
Desired V2 retrieval shape remains hybrid:
- lexical retrieval first
- vector fallback or blended rerank when lexical confidence is weak
- still return one best result plus alternatives rather than switching to an inspiration-first UX

## 16. TBD
- whether compact Telegram rendering needs explicit truncation rules for very long instructions/notes
