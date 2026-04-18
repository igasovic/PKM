'use strict';

const { getConfig } = require('../libs/config.js');
const {
  normalizeTelegram,
  normalizeEmail,
  normalizeWebpage,
  normalizeNotion,
  parseTelegramUrlListInput,
} = require('./normalization.js');
const {
  buildIdempotencyForNormalized,
  attachIdempotencyFields,
} = require('./idempotency.js');
const { buildRetrievalForDb } = require('./quality.js');
const { getLogger } = require('./logger/index.js');
const { getNotionClient } = require('./notion-client.js');

function ensureObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function stripInternalFields(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = { ...payload };
  delete out.__idempotency_source;
  delete out.excerpt;
  return out;
}

// Orchestration-only: normalize payload, then enrich with quality + idempotency.
function applyQualityFields(normalized, opts = {}) {
  if (!normalized || normalized.retrieval_update_skipped) return normalized;

  const config = getConfig();
  const content_type = String(normalized.content_type || opts.content_type || 'other');
  const capture_text = normalized.capture_text != null
    ? String(normalized.capture_text)
    : (normalized.clean_text != null ? String(normalized.clean_text) : '');
  const clean_text = normalized.clean_text != null ? String(normalized.clean_text) : '';
  const extracted_text = opts.extracted_text_override != null
    ? String(opts.extracted_text_override)
    : (normalized.extracted_text != null ? String(normalized.extracted_text) : '');

  const retrieval_fields = buildRetrievalForDb({
    capture_text,
    content_type,
    extracted_text,
    url_canonical: normalized.url_canonical || null,
    url: normalized.url || null,
    config,
    excerpt_override: opts.excerpt_override ?? normalized.excerpt ?? null,
    excerpt_source: clean_text || capture_text,
    quality_source_text: clean_text || capture_text,
  });

  return {
    ...normalized,
    ...retrieval_fields,
  };
}

// Orchestration-only: derive idempotency from normalized payload and merge fields.
function applyIdempotencyFields(normalized, source) {
  if (
    normalized &&
    normalized.idempotency_policy_key &&
    normalized.idempotency_key_primary
  ) {
    return normalized;
  }
  const idem = buildIdempotencyForNormalized({
    source: normalized.__idempotency_source || source,
    normalized,
  });
  return attachIdempotencyFields(normalized, idem);
}

async function runTelegramIngestionPipeline({ text, source }) {
  const logger = getLogger().child({ pipeline: 'ingestion.telegram' });
  const src = ensureObject(source);
  const normalized = await logger.step(
    'normalize.telegram',
    async () => normalizeTelegram({ text, source: src }),
    { input: { text, source: src }, output: (out) => out }
  );
  const withQuality = await logger.step(
    'quality.telegram',
    async () => applyQualityFields(normalized),
    { input: normalized, output: (out) => out }
  );
  const withIdempotency = await logger.step(
    'idempotency.telegram',
    async () => applyIdempotencyFields(withQuality, {
      ...src,
      system: 'telegram',
    }),
    { input: withQuality, output: (out) => out }
  );
  return stripInternalFields(withIdempotency);
}

async function runTelegramBulkUrlIngestionPipeline({ text, source, continue_on_error }) {
  const logger = getLogger().child({ pipeline: 'ingestion.telegram.bulk' });
  const src = ensureObject(source);
  const continueOnError = continue_on_error !== false;
  const parsed = await logger.step(
    'parse.telegram.bulk',
    async () => parseTelegramUrlListInput(text),
    { input: { text, source: src }, output: (out) => ({ url_count: out.url_count, is_mixed: out.is_mixed }) }
  );

  if (parsed.url_count < 1) {
    throw new Error('telegram url batch requires at least one URL');
  }
  if (parsed.is_mixed) {
    throw new Error('mixed telegram text and URL capture is not supported for url batch ingest');
  }

  const settled = await logger.step(
    'normalize.telegram.bulk',
    async () => {
      if (!continueOnError) {
        const strict = await Promise.all(parsed.urls.map((u) => runTelegramIngestionPipeline({ text: u.url, source: src })));
        return strict.map((value) => ({ status: 'fulfilled', value }));
      }
      return Promise.allSettled(parsed.urls.map((u) => runTelegramIngestionPipeline({ text: u.url, source: src })));
    },
    {
      input: { url_count: parsed.url_count, continue_on_error: continueOnError },
      output: (out) => ({ item_count: Array.isArray(out) ? out.length : 0 }),
    }
  );

  const items = [];
  const normalize_failures = [];
  for (let idx = 0; idx < settled.length; idx += 1) {
    const result = settled[idx];
    const srcUrl = parsed.urls[idx] || {};
    if (result && result.status === 'fulfilled') {
      const item = result.value || {};
      items.push({
        ...item,
        url: srcUrl.url || item.url || null,
        url_canonical: srcUrl.url_canonical || item.url_canonical || null,
        _bulk_index: idx,
      });
      continue;
    }
    const reason = result && result.reason;
    normalize_failures.push({
      batch_index: idx,
      url: srcUrl.url || null,
      url_canonical: srcUrl.url_canonical || null,
      error: reason && reason.message ? String(reason.message) : 'normalize failed',
    });
  }

  return {
    mode: 'url_list',
    url_count: parsed.url_count,
    urls: parsed.urls,
    items,
    normalize_failures,
  };
}

