'use strict';

const { getConfig } = require('../libs/config.js');
const {
  normalizeTelegram,
  normalizeEmail,
  normalizeWebpage,
} = require('./normalization.js');
const {
  buildIdempotencyForNormalized,
  attachIdempotencyFields,
} = require('./idempotency.js');
const { buildRetrievalForDb } = require('./quality.js');

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
  const extracted_text = normalized.extracted_text != null
    ? String(normalized.extracted_text)
    : '';

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
  const src = ensureObject(source);
  const normalized = await normalizeTelegram({ text, source: src });
  const withQuality = applyQualityFields(normalized);
  const withIdempotency = applyIdempotencyFields(withQuality, {
    ...src,
    system: 'telegram',
  });
  return stripInternalFields(withIdempotency);
}

async function runEmailIngestionPipeline({ raw_text, from, subject, date, message_id, source }) {
  const src = ensureObject(source);
  const normalized = await normalizeEmail({
    raw_text,
    from,
    subject,
    date,
    message_id,
    source: src,
  });
  const withQuality = applyQualityFields(normalized);
  const withIdempotency = applyIdempotencyFields(withQuality, {
    ...src,
    system: 'email',
    from_addr: src.from_addr || src.from || src.sender || from || null,
    subject: src.subject || subject || null,
    date: src.date || date || null,
    message_id: src.message_id || message_id || null,
    body: src.body || raw_text || null,
  });
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
}) {
  const normalized = await normalizeWebpage({
    text,
    extracted_text,
    clean_text,
    capture_text,
    content_type,
    url,
    url_canonical,
    excerpt,
  });

  const withQuality = applyQualityFields(normalized, {
    content_type,
    excerpt_override: excerpt ?? null,
  });
  return stripInternalFields(withQuality);
}

module.exports = {
  runTelegramIngestionPipeline,
  runEmailIngestionPipeline,
  runWebpageIngestionPipeline,
};
