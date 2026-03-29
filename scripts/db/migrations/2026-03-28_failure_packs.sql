-- Failure-pack diagnostics table (prod schema only).
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS pkm.failure_packs (
  failure_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  run_id text NOT NULL,
  execution_id text,
  workflow_id text,
  workflow_name text NOT NULL,
  mode text,
  failed_at timestamptz,
  node_name text NOT NULL,
  node_type text,
  error_name text,
  error_message text,
  status text NOT NULL DEFAULT 'captured',
  has_sidecars boolean NOT NULL DEFAULT false,
  sidecar_root text,
  pack jsonb NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'pkm'
      AND t.relname = 'failure_packs'
      AND c.conname = 'failure_packs_run_id_uidx'
  ) THEN
    ALTER TABLE pkm.failure_packs
      ADD CONSTRAINT failure_packs_run_id_uidx UNIQUE (run_id);
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
      AND t.relname = 'failure_packs'
      AND c.conname = 'failure_packs_status_chk'
  ) THEN
    ALTER TABLE pkm.failure_packs
      ADD CONSTRAINT failure_packs_status_chk
      CHECK (status IN ('captured', 'partial', 'failed'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS failure_packs_failed_at_idx
  ON pkm.failure_packs (failed_at DESC);

CREATE INDEX IF NOT EXISTS failure_packs_workflow_failed_at_idx
  ON pkm.failure_packs (workflow_name, failed_at DESC);

CREATE INDEX IF NOT EXISTS failure_packs_node_failed_at_idx
  ON pkm.failure_packs (node_name, failed_at DESC);

CREATE INDEX IF NOT EXISTS failure_packs_mode_failed_at_idx
  ON pkm.failure_packs (mode, failed_at DESC);

CREATE INDEX IF NOT EXISTS failure_packs_captured_failed_at_idx
  ON pkm.failure_packs (failed_at DESC)
  WHERE status = 'captured';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pkm_ingest') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE pkm.failure_packs
      TO pkm_ingest;
  END IF;
END$$;

COMMIT;
