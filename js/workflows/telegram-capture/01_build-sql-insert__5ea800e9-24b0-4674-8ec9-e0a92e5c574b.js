/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Telegram Capture (telegram-capture)
 * Node: Build SQL - INSERT
 * Node ID: 5ea800e9-24b0-4674-8ec9-e0a92e5c574b
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;
  // --- DB schema routing (prod vs test) ---
  // IMPORTANT:
  // - This module reads config from the *sub-workflow node output* named exactly: "PKM Config"
  // - Your entry workflows must execute that sub-workflow at the very start.

  const config = $items('PKM Config')[0].json.config;
  const db = config.db;

  const is_test_mode = !!db.is_test_mode;
  const schema_prod = db.schema_prod || 'pkm';
  const schema_test = db.schema_test || 'pkm_test';
  const schema_candidate = is_test_mode ? schema_test : schema_prod;

  const isValidIdent = (s) => (typeof s === 'string') && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s);
  const db_schema = isValidIdent(schema_candidate) ? schema_candidate : 'pkm';

  // Safe, quoted identifier reference for SQL templates
  const entries_table = `"${db_schema}"."entries"`;
function sqlString(v) {
  if (v === null || v === undefined) return 'NULL';
  const s = String(v).replace(/\\/g, '\\\\').replace(/'/g, "''");
  return `'${s}'`;
}

function sqlJsonb(obj) {
  if (obj === null || obj === undefined) return 'NULL';
  const s = JSON.stringify(obj).replace(/\\/g, '\\\\').replace(/'/g, "''");
  return `'${s}'::jsonb`;
}

function sqlInt(v) {
  if (v === null || v === undefined) return 'NULL';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'NULL';
  return String(Math.trunc(n));
}

function sqlNum(v) {
  if (v === null || v === undefined) return 'NULL';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'NULL';
  return String(n);
}

function sqlBool(v) {
  if (v === null || v === undefined) return 'NULL';
  return v ? 'true' : 'false';
}

const msg = $json.message || {};

const source = 'telegram';
const intent = $json.intent || 'archive';
const content_type = $json.content_type || null;

const title = $json.title ?? null;
const author = $json.author ?? null;

const capture_text = $json.capture_text ?? msg.text ?? '';
const url = $json.url ?? null;
const url_canonical = $json.url_canonical ?? null;

// metadata + retrieval (WP1 compute node)
const metadata_patch = $json.metadata_patch ?? ($json.retrieval ? { retrieval: $json.retrieval } : null);
const r = $json.retrieval ?? metadata_patch?.retrieval ?? null;
const q = r?.quality ?? {};

// promoted retrieval columns (WP2)
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
  url,
  url_canonical,
  metadata,

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
  ${sqlString(source)}::text,
  ${sqlString(intent)}::text,
  ${sqlString(content_type)}::text,
  ${sqlString(title)}::text,
  ${sqlString(author)}::text,
  ${sqlString(capture_text)}::text,
  ${sqlString(url)}::text,
  ${sqlString(url_canonical)}::text,
  ${sqlJsonb(metadata_patch)},

  ${sqlString(retrieval_excerpt)}::text,
  ${sqlString(retrieval_version)}::text,
  ${sqlString(source_domain)}::text,
  ${sqlInt(clean_word_count)}::int,
  ${sqlInt(clean_char_count)}::int,
  ${sqlInt(extracted_char_count)}::int,
  ${sqlInt(link_count)}::int,
  ${sqlNum(link_ratio)}::real,
  ${sqlBool(boilerplate_heavy)}::boolean,
  ${sqlBool(low_signal)}::boolean,
  ${sqlBool(extraction_incomplete)}::boolean,
  ${sqlNum(quality_score)}::real
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
  url,
  url_canonical,
  COALESCE(char_length(capture_text), 0) AS text_len;
`.trim();

return [{ json: { ...$json, sql } }];
};
