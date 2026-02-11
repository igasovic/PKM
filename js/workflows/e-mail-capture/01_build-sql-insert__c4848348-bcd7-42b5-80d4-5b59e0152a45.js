/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: E-Mail Capture (e-mail-capture)
 * Node: Build SQL INSERT
 * Node ID: c4848348-bcd7-42b5-80d4-5b59e0152a45
 */
'use strict';

const { getConfig } = require('../../../src/server/config.js');

const sb = require('../../libs/sql-builder.js');

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;
  // --- DB schema routing (prod vs test) ---
  // IMPORTANT:
  // - This module reads config from the *sub-workflow node output* named exactly: "PKM Config"
  // - Your entry workflows must execute that sub-workflow at the very start.

  const config = await getConfig();
  const db = config.db;
  const entries_table = sb.resolveEntriesTable(db);

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

const sql = sb.buildInsert({
  table: entries_table,
  columns: [
    'created_at',
    'source',
    'intent',
    'content_type',
    'title',
    'author',
    'capture_text',
    'clean_text',
    'url',
    'url_canonical',
    'external_ref',
    'metadata',
    'enrichment_status',
    'retrieval_excerpt',
    'retrieval_version',
    'source_domain',
    'clean_word_count',
    'clean_char_count',
    'extracted_char_count',
    'link_count',
    'link_ratio',
    'boilerplate_heavy',
    'low_signal',
    'extraction_incomplete',
    'quality_score',
  ],
  values: [
    'now()',
    `${sb.lit(source)}::text`,
    `${sb.lit(intent)}::text`,
    `${sb.lit(content_type)}::text`,
    `${sb.lit(title)}::text`,
    `${sb.lit(author)}::text`,
    `${sb.lit(capture_text)}::text`,
    `${sb.lit(clean_text)}::text`,
    `${sb.lit(url)}::text`,
    `${sb.lit(url_canonical)}::text`,
    `${sb.jsonbLit(external_ref)}`,
    `${sb.jsonbLit(metadata_patch)}`,
    `'pending'`,
    `${sb.lit(retrieval_excerpt)}::text`,
    `${sb.lit(retrieval_version)}::text`,
    `${sb.lit(source_domain)}::text`,
    `${sb.intLit(clean_word_count)}::int`,
    `${sb.intLit(clean_char_count)}::int`,
    `${sb.intLit(extracted_char_count)}::int`,
    `${sb.intLit(link_count)}::int`,
    `${sb.numLit(link_ratio)}::real`,
    `${sb.boolLit(boilerplate_heavy)}::boolean`,
    `${sb.boolLit(low_signal)}::boolean`,
    `${sb.boolLit(extraction_incomplete)}::boolean`,
    `${sb.numLit(quality_score)}::real`,
  ],
  returning: [
    'entry_id',
    'id',
    'created_at',
    'source',
    'intent',
    'content_type',
    'title',
    'author',
    'clean_text',
    'metadata',
    'COALESCE(char_length(clean_text), 0) AS clean_len',
  ],
});

return [{ json: { ...$json, sql } }];
};
