-- Recipe-to-recipe links (mirrored in pkm and pkm_test).
-- Safe to re-run.

BEGIN;

DO $$
DECLARE
  schema_name text;
  table_fqn text;
BEGIN
  FOREACH schema_name IN ARRAY ARRAY['pkm', 'pkm_test']
  LOOP
    table_fqn := format('%I.recipe_links', schema_name);

    EXECUTE format($sql$
      CREATE TABLE IF NOT EXISTS %s (
        recipe_id_a bigint NOT NULL REFERENCES %I.recipes(id) ON DELETE CASCADE,
        recipe_id_b bigint NOT NULL REFERENCES %I.recipes(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT recipe_links_pk PRIMARY KEY (recipe_id_a, recipe_id_b),
        CONSTRAINT recipe_links_order_chk CHECK (recipe_id_a < recipe_id_b)
      )
    $sql$, table_fqn, schema_name, schema_name);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %s (recipe_id_a)',
      schema_name || '_recipe_links_recipe_a_idx',
      table_fqn
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %s (recipe_id_b)',
      schema_name || '_recipe_links_recipe_b_idx',
      table_fqn
    );

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pkm_ingest') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO pkm_ingest', table_fqn);
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pkm_read') THEN
      EXECUTE format('GRANT SELECT ON TABLE %s TO pkm_read', table_fqn);
    END IF;
  END LOOP;
END$$;

COMMIT;
