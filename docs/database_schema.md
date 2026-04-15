# PKM Database Schema v2.8 (Observed + Required Runtime Tables)

## Purpose
- define the authoritative database schemas, tables, grants, and lifecycle notes used by PKM
- help agents distinguish mirrored tables, prod-only tables, and admin-sensitive operations

## Authoritative For
- schema and table inventory
- grants, constraints, indexes, and prod/test mirroring
- DB facts that affect API behavior and safe review

## Not Authoritative For
- runtime topology and service edges; use `docs/service_dependency_graph.md`
- config apply workflow; use `docs/config_operations.md`

## Read When
- changing schema, migrations, idempotency, test-mode behavior, or DB-backed lifecycle rules
- reviewing API changes that rely on DB guarantees

## Update When
- any table, index, grant, mirror rule, or prod/test lifecycle expectation changes
- DB-backed operational behavior changes in a way that affects API contracts

**Observed on:** 2026-04-05 (from `psql` introspection against database `pkm` plus recipes migration contracts).

This file is meant to be a **human + agent** reference:
- what exists (schemas/tables)
- how prod vs test works
- what each DB role can do
- column/index/constraint details per table
- operational notes that affect `/db/delete` and `/db/move`

## Quick Table Map

| Table group | Scope | Primary use |
|---|---|---|
| `entries`, `idempotency_policies` | mirrored in `pkm` and `pkm_test` | core ingest, dedupe, read and enrichment lifecycle |
| `active_topics`, `active_topic_state`, `active_topic_open_questions`, `active_topic_action_items`, `active_topic_related_entries` | mirrored in `pkm` and `pkm_test` | first-class active-topic working-memory state and topic-entry links |
| `recipes`, `recipe_links` | mirrored in `pkm` and `pkm_test` | recipe capture, retrieval, review queue, and bidirectional see-also links |
| `runtime_config`, `failure_packs`, calendar tables, todoist planning tables | prod-only | runtime toggles, failure diagnostics, calendar business logs, Todoist planning state |
| `t1_*`, `t2_*` batch tables | mirrored in `pkm` and `pkm_test` | durable batch orchestration and status visibility |

## Table Ownership Summary

| Table or group | Owner | Primary writers | Primary readers | Mirrored? | Retention note |
|---|---|---|---|---|---|
| `entries` | `pgadmin` | backend via `pkm_ingest` | backend, `pkm_read` | yes | not explicitly bounded |
| `idempotency_policies` | `pgadmin` | migrations / admin setup | backend | yes | not explicitly bounded |
| `active_topics`, `active_topic_state`, `active_topic_open_questions`, `active_topic_action_items`, `active_topic_related_entries` | `pgadmin` | backend active-topic store via `pkm_ingest` | backend, `pkm_read` | yes | not explicitly bounded |
| `recipes` | `pgadmin` | backend recipe routes via `pkm_ingest` | backend, `pkm_read` | yes | not explicitly bounded |
| `recipe_links` | `pgadmin` | backend recipe link routes via `pkm_ingest` | backend, `pkm_read` | yes | not explicitly bounded |
| `runtime_config` | `pgadmin` | backend | backend, `pkm_read`, `n8n` | no | not explicitly bounded |
| `pipeline_events` | `pgadmin` | backend | debug tools / admin flows | no | daily prune; default `30` days |
| `failure_packs` | `pgadmin` | backend / WF99 path | admin debug flows | no | not documented here |
| `calendar_*` tables | `pgadmin` | backend calendar flows | backend calendar/report/debug flows | no | not documented here |
| `todoist_task_current`, `todoist_task_events` | `pgadmin` | backend Todoist planning routes via `pkm_ingest` | backend, `pkm_read`, debug UI review surfaces | no | not documented here |
| `t1_*`, `t2_*` tables | `pgadmin` | backend batch flows | status APIs / admin flows | yes | not documented here |

---

## Users

### Roles

| Role | Purpose | Notes |
|---|---|---|
| `pgadmin` | DB owner / superuser | Owns schemas `pkm`, `pkm_test` and all objects. |
| `pkm_ingest` | Application write role | Has broad CRUD on most tables (including `entries`, `recipes`, and `recipe_links` in both schemas and Tier-1 batch tables). |
| `pkm_read` | Read-only role | Has `SELECT` on `pkm.entries`, `pkm_test.entries`, `pkm.recipes`, `pkm_test.recipes`, `pkm.recipe_links`, `pkm_test.recipe_links`, `pkm.runtime_config`, `pkm.todoist_task_current`, and `pkm.todoist_task_events`. No access to Tier-1 batch tables or idempotency tables (as currently granted). |
| `n8n` | n8n DB role | Has `USAGE` on schema `pkm` and `SELECT` on `pkm.runtime_config` only. No access to entries tables. |

