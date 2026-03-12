#!/usr/bin/env bash
set -euo pipefail

# Temporary one-off script. Intended to be removed after content_hash rollout is complete.

MODE="${1:---dry-run}"
CONTAINER="${POSTGRES_CONTAINER:-postgres}"
DB="${POSTGRES_DB:-pkm}"
DB_USER="${POSTGRES_USER:-pgadmin}"

usage() {
  cat <<'EOF'
Usage:
  scripts/db/backfill_content_hash.sh [--dry-run|--apply]

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

run_psql() {
  docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB" -v ON_ERROR_STOP=1 "$@"
}

echo "container=$CONTAINER db=$DB user=$DB_USER mode=$MODE"

if [[ "$MODE" == "--dry-run" ]]; then
  run_psql <<'SQL'
\pset format aligned
\pset tuples_only off
\pset pager off

SELECT
  'pkm' AS schema_name,
  COUNT(*) FILTER (
    WHERE clean_text IS NOT NULL
      AND btrim(clean_text) <> ''
      AND content_hash IS DISTINCT FROM encode(digest(clean_text, 'sha256'), 'hex')
  ) AS rows_needing_rehash,
  COUNT(*) FILTER (
    WHERE (clean_text IS NULL OR btrim(clean_text) = '')
      AND content_hash IS NOT NULL
  ) AS rows_needing_null_clear
FROM pkm.entries
UNION ALL
SELECT
  'pkm_test' AS schema_name,
  COUNT(*) FILTER (
    WHERE clean_text IS NOT NULL
      AND btrim(clean_text) <> ''
      AND content_hash IS DISTINCT FROM encode(digest(clean_text, 'sha256'), 'hex')
  ) AS rows_needing_rehash,
  COUNT(*) FILTER (
    WHERE (clean_text IS NULL OR btrim(clean_text) = '')
      AND content_hash IS NOT NULL
  ) AS rows_needing_null_clear
FROM pkm_test.entries
ORDER BY schema_name;
SQL
  exit 0
fi

run_psql <<'SQL'
\pset format aligned
\pset tuples_only off
\pset pager off

BEGIN;

WITH pkm_rehash AS (
  UPDATE pkm.entries
  SET content_hash = encode(digest(clean_text, 'sha256'), 'hex')
  WHERE clean_text IS NOT NULL
    AND btrim(clean_text) <> ''
    AND content_hash IS DISTINCT FROM encode(digest(clean_text, 'sha256'), 'hex')
  RETURNING 1
),
pkm_clear AS (
  UPDATE pkm.entries
  SET content_hash = NULL
  WHERE (clean_text IS NULL OR btrim(clean_text) = '')
    AND content_hash IS NOT NULL
  RETURNING 1
),
pkm_test_rehash AS (
  UPDATE pkm_test.entries
  SET content_hash = encode(digest(clean_text, 'sha256'), 'hex')
  WHERE clean_text IS NOT NULL
    AND btrim(clean_text) <> ''
    AND content_hash IS DISTINCT FROM encode(digest(clean_text, 'sha256'), 'hex')
  RETURNING 1
),
pkm_test_clear AS (
  UPDATE pkm_test.entries
  SET content_hash = NULL
  WHERE (clean_text IS NULL OR btrim(clean_text) = '')
    AND content_hash IS NOT NULL
  RETURNING 1
)
SELECT
  'pkm' AS schema_name,
  (SELECT COUNT(*) FROM pkm_rehash) AS rows_rehashed,
  (SELECT COUNT(*) FROM pkm_clear) AS rows_cleared_to_null
UNION ALL
SELECT
  'pkm_test' AS schema_name,
  (SELECT COUNT(*) FROM pkm_test_rehash) AS rows_rehashed,
  (SELECT COUNT(*) FROM pkm_test_clear) AS rows_cleared_to_null
ORDER BY schema_name;

COMMIT;
SQL

