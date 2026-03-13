-- Family calendar business-log tables (prod schema only).
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS pkm.calendar_requests (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  run_id text NOT NULL,
  source_system text NOT NULL DEFAULT 'telegram',
  actor_code text NOT NULL,
  telegram_chat_id text NOT NULL,
  telegram_message_id text NOT NULL,
  route_intent text,
  route_confidence numeric,
  status text NOT NULL,
  raw_text text NOT NULL,
  clarification_turns jsonb NOT NULL DEFAULT '[]'::jsonb,
  normalized_event jsonb,
  warning_codes jsonb,
  error jsonb,
  google_calendar_id text,
  google_event_id text,
  idempotency_key_primary text NOT NULL,
  idempotency_key_secondary text
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'pkm'
      AND t.relname = 'calendar_requests'
      AND c.conname = 'calendar_requests_status_chk'
  ) THEN
    ALTER TABLE pkm.calendar_requests
      ADD CONSTRAINT calendar_requests_status_chk
      CHECK (
        status IN (
          'received',
          'routed',
          'needs_clarification',
          'clarified',
          'normalized',
          'calendar_write_started',
          'calendar_created',
          'calendar_failed',
          'query_answered',
          'ignored'
        )
      );
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS calendar_requests_idem_primary_uidx
  ON pkm.calendar_requests (idempotency_key_primary);

CREATE INDEX IF NOT EXISTS calendar_requests_telegram_chat_updated_idx
  ON pkm.calendar_requests (telegram_chat_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS calendar_requests_one_open_per_chat_uidx
  ON pkm.calendar_requests (telegram_chat_id)
  WHERE status = 'needs_clarification';

CREATE TABLE IF NOT EXISTS pkm.calendar_event_observations (
  observation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  run_id text NOT NULL,
  google_calendar_id text NOT NULL,
  google_event_id text NOT NULL,
  observation_kind text NOT NULL,
  source_type text NOT NULL,
  event_snapshot jsonb NOT NULL,
  resolved_people jsonb,
  resolved_color text,
  was_reported boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS calendar_event_observations_event_idx
  ON pkm.calendar_event_observations (google_calendar_id, google_event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS calendar_event_observations_kind_created_idx
  ON pkm.calendar_event_observations (observation_kind, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pkm_ingest') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE pkm.calendar_requests, pkm.calendar_event_observations
      TO pkm_ingest;
  END IF;
END$$;

COMMIT;
