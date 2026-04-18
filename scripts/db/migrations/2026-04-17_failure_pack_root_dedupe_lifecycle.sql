-- Failure-pack root dedupe + analysis lifecycle migration.
-- Safe to re-run.

BEGIN;

ALTER TABLE pkm.failure_packs
  ADD COLUMN IF NOT EXISTS root_execution_id text;

UPDATE pkm.failure_packs
SET root_execution_id = run_id
WHERE root_execution_id IS NULL OR btrim(root_execution_id) = '';

ALTER TABLE pkm.failure_packs
  ALTER COLUMN root_execution_id SET NOT NULL;

ALTER TABLE pkm.failure_packs
  ADD COLUMN IF NOT EXISTS reporting_workflow_names text[];

UPDATE pkm.failure_packs
SET reporting_workflow_names = '{}'::text[]
WHERE reporting_workflow_names IS NULL;

ALTER TABLE pkm.failure_packs
  ALTER COLUMN reporting_workflow_names SET DEFAULT '{}'::text[];

ALTER TABLE pkm.failure_packs
  ALTER COLUMN reporting_workflow_names SET NOT NULL;

ALTER TABLE pkm.failure_packs
  ADD COLUMN IF NOT EXISTS analysis_reason text;

ALTER TABLE pkm.failure_packs
  ADD COLUMN IF NOT EXISTS proposed_fix text;

ALTER TABLE pkm.failure_packs
  ADD COLUMN IF NOT EXISTS analyzed_at timestamptz;

UPDATE pkm.failure_packs
SET status = 'captured'
WHERE status NOT IN ('captured', 'analyzed', 'resolved');

ALTER TABLE pkm.failure_packs
  DROP CONSTRAINT IF EXISTS failure_packs_status_chk;

ALTER TABLE pkm.failure_packs
  ADD CONSTRAINT failure_packs_status_chk
  CHECK (status IN ('captured', 'analyzed', 'resolved'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'pkm'
      AND t.relname = 'failure_packs'
      AND c.conname = 'failure_packs_root_execution_id_uidx'
  ) THEN
    ALTER TABLE pkm.failure_packs
      ADD CONSTRAINT failure_packs_root_execution_id_uidx UNIQUE (root_execution_id);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS failure_packs_status_failed_at_idx
  ON pkm.failure_packs (status, failed_at DESC);

CREATE INDEX IF NOT EXISTS failure_packs_captured_failed_at_idx
  ON pkm.failure_packs (failed_at DESC)
  WHERE status = 'captured';

COMMIT;
