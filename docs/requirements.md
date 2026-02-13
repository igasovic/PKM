# Idempotency Requirements

## Scope
This document defines how idempotency must work for ingest and backfill across:
- `pkm` (prod schema)
- `pkm_test` (test schema)

Primary objective:
- prevent duplicate rows from being inserted into `entries`
- support rerunnable backfills safely

## Core rules
- Idempotency keys are computed in normalization.
- Conflict resolution is enforced in backend DB insert logic using DB unique constraints.
- Behavior must be schema-consistent between `pkm` and `pkm_test`.
- Email and Telegram inserts are fail-closed: if idempotency fields are missing, insert is rejected.

## Data flow
1. Ingest sends structured input to normalization.
2. Normalization returns canonical entry fields plus idempotency fields:
- `idempotency_policy_key`
- `idempotency_key_primary`
- `idempotency_key_secondary` (nullable)
3. Backend `/db/insert` resolves policy from `idempotency_policies` and applies conflict action.

## API requirements

### `POST /normalize/telegram`
- Input:
  - `text` required
  - `source.chat_id` and `source.message_id` required for thought-key path
  - `source.url` optional (URL can be extracted from `text`)
- `source.system` is inferred by normalization/API path as `telegram`

### `POST /normalize/email`
- Input:
  - `raw_text` required
  - `from` required for newsletter Tier2 key quality
  - `subject` required for subject-base keying
  - `source.message_id` optional but recommended
  - `source.date` recommended (used for newsletter day bucket)
- `source.system` is inferred by normalization/API path as `email`
- `source.from_addr` and `source.subject` are not used; top-level `from`/`subject` are canonical

## Policy definitions

### `telegram_thought_v1`
- source: `telegram`
- content type: `thought`/`note`
- conflict action: `update`
- primary key: `tg:{chat_id}:{message_id}`
- secondary key: optional `sha256(clean_text)`

### `telegram_link_v1`
- source: `telegram`
- content type: `link`
- conflict action: `skip`
- primary key: canonical URL
- secondary key: `sha256(normalized_url_without_tracking)`

### `email_newsletter_v1`
- source: `email`
- content type: `newsletter`
- conflict action: `skip`
- primary key: `message_id` (if present)
- secondary key: `sha256(from_addr + subject_base + date_bucket)`
- `subject_base` normalization:
  - remove `re:`, `fw:`, `fwd:`
  - remove leading `[List]` tags
  - collapse whitespace, lowercase
- `date_bucket`: America/Chicago day (`YYYY-MM-DD`)

### `email_correspondence_thread_v1`
- source: `email`
- content type: `correspondence_thread`
- conflict action: `update`
- primary key: `sha256(subject_base)`
- secondary key: none
- participants are not part of key evaluation

## DB requirements

### Policy table (both schemas)
- `idempotency_policies`
- required columns:
  - `policy_id`, `policy_key`, `source`, `content_type`, `conflict_action`, `update_fields`, `enabled`

### Entries columns (both schemas)
- `idempotency_policy_id bigint`
- `idempotency_key_primary text`
- `idempotency_key_secondary text`

### Constraints/indexes
- FK: `entries.idempotency_policy_id -> idempotency_policies.policy_id`
- unique partial index on `(idempotency_policy_id, idempotency_key_primary)` where primary not null
- unique partial index on `(idempotency_policy_id, idempotency_key_secondary)` where secondary not null

## Conflict handling
- `skip`:
  - do not insert duplicate
  - return existing row with `action = "skipped"`
- `update`:
  - update matching row
  - immutable denylist must never be updated:
    - `id`, `entry_id`, `created_at`
  - if `update_fields` is null: update all allowed incoming columns
  - if `update_fields` is set: update only those columns
  - metadata is merged recursively (object merge), not blind-overwritten
  - return row with `action = "updated"`
- successful fresh insert returns `action = "inserted"`

## Test mode and schema behavior
- Backend resolves active schema via persisted runtime test mode state.
- Idempotency lookup and policy resolution are schema-scoped.
- Behavior and seed policies must exist in both schemas.

### Test-mode requirements
- Test mode state is persisted in Postgres runtime config (`runtime_config` table), key: `is_test_mode`.
- State toggles must be atomic and immediately visible to subsequent requests.
- DB methods that resolve active `entries` table must use persisted test-mode state, not static config defaults.
- Batch workers must not depend on current test-mode flag for dequeue/sync coverage:
  - worker must scan both configured schemas (`pkm` and `pkm_test`)
  - pending jobs in either schema must continue to be processed across restarts and mode flips
- API `/config` is static config only; test-mode state is retrieved via dedicated test-mode endpoints.

### Caching requirements
- Test-mode reads may be cached in backend service to reduce DB chatter.
- Cache TTL is `10s` (default behavior in current implementation).
- Cache invalidation rules:
  - `toggle` and `set` operations must update cache immediately
  - cache miss or expired entry must read from DB
  - cache must not outlive process restart (in-memory cache only)
- Cached value is an optimization only; Postgres remains source of truth.

## Integration expectations (n8n and other clients)
- Call normalization first; do not hand-craft idempotency keys downstream.
- Insert normalized payload directly to `/db/insert`.
- Branch by `action`:
  - `skipped`: stop enrichment/update pipeline
  - `inserted` / `updated`: continue downstream processing

## Non-goals
- No duplicate side-table tracking in place of uniqueness constraints.
- No client-side duplicate suppression as primary mechanism.
- No dependence on participants for correspondence keying.
