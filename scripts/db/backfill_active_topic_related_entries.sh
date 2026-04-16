#!/usr/bin/env bash
set -euo pipefail

MODE="${1:---dry-run}"
SCHEMA_MODE="${2:-pkm}"
CONTAINER="${POSTGRES_CONTAINER:-postgres}"
DB="${POSTGRES_DB:-pkm}"
DB_USER="${POSTGRES_USER:-pgadmin}"

usage() {
  cat <<'EOF'
Usage:
  scripts/db/backfill_active_topic_related_entries.sh [--dry-run|--apply] [pkm|pkm_test|both]

Description:
  Backfills active-topic entry links from entries.topic_primary into
  <schema>.active_topic_related_entries using relation_type='classified_primary'.
  Only active topics in <schema>.active_topics are linked.

All-or-nothing:
  --apply runs inside a transaction (rollback on any failure).

Environment overrides:
  POSTGRES_CONTAINER (default: postgres)
  POSTGRES_DB        (default: pkm)
  POSTGRES_USER      (default: pgadmin)
EOF
}

if [[ "$MODE" != "--dry-run" && "$MODE" != "--apply" ]]; then
  usage
  exit 1
fi

if [[ "$SCHEMA_MODE" != "pkm" && "$SCHEMA_MODE" != "pkm_test" && "$SCHEMA_MODE" != "both" ]]; then
  usage
  exit 1
fi

run_psql() {
  docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB" -v ON_ERROR_STOP=1 "$@"
}

normalize_topic_sql() {
  cat <<'EOF'
regexp_replace(
  regexp_replace(lower(trim(coalesce(e.topic_primary, ''))), '[^a-z0-9]+', '-', 'g'),
  '(^-+|-+$)',
  '',
  'g'
)
EOF
}

echo "container=$CONTAINER db=$DB user=$DB_USER mode=$MODE schema=$SCHEMA_MODE"

run_dry_for_schema() {
  local schema="$1"
  local norm
  norm="$(normalize_topic_sql)"
  run_psql <<SQL
\pset format aligned
\pset tuples_only off
\pset pager off

WITH normalized_entries AS (
  SELECT
    e.entry_id,
    ${norm} AS normalized_topic_key
  FROM ${schema}.entries e
)
SELECT
  '${schema}' AS schema_name,
  (SELECT COUNT(*)::int FROM normalized_entries ne JOIN ${schema}.active_topics t ON t.topic_key = ne.normalized_topic_key AND t.is_active = true) AS candidate_entry_links,
  (SELECT COUNT(*)::int FROM normalized_entries ne WHERE ne.normalized_topic_key <> '' AND NOT EXISTS (
      SELECT 1 FROM ${schema}.active_topics t WHERE t.topic_key = ne.normalized_topic_key AND t.is_active = true
    )) AS non_active_topic_rows,
  (SELECT COUNT(*)::int FROM ${schema}.active_topic_related_entries r WHERE r.relation_type = 'classified_primary') AS existing_classified_links,
  (SELECT COUNT(*)::int FROM ${schema}.active_topic_related_entries) AS existing_total_links;
SQL
}

run_apply_for_schema() {
  local schema="$1"
  local norm
  norm="$(normalize_topic_sql)"
  run_psql <<SQL
\pset format aligned
\pset tuples_only off
\pset pager off

BEGIN;

WITH normalized_entries AS (
  SELECT
    e.entry_id,
    e.topic_primary,
    e.topic_secondary,
    e.topic_primary_confidence,
    e.topic_secondary_confidence,
    ${norm} AS normalized_topic_key
  FROM ${schema}.entries e
),
deleted AS (
  DELETE FROM ${schema}.active_topic_related_entries r
  WHERE r.relation_type = 'classified_primary'
  RETURNING 1
),
upserted AS (
  INSERT INTO ${schema}.active_topic_related_entries (
    topic_key,
    entry_id,
    relation_type,
    metadata,
    created_at,
    updated_at
  )
  SELECT
    t.topic_key,
    ne.entry_id,
    'classified_primary',
    jsonb_build_object(
      'source', 'tier1_backfill',
      'topic_primary', ne.topic_primary,
      'topic_secondary', ne.topic_secondary,
      'topic_primary_confidence', ne.topic_primary_confidence,
      'topic_secondary_confidence', ne.topic_secondary_confidence,
      'backfilled_at', now()
    ),
    now(),
    now()
  FROM normalized_entries ne
  JOIN ${schema}.active_topics t
    ON t.topic_key = ne.normalized_topic_key
   AND t.is_active = true
  ON CONFLICT (topic_key, entry_id)
  DO UPDATE SET
    relation_type = EXCLUDED.relation_type,
    metadata = EXCLUDED.metadata,
    updated_at = now()
  RETURNING 1
)
SELECT
  '${schema}' AS schema_name,
  (SELECT COUNT(*)::int FROM deleted) AS removed_previous_classified_links,
  (SELECT COUNT(*)::int FROM upserted) AS upserted_classified_links;

COMMIT;
SQL
}

if [[ "$MODE" == "--dry-run" ]]; then
  if [[ "$SCHEMA_MODE" == "both" ]]; then
    run_dry_for_schema "pkm"
    run_dry_for_schema "pkm_test"
  else
    run_dry_for_schema "$SCHEMA_MODE"
  fi
  exit 0
fi

if [[ "$SCHEMA_MODE" == "both" ]]; then
  run_apply_for_schema "pkm"
  run_apply_for_schema "pkm_test"
else
  run_apply_for_schema "$SCHEMA_MODE"
fi