### Database-level access (database `pkm`)

- `pkm` is owned by `pgadmin`.
- `pkm_ingest` and `pkm_read` have **CONNECT** on database `pkm`.
- Database-level ACL also shows `PUBLIC` has TEMP/CONNECT (shown as `=Tc/pgadmin`).

---

## Database

### Extensions

| Extension | Version | Schema | Why it matters |
|---|---:|---|---|
| `pgcrypto` | 1.3 | `public` | Provides `gen_random_uuid()` used as default for `entries.id`. |
| `plpgsql` | 1.0 | `pg_catalog` | Default procedural language. |

### Schemas

| Schema | Owner | Purpose |
|---|---|---|
| `pkm` | `pgadmin` | Production data (default). |
| `pkm_test` | `pgadmin` | Test/experimentation data. |

Schema grants (current):
- `pkm_ingest`: `USAGE` on `pkm`, `pkm_test`
- `pkm_read`: `USAGE` on `pkm`, `pkm_test`
- `n8n`: `USAGE` on `pkm` only

### Tables

#### Inventory (with approximate sizes)

**Production (`pkm`)**
- `entries` (~1232 kB)
- `idempotency_policies` (~16 kB)
- `active_topics` (size varies by topic count; currently fixed small set)
- `active_topic_state` (size varies by topic state history volume)
- `active_topic_open_questions` (size varies by active question volume)
- `active_topic_action_items` (size varies by active action volume)
- `active_topic_related_entries` (size varies by topic-entry link volume)
- `recipes` (size varies by recipe volume)
- `recipe_links` (size varies by recipe-link volume)
- `pipeline_events` (size varies by retention)
- `failure_packs` (size varies by failure volume)
- `runtime_config` (~16 kB)
- `calendar_requests` (size varies by family-calendar usage)
- `calendar_event_observations` (size varies by read/report volume)
- `todoist_task_current` (size varies by Todoist sync volume)
- `todoist_task_events` (size varies by Todoist event history volume)
- `t1_batches` (~16 kB)
- `t1_batch_items` (~80 kB)
- `t1_batch_item_results` (~8192 bytes)
- `t2_batches` (size varies by run volume)
- `t2_batch_items` (size varies by run volume)
- `t2_batch_item_results` (size varies by run volume)

**Test (`pkm_test`)**
- `entries` (~488 kB)
- `idempotency_policies` (~16 kB)
- `active_topics` (size varies by topic count; currently fixed small set)
- `active_topic_state` (size varies by topic state history volume)
- `active_topic_open_questions` (size varies by active question volume)
- `active_topic_action_items` (size varies by active action volume)
- `active_topic_related_entries` (size varies by topic-entry link volume)
- `recipes` (size varies by recipe volume)
- `recipe_links` (size varies by recipe-link volume)
- `t1_batches` (~8192 bytes)
- `t1_batch_items` (~8192 bytes)
- `t1_batch_item_results` (~8192 bytes)
- `t2_batches` (size varies by run volume)
- `t2_batch_items` (size varies by run volume)
- `t2_batch_item_results` (size varies by run volume)

### User access per table (current grants)

Legend: `R`=SELECT, `I`=INSERT, `U`=UPDATE, `D`=DELETE

#### Production (`pkm.*`)

| Table | pgadmin | pkm_ingest | pkm_read | n8n |
|---|---|---|---|---|
| `pkm.entries` | RIUD + TRUNCATE/REF/… | RIUD | R | — |
| `pkm.active_topics` | full | RIUD | R | — |
| `pkm.active_topic_state` | full | RIUD | R | — |
| `pkm.active_topic_open_questions` | full | RIUD | R | — |
| `pkm.active_topic_action_items` | full | RIUD | R | — |
| `pkm.active_topic_related_entries` | full | RIUD | R | — |
| `pkm.recipes` | full | RIUD | R | — |
| `pkm.recipe_links` | full | RIUD | R | — |
| `pkm.pipeline_events` | full | RIUD | — | — |
| `pkm.failure_packs` | full | RIUD | — | — |
| `pkm.runtime_config` | full | RIUD | R | R |
| `pkm.calendar_requests` | full | RIUD | — | — |
| `pkm.calendar_event_observations` | full | RIUD | — | — |
| `pkm.todoist_task_current` | full | RIUD | R | — |
| `pkm.todoist_task_events` | full | RIUD | R | — |
| `pkm.idempotency_policies` | full | RIUD | — | — |
| `pkm.t1_batches` | full | RIUD | — | — |
| `pkm.t1_batch_items` | full | RIUD | — | — |
| `pkm.t1_batch_item_results` | full | RIUD | — | — |
| `pkm.t2_batches` | full | RIUD | — | — |
| `pkm.t2_batch_items` | full | RIUD | — | — |
| `pkm.t2_batch_item_results` | full | RIUD | — | — |

