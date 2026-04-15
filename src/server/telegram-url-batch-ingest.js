'use strict';

const readWriteRepository = require('./repositories/read-write-repository.js');
const { runTelegramBulkUrlIngestionPipeline } = require('./ingestion-pipeline.js');

const DEFAULT_RETURNING = [
  'entry_id',
  'id',
  'created_at',
  'source',
  'intent',
  'content_type',
  'url',
  'url_canonical',
  'COALESCE(char_length(capture_text), 0) AS text_len',
];

function toTelegramInsertItem(normalized, opts = {}) {
  const smokeMode = opts.smoke_mode === true;
  const smokeRunId = String(opts.test_run_id || '').trim();
  const metadataPatch = normalized.metadata_patch ?? (normalized.retrieval ? { retrieval: normalized.retrieval } : null);
  const metadata = smokeMode && smokeRunId
    ? { ...(metadataPatch || {}), smoke: { suite: 'T00', run_id: smokeRunId } }
    : metadataPatch;

  return {
    source: 'telegram',
    intent: normalized.intent,
    content_type: normalized.content_type,
    title: null,
    author: null,
    capture_text: normalized.capture_text,
    clean_text: normalized.clean_text,
    url: normalized.url ?? null,
    url_canonical: normalized.url_canonical ?? null,

    topic_primary: null,
    topic_primary_confidence: null,
    topic_secondary: null,
    topic_secondary_confidence: null,
    gist: null,

    idempotency_policy_key: normalized.idempotency_policy_key,
    idempotency_key_primary: normalized.idempotency_key_primary,
    idempotency_key_secondary: normalized.idempotency_key_secondary,

    metadata,
    retrieval_excerpt: normalized.retrieval?.excerpt ?? null,
    retrieval_version: normalized.retrieval?.version ?? null,
    source_domain: normalized.retrieval?.source_domain ?? null,

    clean_word_count: normalized.retrieval?.quality?.clean_word_count ?? null,
    clean_char_count: normalized.retrieval?.quality?.clean_char_count ?? null,
    extracted_char_count: normalized.retrieval?.quality?.extracted_char_count ?? null,
    link_count: normalized.retrieval?.quality?.link_count ?? null,
    link_ratio: normalized.retrieval?.quality?.link_ratio ?? null,
    boilerplate_heavy: normalized.retrieval?.quality?.boilerplate_heavy ?? null,
    low_signal: normalized.retrieval?.quality?.low_signal ?? null,
    extraction_incomplete: normalized.retrieval?.quality?.extraction_incomplete ?? null,
    quality_score: normalized.retrieval?.quality?.quality_score ?? null,
  };
}

async function ingestTelegramUrlBatch(body = {}) {
  const continueOnError = body.continue_on_error !== false;
  const normalized = await runTelegramBulkUrlIngestionPipeline({
    text: body.text,
    source: body.source,
    continue_on_error: continueOnError,
  });

  const items = normalized.items.map((item) => toTelegramInsertItem(item, {
    smoke_mode: body.smoke_mode,
    test_run_id: body.test_run_id,
  }));
  const itemBatchIndexes = normalized.items.map((item) => Number(item._bulk_index));

  const inserted = items.length > 0
    ? await readWriteRepository.insert({
      items,
      continue_on_error: continueOnError,
      returning: DEFAULT_RETURNING,
    })
    : { rows: [] };

  const rows = Array.isArray(inserted && inserted.rows) ? inserted.rows : [];
  const rowResults = rows.map((row) => {
    const insertIndex = Number.isFinite(Number(row && row._batch_index)) ? Number(row._batch_index) : -1;
    const batchIndex = insertIndex >= 0
      ? (Number.isFinite(itemBatchIndexes[insertIndex]) ? itemBatchIndexes[insertIndex] : insertIndex)
      : -1;
    const sourceUrl = batchIndex >= 0 && Array.isArray(normalized.urls) ? normalized.urls[batchIndex] : null;
    const isOk = row && row._batch_ok !== false;
    return {
      batch_index: batchIndex,
      ok: isOk,
      action: isOk ? String(row.action || 'inserted') : 'failed',
      entry_id: row.entry_id ?? null,
      id: row.id ?? null,
      url: row.url ?? (sourceUrl ? sourceUrl.url : null),
      url_canonical: row.url_canonical ?? (sourceUrl ? sourceUrl.url_canonical : null),
      error: isOk ? null : (row.error || 'insert failed'),
    };
  });

  const resultsByIndex = new Map();
  rowResults.forEach((r) => {
    if (r.batch_index >= 0) resultsByIndex.set(r.batch_index, r);
  });
  const normalizeFailures = Array.isArray(normalized.normalize_failures) ? normalized.normalize_failures : [];
  normalizeFailures.forEach((f) => {
    const batchIndex = Number.isFinite(Number(f && f.batch_index)) ? Number(f.batch_index) : -1;
    if (batchIndex < 0 || resultsByIndex.has(batchIndex)) return;
    resultsByIndex.set(batchIndex, {
      batch_index: batchIndex,
      ok: false,
      action: 'failed',
      entry_id: null,
      id: null,
      url: f.url ?? null,
      url_canonical: f.url_canonical ?? null,
      error: f.error || 'normalize failed',
    });
  });

  const declaredUrlCount = Number.isFinite(Number(normalized.url_count)) ? Number(normalized.url_count) : 0;
  const declaredUrls = Array.isArray(normalized.urls) ? normalized.urls : [];
  for (let idx = 0; idx < declaredUrlCount; idx += 1) {
    if (resultsByIndex.has(idx)) continue;
    const srcUrl = declaredUrls[idx] || {};
    resultsByIndex.set(idx, {
      batch_index: idx,
      ok: false,
      action: 'failed',
      entry_id: null,
      id: null,
      url: srcUrl.url || null,
      url_canonical: srcUrl.url_canonical || null,
      error: 'missing batch result',
    });
  }

  const results = Array.from(resultsByIndex.values())
    .sort((a, b) => a.batch_index - b.batch_index);

  const counts = {
    inserted_count: results.filter((r) => r.action === 'inserted').length,
    updated_count: results.filter((r) => r.action === 'updated').length,
    skipped_count: results.filter((r) => r.action === 'skipped').length,
    failed_count: results.filter((r) => r.action === 'failed').length,
  };

  return {
    mode: 'url_list',
    url_count: normalized.url_count,
    ...counts,
    results,
  };
}

module.exports = {
  ingestTelegramUrlBatch,
};
