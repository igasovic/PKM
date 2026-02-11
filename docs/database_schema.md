# PKM Database Schema v2.1

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