#### Test (`pkm_test.*`)

| Table | pgadmin | pkm_ingest | pkm_read |
|---|---|---|---|
| `pkm_test.entries` | full | RIUD | R |
| `pkm_test.active_topics` | full | RIUD | R |
| `pkm_test.active_topic_state` | full | RIUD | R |
| `pkm_test.active_topic_open_questions` | full | RIUD | R |
| `pkm_test.active_topic_action_items` | full | RIUD | R |
| `pkm_test.active_topic_related_entries` | full | RIUD | R |
| `pkm_test.recipes` | full | RIUD | R |
| `pkm_test.recipe_links` | full | RIUD | R |
| `pkm_test.idempotency_policies` | full | RIUD | — |
| `pkm_test.t1_batches` | full | RIUD | — |
| `pkm_test.t1_batch_items` | full | RIUD | — |
| `pkm_test.t1_batch_item_results` | full | RIUD | — |
| `pkm_test.t2_batches` | full | RIUD | — |
| `pkm_test.t2_batch_items` | full | RIUD | — |
| `pkm_test.t2_batch_item_results` | full | RIUD | — |

### Sequences and identity

- `entries.entry_id` is **`GENERATED BY DEFAULT AS IDENTITY`** in both schemas.
- `recipes.id` is **`GENERATED BY DEFAULT AS IDENTITY`** in both schemas.
- Sequences:
  - `pkm.entries_entry_id_seq`
  - `pkm_test.entries_entry_id_seq`
  - `pkm.recipes_id_seq`
  - `pkm_test.recipes_id_seq`

Current sequence grants:
- `pkm_ingest`: `USAGE` + `SELECT` on both `entries_entry_id_seq` and both `recipes_id_seq` sequences.
- `pkm_ingest`: `USAGE` + `SELECT` on both `active_topic_open_questions_id_seq` and both `active_topic_action_items_id_seq` sequences.
- `pgadmin`: `USAGE`/`SELECT`/`UPDATE` on both.

**Important nuance (idempotency_policies):**
- `pkm.idempotency_policies.policy_id` defaults to `nextval('..._policy_id_seq')`.
- As observed, `pkm_ingest` does **NOT** have explicit grants on `pkm.idempotency_policies_policy_id_seq` (same for `pkm_test`).
  - This is fine if the app never inserts into `idempotency_policies`.
  - If the app *does* insert without specifying `policy_id`, it will fail unless sequence grants are added.

### Default privileges

Observed default privileges (created by owner `pgadmin`):
- In schema `pkm`: future **tables** default grant `pkm_ingest=arwd` (SELECT/INSERT/UPDATE/DELETE).
- In schema `pkm_test`: future **tables** default grant `pkm_ingest=arwd`.
- In schema `public`: future **tables** default grant `pkm_ingest=aw` and `pkm_read=r`.

### Triggers and RLS

- No user-defined triggers in `pkm` or `pkm_test`.
- No Row Level Security (RLS) policies in `pkm` or `pkm_test`.

---

## Test vs prod + mirroring

### Core idea

Production and test are separated by schema:
- **Prod:** `pkm`
- **Test:** `pkm_test`

Most tables are mirrored in both schemas to allow safe experimentation.

### What is mirrored

Mirrored between `pkm` and `pkm_test`:
- `entries`
- `idempotency_policies`
- `active_topics`
- `active_topic_state`
- `active_topic_open_questions`
- `active_topic_action_items`
- `active_topic_related_entries`
- `recipes`
- `recipe_links`
- `t1_batches`
- `t1_batch_items`
- `t1_batch_item_results`
- `t2_batches`
- `t2_batch_items`
- `t2_batch_item_results`

### What is NOT mirrored

- `pkm.runtime_config` exists **only in prod**.
  - It currently contains `is_test_mode = false` (jsonb boolean).
- `pkm.failure_packs` exists **only in prod**.
  - one table stores both test-mode and production-mode capture rows via projected `mode` + envelope JSON.
- `pkm.calendar_requests` exists **only in prod** (calendar business-request log).
- `pkm.calendar_event_observations` exists **only in prod** (external visibility/report observation log).
- `pkm.todoist_task_current` and `pkm.todoist_task_events` exist **only in prod** (Todoist planning state and review/event history).

### Practical consequences for `/db/delete` and `/db/move`

- `pkm_ingest` now has RIUD on both `pkm.entries` and `pkm_test.entries`, so `/db/delete` and `/db/move` can run directly under app role permissions.
- Recipe endpoints follow the same active-schema routing pattern and write/read either `pkm.recipes` and `pkm.recipe_links` or `pkm_test.recipes` and `pkm_test.recipe_links` based on persisted test mode.
- API edge still enforces admin authentication (`PKM_ADMIN_SECRET`) for these operations.

