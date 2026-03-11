-- Tier-2 async batch persistence tables for prod/test schemas.
-- Safe to re-run.

BEGIN;

-- ----------------------------
-- pkm
-- ----------------------------

CREATE TABLE IF NOT EXISTS pkm.t2_batches (
  batch_id text PRIMARY KEY,
  status text,
  model text,
  request_type text,
  input_file_id text,
  output_file_id text,
  error_file_id text,
  request_count int,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pkm.t2_batch_items (
  batch_id text NOT NULL REFERENCES pkm.t2_batches(batch_id) ON DELETE CASCADE,
  custom_id text NOT NULL,
  entry_id bigint NOT NULL,
  content_hash text,
  route text,
  chunking_strategy text,
  request_type text,
  title text,
  author text,
  content_type text,
  prompt_mode text,
  prompt text,
  retry_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, custom_id)
);

CREATE TABLE IF NOT EXISTS pkm.t2_batch_item_results (
  batch_id text NOT NULL,
  custom_id text NOT NULL,
  status text NOT NULL,
  response_text text,
  parsed jsonb,
  error jsonb,
  raw jsonb,
  applied boolean NOT NULL DEFAULT false,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, custom_id),
  CONSTRAINT t2_batch_item_results_fk_item
    FOREIGN KEY (batch_id, custom_id) REFERENCES pkm.t2_batch_items(batch_id, custom_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS t2_batches_status_created_at_idx
  ON pkm.t2_batches (status, created_at DESC);

CREATE INDEX IF NOT EXISTS t2_batches_created_at_idx
  ON pkm.t2_batches (created_at DESC);

CREATE INDEX IF NOT EXISTS t2_batch_items_entry_id_idx
  ON pkm.t2_batch_items (entry_id);

CREATE INDEX IF NOT EXISTS t2_batch_items_created_at_idx
  ON pkm.t2_batch_items (created_at DESC);

CREATE INDEX IF NOT EXISTS t2_batch_item_results_status_idx
  ON pkm.t2_batch_item_results (status);

CREATE INDEX IF NOT EXISTS t2_batch_item_results_applied_idx
  ON pkm.t2_batch_item_results (applied, updated_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pkm_ingest') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE pkm.t2_batches, pkm.t2_batch_items, pkm.t2_batch_item_results
      TO pkm_ingest;
  END IF;
END$$;

-- ----------------------------
-- pkm_test
-- ----------------------------

CREATE TABLE IF NOT EXISTS pkm_test.t2_batches (
  batch_id text PRIMARY KEY,
  status text,
  model text,
  request_type text,
  input_file_id text,
  output_file_id text,
  error_file_id text,
  request_count int,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pkm_test.t2_batch_items (
  batch_id text NOT NULL REFERENCES pkm_test.t2_batches(batch_id) ON DELETE CASCADE,
  custom_id text NOT NULL,
  entry_id bigint NOT NULL,
  content_hash text,
  route text,
  chunking_strategy text,
  request_type text,
  title text,
  author text,
  content_type text,
  prompt_mode text,
  prompt text,
  retry_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, custom_id)
);

CREATE TABLE IF NOT EXISTS pkm_test.t2_batch_item_results (
  batch_id text NOT NULL,
  custom_id text NOT NULL,
  status text NOT NULL,
  response_text text,
  parsed jsonb,
  error jsonb,
  raw jsonb,
  applied boolean NOT NULL DEFAULT false,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, custom_id),
  CONSTRAINT t2_batch_item_results_fk_item
    FOREIGN KEY (batch_id, custom_id) REFERENCES pkm_test.t2_batch_items(batch_id, custom_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS t2_batches_status_created_at_idx
  ON pkm_test.t2_batches (status, created_at DESC);

CREATE INDEX IF NOT EXISTS t2_batches_created_at_idx
  ON pkm_test.t2_batches (created_at DESC);

CREATE INDEX IF NOT EXISTS t2_batch_items_entry_id_idx
  ON pkm_test.t2_batch_items (entry_id);

CREATE INDEX IF NOT EXISTS t2_batch_items_created_at_idx
  ON pkm_test.t2_batch_items (created_at DESC);

CREATE INDEX IF NOT EXISTS t2_batch_item_results_status_idx
  ON pkm_test.t2_batch_item_results (status);

CREATE INDEX IF NOT EXISTS t2_batch_item_results_applied_idx
  ON pkm_test.t2_batch_item_results (applied, updated_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pkm_ingest') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE pkm_test.t2_batches, pkm_test.t2_batch_items, pkm_test.t2_batch_item_results
      TO pkm_ingest;
  END IF;
END$$;

COMMIT;
