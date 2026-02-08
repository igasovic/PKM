/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Telegram Capture (telegram-capture)
 * Node: Build SQL - UPDATE
 * Node ID: 1c1e479b-b8f6-4d85-9c69-8c0f9943982f
 */
'use strict';

const sb = require('../../libs/sql-builder.js');

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;
  // --- DB schema routing (prod vs test) ---
  // IMPORTANT:
  // - This module reads config from the *sub-workflow node output* named exactly: "PKM Config"
  // - Your entry workflows must execute that sub-workflow at the very start.

  const config = $items('PKM Config')[0].json.config;
  const db = config.db;
  const entries_table = sb.resolveEntriesTable(db);

  // ---- required identity ----
const id = $json.id;

// ---- urls ----
const url = $json.url ?? null;
const url_canonical = $json.url_canonical ?? null;

// ---- extracted fields ----
const title = $json.title ?? null;
const author = $json.author ?? null;

// ---- core content ----
const clean_text = String($json.clean_text ?? '');
const clean_trim = clean_text.trim();
const cleanLit = clean_trim ? `${sb.lit(clean_text)}::text` : 'NULL';

// ---- extracted_text ----
const extracted_raw = $json.extracted_text ?? $json.text ?? null;
const extracted_text = (extracted_raw === null || extracted_raw === undefined) ? null : String(extracted_raw);
const extracted_trim = extracted_text ? extracted_text.trim() : '';
const extractedLit = extracted_trim ? `${sb.lit(extracted_text)}::text` : 'NULL';

// ---- retrieval patch ----
const retrieval = $json.retrieval ?? null;
const doMeta = !!(retrieval && typeof retrieval === 'object');
const q = doMeta ? (retrieval.quality || {}) : {};

// promoted retrieval columns (WP2)
const retrieval_excerpt = doMeta ? (retrieval.excerpt ?? null) : null;
const retrieval_version = doMeta ? (retrieval.version ?? null) : null;
const source_domain = doMeta ? (retrieval.source_domain ?? null) : null;

const clean_word_count = doMeta ? (q.clean_word_count ?? null) : null;
const clean_char_count = doMeta ? (q.clean_char_count ?? null) : null;
const extracted_char_count = doMeta ? (q.extracted_char_count ?? null) : null;

const link_count = doMeta ? (q.link_count ?? null) : null;
const link_ratio = doMeta ? (q.link_ratio ?? null) : null;

const boilerplate_heavy = doMeta ? (q.boilerplate_heavy ?? null) : null;
const low_signal = doMeta ? (q.low_signal ?? null) : null;
const extraction_incomplete = doMeta ? (q.extraction_incomplete ?? null) : null;

const quality_score = doMeta ? (q.quality_score ?? null) : null;

// ---- SQL ----
const sql = sb.buildUpdate({
  table: entries_table,
  set: [
    `url = COALESCE(${sb.lit(url)}, url)`,
    `url_canonical = COALESCE(${sb.lit(url_canonical)}, url_canonical)`,
    '-- only overwrite when non-empty',
    `clean_text = COALESCE(${cleanLit}, clean_text)`,
    '-- only overwrite when non-empty',
    `extracted_text = COALESCE(${extractedLit}, extracted_text)`,
    `title = COALESCE(${sb.lit(title)}::text, title)`,
    `author = COALESCE(${sb.lit(author)}::text, author)`,
    `metadata = CASE
    WHEN ${doMeta ? 'true' : 'false'} THEN
      jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{retrieval}',
        ${sb.jsonbLit(retrieval)},
        true
      )
    ELSE metadata
  END`,
    '-- WP2 promoted retrieval columns: update only when retrieval exists',
    `retrieval_excerpt = CASE WHEN ${doMeta ? 'true' : 'false'} THEN ${sb.lit(retrieval_excerpt)}::text ELSE retrieval_excerpt END`,
    `retrieval_version = CASE WHEN ${doMeta ? 'true' : 'false'} THEN ${sb.lit(retrieval_version)}::text ELSE retrieval_version END`,
    `source_domain = CASE WHEN ${doMeta ? 'true' : 'false'} THEN ${sb.lit(source_domain)}::text ELSE source_domain END`,
    `clean_word_count = CASE WHEN ${doMeta ? 'true' : 'false'} THEN ${sb.intLit(clean_word_count)}::int ELSE clean_word_count END`,
    `clean_char_count = CASE WHEN ${doMeta ? 'true' : 'false'} THEN ${sb.intLit(clean_char_count)}::int ELSE clean_char_count END`,
    `extracted_char_count = CASE WHEN ${doMeta ? 'true' : 'false'} THEN ${sb.intLit(extracted_char_count)}::int ELSE extracted_char_count END`,
    `link_count = CASE WHEN ${doMeta ? 'true' : 'false'} THEN ${sb.intLit(link_count)}::int ELSE link_count END`,
    `link_ratio = CASE WHEN ${doMeta ? 'true' : 'false'} THEN ${sb.numLit(link_ratio)}::real ELSE link_ratio END`,
    `boilerplate_heavy = CASE WHEN ${doMeta ? 'true' : 'false'} THEN ${sb.boolLit(boilerplate_heavy)}::boolean ELSE boilerplate_heavy END`,
    `low_signal = CASE WHEN ${doMeta ? 'true' : 'false'} THEN ${sb.boolLit(low_signal)}::boolean ELSE low_signal END`,
    `extraction_incomplete = CASE WHEN ${doMeta ? 'true' : 'false'} THEN ${sb.boolLit(extraction_incomplete)}::boolean ELSE extraction_incomplete END`,
    `quality_score = CASE WHEN ${doMeta ? 'true' : 'false'} THEN ${sb.numLit(quality_score)}::real ELSE quality_score END`,
    'content_hash = NULL',
  ],
  where: `id = ${sb.lit(id)}::uuid`,
  returning: [
    'entry_id',
    'id',
    'created_at',
    'source',
    'intent',
    'content_type',
    "COALESCE(title,'') AS title",
    "COALESCE(author,'') AS author",
    "COALESCE(clean_text,'') AS clean_text",
    'url_canonical',
    'COALESCE(char_length(clean_text), 0) AS clean_len',
    'COALESCE(char_length(extracted_text), 0) AS extracted_len',
  ],
});

return [{ json: { ...$json, sql } }];
};