---

## Tables

### `pkm.entries` / `pkm_test.entries`

**Purpose**
Primary storage for captured items (email, telegram, etc.) and Tier-1 enrichment outputs.

**Columns** (same structure in prod and test)

| Column | Type | Nullable | Default / Generated | Notes |
|---|---|---:|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK (stable across moves if you preserve it) |
| `created_at` | timestamptz | no | `now()` | ingestion time |
| `source` | text | no |  | e.g. `email`, `telegram` |
| `intent` | text | no | `'archive'` | |
| `capture_text` | text | no |  | raw-ish capture |
| `url` | text | yes |  | |
| `url_canonical` | text | yes |  | |
| `extracted_text` | text | yes |  | |
| `clean_text` | text | yes |  | |
| `content_hash` | text | yes |  | |
| `external_ref` | jsonb | yes |  | stable external ids / provenance |
| `metadata` | jsonb | yes |  | enrichment payloads |
| `tsv` | tsvector | yes | **generated stored** | weighted full-text vector from clean/extracted/capture text |
| `content_type` | text | yes |  | e.g. `newsletter`, `thought` |
| `title` | text | yes |  | |
| `author` | text | yes |  | |
| `topic_primary` | text | yes |  | Tier-1 classification |
| `topic_primary_confidence` | real | yes |  | |
| `topic_secondary` | text | yes |  | Tier-1 classification |
| `topic_secondary_confidence` | real | yes |  | |
| `keywords` | text[] | yes |  | Tier-1 |
| `enrichment_status` | text | yes | `'pending'` | pipeline state |
| `enrichment_model` | text | yes |  | pipeline info |
| `prompt_version` | text | yes |  | pipeline info |
| `gist` | text | yes |  | Tier-1 |
| `entry_id` | bigint | no | identity | human-facing id, UNIQUE per schema |
| `retrieval_excerpt` | text | yes |  | |
| `clean_word_count` | int | yes |  | quality signals |
| `clean_char_count` | int | yes |  | quality signals |
| `extracted_char_count` | int | yes |  | quality signals |
| `link_count` | int | yes |  | quality signals |
| `link_ratio` | real | yes |  | quality signals |
| `boilerplate_heavy` | bool | yes |  | quality signals |
| `low_signal` | bool | yes |  | quality signals |
| `quality_score` | real | yes |  | 0..1 |
| `idempotency_policy_key` | text | yes |  | FK to policy key |
| `idempotency_key_primary` | text | yes |  | durable dedupe key |
| `idempotency_key_secondary` | text | yes |  | fallback dedupe key |
| `distill_summary` | text | yes |  | Tier-2 artifact |
| `distill_excerpt` | text | yes |  | Tier-2 optional grounded excerpt |
| `distill_version` | text | yes |  | Tier-2 prompt/schema contract version |
| `distill_created_from_hash` | text | yes |  | source `content_hash` used to build current artifact |
| `distill_why_it_matters` | text | yes |  | Tier-2 relevance rationale |
| `distill_stance` | text | yes |  | Tier-2 stance enum |
| `distill_status` | text | no | `'pending'` | Tier-2 lifecycle state |
| `distill_metadata` | jsonb | yes |  | Tier-2 operational metadata |

**Constraints**
- PK: `(id)`
- Unique: `(entry_id)`
- FK: `idempotency_policy_key` → `idempotency_policies(policy_key)` with `ON DELETE SET NULL`
- CHECK (recommended): `distill_status` in `{pending, queued, completed, failed, skipped, not_eligible, stale}`
- CHECK (recommended): `distill_stance` in `{descriptive, analytical, argumentative, speculative, instructional, narrative, other}`

**Indexes (prod)**
- PK: `entries_pkey` on `(id)`
- `entries_entry_id_uidx` UNIQUE on `(entry_id)`
- `entries_created_at_idx` on `(created_at DESC)`
- `entries_source_created_at_idx` on `(source, created_at DESC)`
- `entries_intent_created_at_idx` on `(intent, created_at DESC)`
- `entries_content_type_created_at_idx` on `(content_type, created_at DESC)`
- `entries_topic_primary_created_at_idx` on `(topic_primary, created_at DESC)`
- `entries_topic_secondary_created_at_idx` on `(topic_secondary, created_at DESC)`
- `entries_content_hash_idx` on `(content_hash)`
- `entries_tsv_gin_idx` GIN on `(tsv)`
- `entries_keywords_gin_idx` GIN on `(keywords)`
- `entries_quality_good_created_at_idx` partial on `(created_at DESC)` WHERE `boilerplate_heavy IS NOT TRUE AND low_signal IS NOT TRUE`
- `pkm_entries_idem_primary_uidx` UNIQUE partial on `(idempotency_policy_key, idempotency_key_primary)`
- `pkm_entries_idem_secondary_uidx` UNIQUE partial on `(idempotency_policy_key, idempotency_key_secondary)`
- `entries_distill_status_created_at_idx` on `(distill_status, created_at DESC)`
- `entries_distill_created_from_hash_idx` on `(distill_created_from_hash)`
- `entries_distill_candidate_newsletter_idx` partial on `(created_at DESC, id)` WHERE `content_type = 'newsletter' AND clean_text IS NOT NULL AND btrim(clean_text) <> ''` (Tier-2 discovery)

