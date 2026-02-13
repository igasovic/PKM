# PKM Database Schema v2.2

Source: `\d+ pkm.entries` (plus `information_schema.columns`, constraints, triggers) as provided.

## Table: `pkm.entries`

### Columns

| Column | Type | Nullable | Default / Generated | Notes |
|---|---|---:|---|---|
| id | uuid | no | `gen_random_uuid()` | primary key |
| created_at | timestamp with time zone | no | `now()` |  |
| source | text | no |  |  |
| intent | text | no | `'archive'::text` |  |
| capture_text | text | no |  |  |
| url | text | yes |  |  |
| url_canonical | text | yes |  |  |
| extracted_text | text | yes |  |  |
| clean_text | text | yes |  |  |
| content_hash | text | yes |  |  |
| extraction_status | text | yes |  |  |
| error | text | yes |  |  |
| people | text[] | yes |  |  |
| topic_guess | text | yes |  |  |
| type_guess | text | yes |  |  |
| duplicate_of | uuid | yes |  | FK → `pkm.entries(id)` (ON DELETE SET NULL) |
| external_ref | jsonb | yes |  |  |
| metadata | jsonb | yes |  |  |
| tsv | tsvector | yes | generated stored | generated always as: `setweight(to_tsvector('english', COALESCE(clean_text,'')), 'A') || setweight(to_tsvector('english', COALESCE(extracted_text,'')), 'B') || setweight(to_tsvector('english', COALESCE(capture_text,'')), 'C')` |
| content_type | text | yes |  |  |
| title | text | yes |  |  |
| author | text | yes |  |  |
| topic_primary | text | yes |  | Tier-1 |
| topic_primary_confidence | real | yes |  | Tier-1 |
| topic_secondary | text | yes |  | Tier-1 |
| topic_secondary_confidence | real | yes |  | Tier-1 |
| keywords | text[] | yes |  | Tier-1 |
| enrichment_status | text | yes | `'pending'::text` | Tier-1 pipeline state |
| enrichment_model | text | yes |  | Tier-1 pipeline info |
| prompt_version | text | yes |  | Tier-1 pipeline info |
| gist | text | yes |  | Tier-1 |
| entry_id | bigint | no | identity | human-facing id, UNIQUE |
| retrieval_excerpt | text | yes |  | retrieval v1 excerpt (also mirrored in `metadata.retrieval.excerpt`) |
| retrieval_version | text | yes |  | retrieval version (e.g., `v1`) |
| source_domain | text | yes |  | canonical domain |
| clean_word_count | integer | yes |  | quality signals |
| clean_char_count | integer | yes |  | quality signals |
| extracted_char_count | integer | yes |  | quality signals |
| link_count | integer | yes |  | quality signals |
| link_ratio | real | yes |  | quality signals |
| boilerplate_heavy | boolean | yes |  | quality signals |
| low_signal | boolean | yes |  | quality signals |
| extraction_incomplete | boolean | yes |  | quality signals |
| quality_score | real | yes |  | quality score (0..1) |
| idempotency_policy_key | text | yes |  | policy key stored directly on entry |
| idempotency_key_primary | text | yes |  | durable dedupe key (tier-1) |
| idempotency_key_secondary | text | yes |  | durable dedupe key (tier-2 fallback) |

### Indexes

