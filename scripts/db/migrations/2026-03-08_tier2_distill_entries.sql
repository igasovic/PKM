-- Tier-2 distill schema + backfill for entries in both schemas.
-- Safe to re-run.
--
-- Usage example:
--   docker exec -i postgres psql -U "$POSTGRES_ADMIN_USER" -d pkm \
--     -v ON_ERROR_STOP=1 -f /path/to/this/file.sql

BEGIN;

-- ----------------------------
-- pkm.entries
-- ----------------------------

ALTER TABLE pkm.entries
  ADD COLUMN IF NOT EXISTS distill_summary text,
  ADD COLUMN IF NOT EXISTS distill_excerpt text,
  ADD COLUMN IF NOT EXISTS distill_version text,
  ADD COLUMN IF NOT EXISTS distill_created_from_hash text,
  ADD COLUMN IF NOT EXISTS distill_why_it_matters text,
  ADD COLUMN IF NOT EXISTS distill_stance text,
  ADD COLUMN IF NOT EXISTS distill_status text,
  ADD COLUMN IF NOT EXISTS distill_metadata jsonb;

ALTER TABLE pkm.entries
  ALTER COLUMN distill_status SET DEFAULT 'pending';

UPDATE pkm.entries
SET distill_status = CASE
  WHEN content_type IS DISTINCT FROM 'newsletter' THEN 'not_eligible'
  WHEN clean_text IS NULL OR btrim(clean_text) = '' THEN 'skipped'
  ELSE 'pending'
END
WHERE distill_status IS NULL OR btrim(distill_status) = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'pkm'
      AND t.relname = 'entries'
      AND c.conname = 'entries_distill_status_chk'
  ) THEN
    ALTER TABLE pkm.entries
      ADD CONSTRAINT entries_distill_status_chk
      CHECK (distill_status IN ('pending','queued','completed','failed','skipped','not_eligible','stale'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'pkm'
      AND t.relname = 'entries'
      AND c.conname = 'entries_distill_stance_chk'
  ) THEN
    ALTER TABLE pkm.entries
      ADD CONSTRAINT entries_distill_stance_chk
      CHECK (
        distill_stance IS NULL OR
        distill_stance IN (
          'descriptive','analytical','argumentative','speculative',
          'instructional','narrative','other'
        )
      );
  END IF;
END$$;

ALTER TABLE pkm.entries
  ALTER COLUMN distill_status SET NOT NULL;

CREATE INDEX IF NOT EXISTS entries_distill_status_created_at_idx
  ON pkm.entries (distill_status, created_at DESC);

CREATE INDEX IF NOT EXISTS entries_distill_created_from_hash_idx
  ON pkm.entries (distill_created_from_hash);

CREATE INDEX IF NOT EXISTS entries_distill_candidate_newsletter_idx
  ON pkm.entries (created_at DESC, id)
  WHERE content_type = 'newsletter'
    AND clean_text IS NOT NULL
    AND btrim(clean_text) <> '';

-- ----------------------------
-- pkm_test.entries
-- ----------------------------

ALTER TABLE pkm_test.entries
  ADD COLUMN IF NOT EXISTS distill_summary text,
  ADD COLUMN IF NOT EXISTS distill_excerpt text,
  ADD COLUMN IF NOT EXISTS distill_version text,
  ADD COLUMN IF NOT EXISTS distill_created_from_hash text,
  ADD COLUMN IF NOT EXISTS distill_why_it_matters text,
  ADD COLUMN IF NOT EXISTS distill_stance text,
  ADD COLUMN IF NOT EXISTS distill_status text,
  ADD COLUMN IF NOT EXISTS distill_metadata jsonb;

ALTER TABLE pkm_test.entries
  ALTER COLUMN distill_status SET DEFAULT 'pending';

UPDATE pkm_test.entries
SET distill_status = CASE
  WHEN content_type IS DISTINCT FROM 'newsletter' THEN 'not_eligible'
  WHEN clean_text IS NULL OR btrim(clean_text) = '' THEN 'skipped'
  ELSE 'pending'
END
WHERE distill_status IS NULL OR btrim(distill_status) = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'pkm_test'
      AND t.relname = 'entries'
      AND c.conname = 'entries_distill_status_chk'
  ) THEN
    ALTER TABLE pkm_test.entries
      ADD CONSTRAINT entries_distill_status_chk
      CHECK (distill_status IN ('pending','queued','completed','failed','skipped','not_eligible','stale'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'pkm_test'
      AND t.relname = 'entries'
      AND c.conname = 'entries_distill_stance_chk'
  ) THEN
    ALTER TABLE pkm_test.entries
      ADD CONSTRAINT entries_distill_stance_chk
      CHECK (
        distill_stance IS NULL OR
        distill_stance IN (
          'descriptive','analytical','argumentative','speculative',
          'instructional','narrative','other'
        )
      );
  END IF;
END$$;

ALTER TABLE pkm_test.entries
  ALTER COLUMN distill_status SET NOT NULL;

CREATE INDEX IF NOT EXISTS entries_distill_status_created_at_idx
  ON pkm_test.entries (distill_status, created_at DESC);

CREATE INDEX IF NOT EXISTS entries_distill_created_from_hash_idx
  ON pkm_test.entries (distill_created_from_hash);

CREATE INDEX IF NOT EXISTS entries_distill_candidate_newsletter_idx
  ON pkm_test.entries (created_at DESC, id)
  WHERE content_type = 'newsletter'
    AND clean_text IS NOT NULL
    AND btrim(clean_text) <> '';

COMMIT;