**Indexes (test)**
Same intent as prod, but names differ slightly:
- Unique `(entry_id)` index is `entries_entry_id_idx`
- Partial “quality good” index is `entries_created_at_idx1`
- Full-text index name is `entries_tsv_idx`
- Keywords GIN index name is `entries_keywords_idx`
- Smoke selector index: `entries_smoke_suite_idx` partial expression index on `((metadata #>> '{smoke,suite}')) WHERE metadata ? 'smoke'`

---

### `pkm.active_topics` / `pkm_test.active_topics`

**Purpose**  
Canonical fixed-topic registry for the active-topic working-memory surface.

**Columns**
- `topic_key` text PK (lowercase canonical key)
- `title` text NOT NULL
- `is_active` boolean NOT NULL default `true`
- `created_at` timestamptz NOT NULL default `now()`
- `updated_at` timestamptz NOT NULL default `now()`

**Notes**
- Phase-1 seeded keys: `communication`, `parenting`, `product`, `ai`.

### `pkm.active_topic_state` / `pkm_test.active_topic_state`

**Purpose**  
One structured state row per active topic key.

**Columns**
- `topic_key` text PK FK -> `active_topics(topic_key)` with `ON DELETE CASCADE`
- `title` text NOT NULL default `''`
- `why_active_now` text NOT NULL default `''`
- `current_mental_model` text NOT NULL default `''`
- `tensions_uncertainties` text NOT NULL default `''`
- `state_version` int NOT NULL default `1` CHECK `state_version >= 1`
- `last_session_id` text
- `migration_source_entry_id` bigint
- `migration_source_content_hash` text
- `created_at` timestamptz NOT NULL default `now()`
- `updated_at` timestamptz NOT NULL default `now()`

**Indexes**
- `(updated_at DESC)` for latest-state inspection

### `pkm.active_topic_open_questions` / `pkm_test.active_topic_open_questions`

**Purpose**  
Structured open-question rows linked to one active topic.

**Columns**
- `id` bigint identity PK
- `topic_key` text NOT NULL FK -> `active_topics(topic_key)` with `ON DELETE CASCADE`
- `question_key` text NOT NULL
- `question_text` text NOT NULL
- `status` text NOT NULL CHECK in `('open', 'closed')`
- `sort_order` int NOT NULL default `0`
- `created_at` timestamptz NOT NULL default `now()`
- `updated_at` timestamptz NOT NULL default `now()`

**Constraints and indexes**
- UNIQUE `(topic_key, question_key)`
- `(topic_key, status, sort_order, id)` for topic-state rendering and status views

### `pkm.active_topic_action_items` / `pkm_test.active_topic_action_items`

**Purpose**  
Structured action-item rows linked to one active topic.

**Columns**
- `id` bigint identity PK
- `topic_key` text NOT NULL FK -> `active_topics(topic_key)` with `ON DELETE CASCADE`
- `action_key` text NOT NULL
- `action_text` text NOT NULL
- `status` text NOT NULL CHECK in `('open', 'done')`
- `sort_order` int NOT NULL default `0`
- `created_at` timestamptz NOT NULL default `now()`
- `updated_at` timestamptz NOT NULL default `now()`

**Constraints and indexes**
- UNIQUE `(topic_key, action_key)`
- `(topic_key, status, sort_order, id)` for topic-state rendering and status views

### `pkm.active_topic_related_entries` / `pkm_test.active_topic_related_entries`

**Purpose**  
Explicit topic-to-entry relationships, separate from wrap/commit state patch updates.

**Columns**
- `topic_key` text NOT NULL FK -> `active_topics(topic_key)` with `ON DELETE CASCADE`
- `entry_id` bigint NOT NULL
- `relation_type` text NOT NULL default `'related'` (non-empty)
- `metadata` jsonb
- `created_at` timestamptz NOT NULL default `now()`
- `updated_at` timestamptz NOT NULL default `now()`

**Constraints and indexes**
- PK `(topic_key, entry_id)`
- `(entry_id, topic_key)` index for reverse lookup from entry-centric workflows