| Name | Type | Definition / Notes |
|---|---|---|
| entries_pkey | btree | PRIMARY KEY `(id)` |
| entries_entry_id_uidx | btree | UNIQUE `(entry_id)` |
| entries_created_at_idx | btree | `(created_at DESC)` |
| entries_source_created_at_idx | btree | `(source, created_at DESC)` |
| entries_intent_created_at_idx | btree | `(intent, created_at DESC)` |
| entries_content_type_created_at_idx | btree | `(content_type, created_at DESC)` |
| entries_topic_primary_created_at_idx | btree | `(topic_primary, created_at DESC)` |
| entries_topic_secondary_created_at_idx | btree | `(topic_secondary, created_at DESC)` |
| entries_source_domain_created_at_idx | btree | `(source_domain, created_at DESC)` |
| entries_content_hash_idx | btree | `(content_hash)` |
| entries_tsv_gin_idx | gin | `(tsv)` |
| entries_keywords_gin_idx | gin | `(keywords)` |
| entries_people_gin_idx | gin | `(people)` |
| entries_quality_good_created_at_idx | btree | `(created_at DESC)` **partial**: `WHERE boilerplate_heavy IS NOT TRUE AND low_signal IS NOT TRUE` |
| pkm_entries_idem_primary_uidx | btree | UNIQUE **partial**: `(idempotency_policy_key, idempotency_key_primary)` where both are non-null |
| pkm_entries_idem_secondary_uidx | btree | UNIQUE **partial**: `(idempotency_policy_key, idempotency_key_secondary)` where both are non-null |

### Constraints

- **Primary key:** `entries_pkey` on `(id)`
- **Unique:** `entries_entry_id_uidx` on `(entry_id)`
- **Foreign key:** `entries_duplicate_of_fkey` — `duplicate_of` → `pkm.entries(id)` ON DELETE SET NULL

### Triggers

- None (0 user triggers reported).

---

## Test / Production Database Fork (Schema-level)

To support safe experimentation without polluting production data, the PKM database uses **schema-level isolation**:

- **Production schema:** `pkm`
- **Test schema:** `pkm_test`

Both schemas contain an identical `entries` table (structure, indexes, constraints).
All workflows **select the target schema at runtime**.

### How schema selection works
- Every workflow starts by invoking the **`PKM Config`** sub-workflow.
- `PKM Config` returns a `config.db` object that includes:
  - `is_test_mode` (boolean)
  - `schema_prod = "pkm"`
  - `schema_test = "pkm_test"`
- SQL and JS builders **must read config exclusively from the `PKM Config` node output**.
- When `is_test_mode = true`, all writes and reads go to `pkm_test.entries`.
- When `is_test_mode = false`, all writes and reads go to `pkm.entries`.

### Cleanup of test data
Test data is never mixed with production. To reset test state:
```sql
TRUNCATE TABLE pkm_test.entries RESTART IDENTITY;
```

This design guarantees:
- Zero production data contamination
- No need for parallel Postgres instances or n8n deployments
- Deterministic cleanup after test runs

Idempotency-related mirrors in test schema:
- `pkm_test.idempotency_policies`
- `pkm_test.entries.idempotency_policy_key`
- `pkm_test.entries.idempotency_key_primary`
- `pkm_test.entries.idempotency_key_secondary`
- `pkm_test_entries_idem_primary_uidx`
- `pkm_test_entries_idem_secondary_uidx`

---

## Runtime Config (Persisted)

Test mode is persisted in Postgres so backend and workflows can share state.

Table:
- `pkm.runtime_config`

Columns:
- `key` (text, primary key)
- `value` (jsonb)
- `updated_at` (timestamptz)

Key used:
- `is_test_mode` → boolean stored as jsonb

---

## Idempotency Policies

Backend deduplication/update behavior is policy-driven via Postgres.

### Table: `pkm.idempotency_policies`

| Column | Type | Nullable | Default / Generated | Notes |
|---|---|---:|---|---|
| policy_id | bigint | no | `bigserial` | primary key |
| policy_key | text | no |  | unique stable policy key (e.g. `email_newsletter_v1`) |
| source | text | no |  | source channel (`email`, `telegram`, etc.) |
| content_type | text | no |  | semantic content type |
| conflict_action | text | no |  | `skip` or `update` (CHECK constrained) |
| update_fields | text[] | yes |  | NULL => update all incoming fields |
| enabled | boolean | no | `true` | runtime toggle |
| notes | text | yes |  | policy notes |
| created_at | timestamptz | no | `now()` | created timestamp |
| updated_at | timestamptz | no | `now()` | updated timestamp |