async function runEmailIngestionPipeline({ raw_text, from, subject, date, message_id, source }) {
  const logger = getLogger().child({ pipeline: 'ingestion.email' });
  const src = ensureObject(source);
  const normalized = await logger.step(
    'normalize.email',
    async () => normalizeEmail({
      raw_text,
      from,
      subject,
      date,
      message_id,
      source: src,
    }),
    { input: { raw_text, from, subject, date, message_id, source: src }, output: (out) => out }
  );
  const withQuality = await logger.step(
    'quality.email',
    async () => applyQualityFields(normalized),
    { input: normalized, output: (out) => out }
  );
  const withIdempotency = await logger.step(
    'idempotency.email',
    async () => applyIdempotencyFields(withQuality, {
      ...src,
      system: 'email',
      from_addr: src.from_addr || src.from || src.sender || from || null,
      subject: src.subject || subject || null,
      date: src.date || date || null,
      message_id: src.message_id || message_id || null,
      body: src.body || raw_text || null,
    }),
    { input: withQuality, output: (out) => out }
  );
  return stripInternalFields(withIdempotency);
}

async function runWebpageIngestionPipeline({
  text,
  extracted_text,
  clean_text,
  capture_text,
  content_type,
  url,
  url_canonical,
  excerpt,
  source,
}) {
  const logger = getLogger().child({ pipeline: 'ingestion.webpage' });
  const src = ensureObject(source);
  const normalized = await logger.step(
    'normalize.webpage',
    async () => normalizeWebpage({
      text,
      extracted_text,
      clean_text,
      capture_text,
      content_type,
      url,
      url_canonical,
      excerpt,
    }),
    {
      input: { text, extracted_text, clean_text, capture_text, content_type, url, url_canonical, excerpt, source: src },
      output: (out) => out,
    }
  );

  const withQuality = await logger.step(
    'quality.webpage',
    async () => applyQualityFields(normalized, {
      content_type,
      excerpt_override: excerpt ?? null,
      extracted_text_override: normalized && normalized.capture_text != null ? normalized.capture_text : null,
    }),
    { input: normalized, output: (out) => out }
  );
  const withIdempotency = await logger.step(
    'idempotency.webpage',
    async () => applyIdempotencyFields(withQuality, {
      ...src,
      system: src.system || 'telegram',
    }),
    { input: withQuality, output: (out) => out }
  );
  return stripInternalFields(withIdempotency);
}

async function runNotionIngestionPipeline({
  id,
  updated_at,
  created_at,
  content_type,
  title,
  url,
  capture_text,
}) {
  const logger = getLogger().child({ pipeline: 'ingestion.notion' });
  const notionPageId = String(id || '').trim();

  const collected = await logger.step(
    'collect.notion.page',
    async () => getNotionClient().buildNotionObject({
      page_id: notionPageId,
      updated_at: updated_at || null,
      created_at: created_at || null,
      content_type: content_type || null,
      title: title || null,
      url: url || null,
    }),
    {
      input: { page_id: notionPageId },
      output: (out) => ({
        notion: out.notion,
        collect: out.collect,
        capture_text_chars: out.capture_text ? String(out.capture_text).length : 0,
      }),
    }
  );

  const collectErrors = collected && collected.collect && Array.isArray(collected.collect.errors)
    ? collected.collect.errors
    : [];
  for (const err of collectErrors) {
    await logger.event('error', 'notion.collect.unsupported_block', { data: err });
  }

  const normalizedInput = {
    notion: collected.notion,
    updated_at: updated_at || (collected ? collected.updated_at : null),
    created_at: created_at || (collected ? collected.created_at : null),
    content_type: content_type || (collected ? collected.content_type : null),
    title: title || (collected ? collected.title : null),
    url: url || (collected ? collected.url : null),
    capture_text: capture_text || (collected ? collected.capture_text : null),
    blocks: collected.blocks,
    source: {
      ...(collected && collected.collect ? { notion_collect: collected.collect } : {}),
    },
  };

  const normalized = await logger.step(
    'normalize.notion',
    async () => normalizeNotion({
      notion: normalizedInput.notion,
      updated_at: normalizedInput.updated_at,
      created_at: normalizedInput.created_at,
      content_type: normalizedInput.content_type,
      title: normalizedInput.title,
      url: normalizedInput.url,
      capture_text: normalizedInput.capture_text,
      blocks: normalizedInput.blocks,
      source: normalizedInput.source,
    }),
    {
      input: normalizedInput,
      output: (out) => out,
    }
  );

  if (normalized && normalized.skipped === true) {
    const skipErrors = Array.isArray(normalized.skip_errors) ? normalized.skip_errors : [];
    for (const err of skipErrors) {
      await logger.event('error', 'notion.unsupported_block', { data: err });
    }
    return stripInternalFields(normalized);
  }

  const withIdempotency = await logger.step(
    'idempotency.notion',
    async () => applyIdempotencyFields(normalized, {
      system: 'notion',
      notion: {
        ...(normalizedInput.notion && typeof normalizedInput.notion === 'object' ? normalizedInput.notion : {}),
      },
      title: normalizedInput.title || null,
      content_type: normalizedInput.content_type || null,
      created_at: normalizedInput.created_at || null,
    }),
    { input: normalized, output: (out) => out }
  );
  const withQuality = await logger.step(
    'quality.notion',
    async () => applyQualityFields(withIdempotency, { content_type }),
    { input: withIdempotency, output: (out) => out }
  );
  return stripInternalFields(withQuality);
}

module.exports = {
  runTelegramIngestionPipeline,
  runTelegramBulkUrlIngestionPipeline,
  runEmailIngestionPipeline,
  runWebpageIngestionPipeline,
  runNotionIngestionPipeline,
};