### `pkm.recipes` / `pkm_test.recipes`

**Purpose**
Dedicated recipe capture/retrieval storage for `/recipes/*` backend contracts and Telegram recipe command flows.

**Columns**

| Column | Type | Nullable | Default / Generated | Notes |
|---|---|---:|---|---|
| `id` | bigint | no | identity | primary key |
| `public_id` | text | no | generated stored (`'R' || id`) | user-facing recipe id |
| `created_at` | timestamptz | no | `now()` | creation time |
| `updated_at` | timestamptz | no | `now()` | last mutation time |
| `title` | text | no |  | recipe title |
| `title_normalized` | text | no |  | case-insensitive dedupe key |
| `servings` | int | no |  | required |
| `ingredients` | text[] | no |  | required ordered list |
| `instructions` | text[] | no |  | required ordered list |
| `notes` | text | yes |  | optional notes |
| `search_text` | text | no |  | flattened lexical retrieval corpus |
| `status` | text | no | `'active'` | CHECK in `{active, needs_review, archived}` |
| `metadata` | jsonb | yes |  | review/parser metadata |
| `source` | text | yes |  | e.g., `telegram` |
| `cuisine` | text | yes |  | review-trigger field |
| `protein` | text | yes |  | review-trigger field |
| `prep_time_minutes` | int | yes |  | review-trigger field |
| `cook_time_minutes` | int | yes |  | review-trigger field |
| `total_time_minutes` | int | no | generated stored (`coalesce(prep,0)+coalesce(cook,0)`) | computed summary |
| `difficulty` | text | yes |  | review-trigger field |
| `tags` | text[] | yes |  | optional tags |
| `url_canonical` | text | yes |  | optional source URL |
| `capture_text` | text | no |  | original structured/semi-structured capture text |
| `overnight` | boolean | no | `false` | prep attribute |

**Constraints**
- PK: `(id)`
- Unique: `(public_id)`
- Unique: `(title_normalized)` for case-insensitive exact-title dedupe
- CHECK: `status IN ('active','needs_review','archived')`

**Indexes**
- `(status, updated_at DESC)` for review queue and operational browsing
- GIN full-text index on `to_tsvector('simple', search_text)` for lexical search
- GIN index on `ingredients`
- GIN index on `tags`

**Grants**
- `pkm_ingest`: `SELECT, INSERT, UPDATE, DELETE` on `pkm.recipes` and `pkm_test.recipes`
- `pkm_ingest`: `USAGE, SELECT` on `pkm.recipes_id_seq` and `pkm_test.recipes_id_seq`
- `pkm_read`: `SELECT` on `pkm.recipes` and `pkm_test.recipes`

---

### `pkm.recipe_links` / `pkm_test.recipe_links`

**Purpose**
Bidirectional link table for recipe-to-recipe relationships used by `/recipes/link` and See Also rendering.

**Columns**

| Column | Type | Nullable | Default / Generated | Notes |
|---|---|---:|---|---|
| `recipe_id_a` | bigint | no |  | FK to `recipes.id` (ordered lower id) |
| `recipe_id_b` | bigint | no |  | FK to `recipes.id` (ordered higher id) |
| `created_at` | timestamptz | no | `now()` | link creation time |
| `updated_at` | timestamptz | no | `now()` | last touch time (idempotent relink refreshes this) |

**Constraints**
- PK: `(recipe_id_a, recipe_id_b)`
- FK: `recipe_id_a` -> `recipes(id)` with `ON DELETE CASCADE`
- FK: `recipe_id_b` -> `recipes(id)` with `ON DELETE CASCADE`
- CHECK: `recipe_id_a < recipe_id_b` (canonical unordered pair)

**Indexes**
- `(recipe_id_a)`
- `(recipe_id_b)`

**Grants**
- `pkm_ingest`: `SELECT, INSERT, UPDATE, DELETE` on `pkm.recipe_links` and `pkm_test.recipe_links`
- `pkm_read`: `SELECT` on `pkm.recipe_links` and `pkm_test.recipe_links`

---

### `pkm.idempotency_policies` / `pkm_test.idempotency_policies`

**Purpose**
Defines idempotency/deduplication behavior per `(source, content_type)` and stable `policy_key`.

**Columns**
- `policy_id` bigint PK (default `nextval(...)`)
- `policy_key` text UNIQUE
- `source` text
- `content_type` text
- `conflict_action` text CHECK in `{skip, update}`
- `update_fields` text[] (optional)
- `enabled` boolean default true
- `notes` text (optional)
- `created_at` timestamptz default now()
- `updated_at` timestamptz default now()

**Constraints / indexes**
- PK `(policy_id)`
- Unique `(policy_key)`
- Check: `conflict_action IN ('skip','update')`

