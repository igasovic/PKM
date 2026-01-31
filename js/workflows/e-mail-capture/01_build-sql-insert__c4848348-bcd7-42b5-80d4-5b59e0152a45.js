/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: E-Mail Capture (e-mail-capture)
 * Node: Build SQL INSERT
 * Node ID: c4848348-bcd7-42b5-80d4-5b59e0152a45
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;


  // --- DB schema routing (prod vs test) ---
  // Default: production schema ("pkm"). Enable test mode by setting:
  //   $json.config.db.is_test_mode = true
  // Optionally override schema names:
  //   $json.config.db.schema_prod = "pkm"
  //   $json.config.db.schema_test = "pkm_test"
  const config = ($json && $json.config) ? $json.config : {};
  const db = (config && config.db) ? config.db : {};

  const is_test_mode = !!db.is_test_mode;
  const schema_prod = db.schema_prod || 'pkm';
  const schema_test = db.schema_test || 'pkm_test';
  const schema_candidate = is_test_mode ? schema_test : schema_prod;

  const isValidIdent = (s) => (typeof s === 'string') && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s);
  const db_schema = isValidIdent(schema_candidate) ? schema_candidate : 'pkm';

  // Safe, quoted identifier reference for SQL templates
  const entries_table = `"${db_schema}"."entries"`;
function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "''");
}
function lit(v) {
  return (v === null || v === undefined) ? 'NULL' : `'${esc(v)}'`;
}
function jsonbLit(obj) {
  if (obj === null || obj === undefined) return 'NULL';
  const s = JSON.stringify(obj).replace(/\\/g, '\\\\').replace(/'/g, "''");
  return `'${s}'::jsonb`;
}
function intLit(v) {
  if (v === null || v === undefined) return 'NULL';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'NULL';
  return String(Math.trunc(n));
}
function numLit(v) {
  if (v === null || v === undefined) return 'NULL';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'NULL';
  return String(n);
}
function boolLit(v) {
  if (v === null || v === undefined) return 'NULL';
  return v ? 'true' : 'false';
}

// core fields from your normalize node
const source = 'email';
const intent = $json.intent ?? 'archive';
const content_type = $json.content_type ?? null;

const title = $json.title ?? null;
const author = $json.author ?? null;

const capture_text = $json.capture_text ?? '';
const clean_text = $json.clean_text ?? '';

const url = $json.url ?? null;
const url_canonical = $json.url_canonical ?? null;

const external_ref = $json.external_ref ?? null;

// WP1 metadata patch
const metadata_patch = $json.metadata_patch ?? ($json.retrieval ? { retrieval: $json.retrieval } : null);

// WP2 promoted retrieval columns
const r = $json.retrieval ?? metadata_patch?.retrieval ?? null;
const q = r?.quality ?? {};

const retrieval_excerpt = r?.excerpt ?? null;
const retrieval_version = r?.version ?? null;
const source_domain = r?.source_domain ?? null;

const clean_word_count = q.clean_word_count ?? null;
const clean_char_count = q.clean_char_count ?? null;
const extracted_char_count = q.extracted_char_count ?? null;

const link_count = q.link_count ?? null;
const link_ratio = q.link_ratio ?? null;

const boilerplate_heavy = q.boilerplate_heavy ?? null;
const low_signal = q.low_signal ?? null;
const extraction_incomplete = q.extraction_incomplete ?? null;

const quality_score = q.quality_score ?? null;

const sql = `
INSERT INTO ${entries_table} (
  created_at,
  source,
  intent,
  content_type,
  title,
  author,
  capture_text,
  clean_text,
  url,
  url_canonical,
  external_ref,
  metadata,
  enrichment_status,

  -- WP2 promoted retrieval columns
  retrieval_excerpt,
  retrieval_version,
  source_domain,
  clean_word_count,
  clean_char_count,
  extracted_char_count,
  link_count,
  link_ratio,
  boilerplate_heavy,
  low_signal,
  extraction_incomplete,
  quality_score
)
VALUES (
  now(),
  ${lit(source)}::text,
  ${lit(intent)}::text,
  ${lit(content_type)}::text,
  ${lit(title)}::text,
  ${lit(author)}::text,
  ${lit(capture_text)}::text,
  ${lit(clean_text)}::text,
  ${lit(url)}::text,
  ${lit(url_canonical)}::text,
  ${jsonbLit(external_ref)},
  ${jsonbLit(metadata_patch)},
  'pending',

  ${lit(retrieval_excerpt)}::text,
  ${lit(retrieval_version)}::text,
  ${lit(source_domain)}::text,
  ${intLit(clean_word_count)}::int,
  ${intLit(clean_char_count)}::int,
  ${intLit(extracted_char_count)}::int,
  ${intLit(link_count)}::int,
  ${numLit(link_ratio)}::real,
  ${boolLit(boilerplate_heavy)}::boolean,
  ${boolLit(low_signal)}::boolean,
  ${boolLit(extraction_incomplete)}::boolean,
  ${numLit(quality_score)}::real
)
RETURNING
  entry_id,
  id,
  created_at,
  source,
  intent,
  content_type,
  title,
  author,
  clean_text,
  metadata,
  COALESCE(char_length(clean_text), 0) AS clean_len;
`.trim();

return [{ json: { ...$json, sql } }];
};