Constraints:
- Primary key on `(policy_id)`
- Unique on `(policy_key)`
- Check: `conflict_action IN ('skip','update')`

### Seed policies (as migrated)

- `telegram_thought_v1` (`telegram`, `thought`, `update`)
- `telegram_link_v1` (`telegram`, `link`, `skip`)
- `email_newsletter_v1` (`email`, `newsletter`, `skip`)
- `email_correspondence_thread_v1` (`email`, `correspondence_thread`, `update`)

### Test schema mirror

`pkm_test.idempotency_policies` is created with `LIKE pkm.idempotency_policies INCLUDING ALL`.

### Access control (as migrated)

`pkm_ingest` grants:
- `USAGE` on schemas `pkm`, `pkm_test`
- `SELECT, INSERT, UPDATE, DELETE` on:
  - `pkm.idempotency_policies`
  - `pkm_test.idempotency_policies`
- `USAGE, SELECT` on sequences:
  - `pkm.idempotency_policies_policy_id_seq`
  - `pkm_test.idempotency_policies_policy_id_seq`
- default privileges in both schemas grant CRUD on future tables to `pkm_ingest`

---

## Tier-1 Batch Persistence

To support restart-safe OpenAI batch processing, backend persists queue/mapping/results in Postgres.

### Table: `pkm.t1_batches`

| Column | Type | Nullable | Default / Generated | Notes |
|---|---|---:|---|---|
| batch_id | text | no |  | primary key, OpenAI batch id |
| status | text | yes |  | OpenAI batch status |
| model | text | yes |  | model used for requests |
| input_file_id | text | yes |  | OpenAI files API input id |
| output_file_id | text | yes |  | OpenAI files API output id |
| error_file_id | text | yes |  | OpenAI files API error id |
| request_count | integer | yes |  | number of enqueued requests |
| metadata | jsonb | yes |  | batch metadata |
| created_at | timestamp with time zone | yes | `now()` | created timestamp |

Indexes:
- Primary key on `(batch_id)`
- `idx_pkm_t1_batches_status_created_at` on `(status, created_at)`

### Table: `pkm.t1_batch_items`

| Column | Type | Nullable | Default / Generated | Notes |
|---|---|---:|---|---|
| batch_id | text | no |  | batch id |
| custom_id | text | no |  | per-item id inside batch |
| title | text | yes |  | prompt metadata |
| author | text | yes |  | prompt metadata |
| content_type | text | yes |  | prompt metadata |
| prompt_mode | text | yes |  | `whole` / `sample` |
| prompt | text | yes |  | rendered user prompt sent to OpenAI |
| created_at | timestamp with time zone | yes | `now()` | created timestamp |

Indexes:
- Primary key on `(batch_id, custom_id)`
- `idx_pkm_t1_batch_items_batch_id` on `(batch_id)`

### Table: `pkm.t1_batch_item_results`

| Column | Type | Nullable | Default / Generated | Notes |
|---|---|---:|---|---|
| batch_id | text | no |  | batch id |
| custom_id | text | no |  | per-item id inside batch |
| status | text | no |  | `ok` / `parse_error` / `error` |
| response_text | text | yes |  | extracted model text |
| parsed | jsonb | yes |  | parsed Tier-1 payload |
| error | jsonb | yes |  | parsing / API error info |
| raw | jsonb | yes |  | raw batch line payload |
| updated_at | timestamp with time zone | yes | `now()` | last update timestamp |
| created_at | timestamp with time zone | yes | `now()` | first insert timestamp |

Indexes:
- Primary key on `(batch_id, custom_id)`
- `idx_pkm_t1_batch_results_batch_id_status` on `(batch_id, status)`
- `idx_pkm_t1_batch_results_updated_at` on `(updated_at)`

### Test schema mirror

All Tier-1 batch tables/indexes above are mirrored in `pkm_test`:
- `pkm_test.t1_batches`
- `pkm_test.t1_batch_items`
- `pkm_test.t1_batch_item_results`

This allows worker dequeue/sync to continue across test-mode flips without orphaning jobs.