**Seed policies (current)**
This is the authoritative observed policy catalog for the current DB state.
If `docs/requirements.md` lags during the later requirements cleanup pass, prefer this list for current schema truth.

- `telegram_thought_v1` (telegram / thought / update)
- `telegram_link_v1` (telegram / link / skip)
- `email_newsletter_v1` (email / newsletter / skip)
- `email_correspondence_message_v1` (email / correspondence_message / skip)
- `email_correspondence_thread_v1` (email / correspondence_thread / update)
- `email_backfill_newsletter_v1` (email / newsletter / skip)
- `notion_note_v1` (notion / note / update)
- `notion_newsletter_v1` (notion / newsletter / update)
- `notion_correspondence_v1` (notion / correspondence / update)
- `notion_other_v1` (notion / other / update)
- `chatgpt_session_note_v1` (chatgpt / note / update)
- `chatgpt_working_memory_v1` (chatgpt / working_memory / update)

---

### `pkm.runtime_config`

**Purpose**
Small shared key/value store for runtime toggles used by backend and workflows.

**Columns**
- `key` text PK
- `value` jsonb NOT NULL
- `updated_at` timestamptz default now()

**Current keys**
- `is_test_mode`: `false`

**Access**
- `pkm_ingest`: RIUD
- `pkm_read`: R
- `n8n`: R

---

### `pkm.pipeline_events`

**Purpose**
Always-on lightweight transition logs for backend pipelines (step order, summaries, timing, and failures).

**Columns**
- `event_id` uuid PK default `gen_random_uuid()`
- `ts` timestamptz default `now()`
- `run_id` text NOT NULL
- `seq` int NOT NULL
- `service` text
- `pipeline` text
- `step` text NOT NULL
- `direction` text CHECK in `('start','end','error')`
- `level` text CHECK in `('info','warn','error','debug','trace')`
- `duration_ms` int
- `entry_id` bigint
- `batch_id` text
- `trace_id` text
- `input_summary` jsonb
- `output_summary` jsonb
- `error` jsonb
- `artifact_path` text
- `meta` jsonb

**Indexes**
- unique `(run_id, seq)`
- `(run_id, ts)`
- `(ts DESC)`
- partial `(ts DESC) WHERE direction = 'error'`

**Retention**
- Backend daily prune job deletes rows older than `PKM_PIPELINE_EVENTS_RETENTION_DAYS` (default `30`).

**Deployment note**
- This table must exist in the backend-configured schema (`PKM_DB_SCHEMA`, default `pkm`).
- Required app grants for backend role `pkm_ingest`: `SELECT, INSERT, UPDATE, DELETE`.

---

### `pkm.failure_packs`

**Purpose**
Durable diagnostics store for n8n-orchestrated workflow failures captured by WF99.

**Columns**
- `failure_id` uuid PK default `gen_random_uuid()`
- `created_at` timestamptz NOT NULL default `now()`
- `updated_at` timestamptz NOT NULL default `now()`
- `run_id` text NOT NULL UNIQUE
- `execution_id` text
- `workflow_id` text
- `workflow_name` text NOT NULL
- `mode` text
- `failed_at` timestamptz
- `node_name` text NOT NULL
- `node_type` text
- `error_name` text
- `error_message` text
- `status` text NOT NULL default `captured` CHECK in `('captured','partial','failed')`
- `has_sidecars` boolean NOT NULL default `false`
- `sidecar_root` text
- `pack` jsonb NOT NULL

**Indexes**
- unique `(run_id)`
- `(failed_at DESC)`
- `(workflow_name, failed_at DESC)`
- `(node_name, failed_at DESC)`
- `(mode, failed_at DESC)`
- partial `(failed_at DESC)` where `status = 'captured'`

**Notes**
- This table is prod-only (`pkm`) by design.
- Test-mode and production captures share this table; the captured mode is projected in both `mode` and `pack`.
- Sidecar files are persisted on shared disk under `debug/failures/...` and referenced by relative paths inside `pack.artifacts`.

---

### `pkm.calendar_requests`

**Purpose**
Durable business log for Telegram calendar-create requests, including clarification turns and final create outcomes.

**Columns**
- `request_id` uuid PK default `gen_random_uuid()`
- `created_at` timestamptz default now()
- `updated_at` timestamptz default now()
- `run_id` text NOT NULL
- `source_system` text NOT NULL default `telegram`
- `actor_code` text NOT NULL
- `telegram_chat_id` text NOT NULL
- `telegram_message_id` text NOT NULL
- `route_intent` text
- `route_confidence` numeric
- `status` text NOT NULL
- `raw_text` text NOT NULL
- `clarification_turns` jsonb NOT NULL default `[]`
- `normalized_event` jsonb
- `warning_codes` jsonb
- `error` jsonb
- `google_calendar_id` text
- `google_event_id` text
- `idempotency_key_primary` text NOT NULL
- `idempotency_key_secondary` text

