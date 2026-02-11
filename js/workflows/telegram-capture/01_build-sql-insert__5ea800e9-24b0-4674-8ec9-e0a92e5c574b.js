/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Telegram Capture (telegram-capture)
 * Node: Build SQL - INSERT
 * Node ID: 5ea800e9-24b0-4674-8ec9-e0a92e5c574b
 */
'use strict';

const { getConfig } = require('../../../src/server/config.js');

const sb = require('../../libs/sql-builder.js');

module.exports = async function run(ctx) {
  const { $json, $items } = ctx;

  // --- DB schema routing (prod vs test) ---
  // IMPORTANT:
  // - This module reads config from the *sub-workflow node output* named exactly: "PKM Config"
  // - Your entry workflows must execute that sub-workflow at the very start.
  const config = await getConfig();
  const db = config.db;
  const entries_table = sb.resolveEntriesTable(db);

  const msg = $json.message || {};

  const source = 'telegram';
  const intent = $json.intent || 'archive';
  const content_type = $json.content_type || null;

  const title = $json.title ?? null;
  const author = $json.author ?? null;

  const capture_text = $json.capture_text ?? msg.text ?? '';

  // For PKM JSON note mode, Normalize forces these to null to bypass extraction.
  const url = $json.url ?? null;
  const url_canonical = $json.url_canonical ?? null;

  // New: Persist clean_text + topic + gist (from Normalize)
  const clean_text = $json.clean_text ?? null;

  // Accept either the JSON-note field names or already-promoted names
  const topic_primary = $json.topic_primary ?? $json.topic ?? null;
  const topic_primary_confidence = $json.topic_primary_confidence ?? $json.primary_topic_confidence ?? null;

  const topic_secondary = $json.topic_secondary ?? $json.secondary_topic ?? null;
  const topic_secondary_confidence = $json.topic_secondary_confidence ?? $json.secondary_topic_confidence ?? null;

  const gist = $json.gist ?? null;

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
      'topic_primary',
      'topic_primary_confidence',
      'topic_secondary',
      'topic_secondary_confidence',
      'gist',
      'metadata',
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
      `${sb.lit(topic_primary)}::text`,
      `${sb.numLit(topic_primary_confidence)}::real`,
      `${sb.lit(topic_secondary)}::text`,
      `${sb.numLit(topic_secondary_confidence)}::real`,
      `${sb.lit(gist)}::text`,
      `${sb.jsonbLit(metadata_patch, { dollarTag: 'pkmjson' })}`,
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
      'url',
      'url_canonical',
      'COALESCE(char_length(capture_text), 0) AS text_len',
    ],
  });

  return [{ json: { ...$json, sql } }];
};