**Constraints / indexes**
- PK: `(request_id)`
- Unique: `(idempotency_key_primary)`
- Partial unique: `(telegram_chat_id)` where `status = 'needs_clarification'` (one-open-request invariant)
- Index: `(telegram_chat_id, updated_at DESC)`
- CHECK: `status IN ('received','routed','needs_clarification','clarified','normalized','calendar_write_started','calendar_created','calendar_failed','query_answered','ignored')`

**Routing rule**
- This table is intentionally prod-only and is not affected by persisted `test_mode`.

---

### `pkm.calendar_event_observations`

**Purpose**
Append-only business log for externally authored events observed during calendar read/report workflows.

**Columns**
- `observation_id` uuid PK default `gen_random_uuid()`
- `created_at` timestamptz default now()
- `updated_at` timestamptz default now()
- `run_id` text NOT NULL
- `google_calendar_id` text NOT NULL
- `google_event_id` text NOT NULL
- `observation_kind` text NOT NULL
- `source_type` text NOT NULL
- `event_snapshot` jsonb NOT NULL
- `resolved_people` jsonb
- `resolved_color` text
- `was_reported` boolean NOT NULL default false

**Indexes**
- `(google_calendar_id, google_event_id, created_at DESC)`
- `(observation_kind, created_at DESC)`

**Routing rule**
- This table is intentionally prod-only and is not affected by persisted `test_mode`.

---

### Tier-1 Batch Persistence

These tables support restart-safe OpenAI batch processing.

#### `pkm.t1_batches` / `pkm_test.t1_batches`

- `batch_id` text PK
- `status` text
- `model` text
- `input_file_id` text
- `output_file_id` text
- `error_file_id` text
- `request_count` int
- `metadata` jsonb
- `created_at` timestamptz default now()

Indexes:
- PK `(batch_id)`
- `(status, created_at)` (`idx_pkm_*_t1_batches_status_created_at`)

#### `pkm.t1_batch_items` / `pkm_test.t1_batch_items`

- `batch_id` text
- `custom_id` text
- `title` text
- `author` text
- `content_type` text
- `prompt_mode` text
- `prompt` text
- `created_at` timestamptz default now()

Indexes:
- PK `(batch_id, custom_id)`
- `(batch_id)`

#### `pkm.t1_batch_item_results` / `pkm_test.t1_batch_item_results`

- `batch_id` text
- `custom_id` text
- `status` text NOT NULL
- `response_text` text
- `parsed` jsonb
- `error` jsonb
- `raw` jsonb
- `updated_at` timestamptz default now()
- `created_at` timestamptz default now()

Indexes:
- PK `(batch_id, custom_id)`
- `(batch_id, status)`
- `(updated_at)`

---

### Tier-2 Batch Persistence

These tables support restart-safe Tier‑2 async distillation enqueue/collect/reconciliation.

#### `pkm.t2_batches` / `pkm_test.t2_batches`

- `batch_id` text PK
- `status` text
- `model` text
- `request_type` text
- `input_file_id` text
- `output_file_id` text
- `error_file_id` text
- `request_count` int
- `metadata` jsonb
- `created_at` timestamptz default now()
- `updated_at` timestamptz default now()

Indexes:
- PK `(batch_id)`
- `(status, created_at DESC)`
- `(created_at DESC)`

#### `pkm.t2_batch_items` / `pkm_test.t2_batch_items`

- `batch_id` text
- `custom_id` text
- `entry_id` bigint
- `content_hash` text
- `route` text
- `chunking_strategy` text
- `request_type` text
- `title` text
- `author` text
- `content_type` text
- `prompt_mode` text
- `prompt` text
- `retry_count` int default 0
- `created_at` timestamptz default now()
- `updated_at` timestamptz default now()

Indexes:
- PK `(batch_id, custom_id)`
- `(entry_id)`
- `(created_at DESC)`

#### `pkm.t2_batch_item_results` / `pkm_test.t2_batch_item_results`

- `batch_id` text
- `custom_id` text
- `status` text NOT NULL
- `response_text` text
- `parsed` jsonb
- `error` jsonb
- `raw` jsonb
- `applied` boolean default false
- `applied_at` timestamptz
- `updated_at` timestamptz default now()
- `created_at` timestamptz default now()

Indexes:
- PK `(batch_id, custom_id)`
- `(status)`
- `(applied, updated_at DESC)`

---


## Database Operations

Operator-facing backup and restore workflow now lives in `docs/database_operations.md`.
Keep this file focused on schema and lifecycle facts, and keep operational runbooks there.
