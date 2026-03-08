'use strict';

const {
  DISTILL_STANCES,
  DISTILL_VALIDATION_ERROR_CODES,
  DISTILL_EXCERPT_PLACEHOLDERS,
} = require('./constants.js');

function extractJsonObjectText(text) {
  let value = String(text || '').trim();
  if (!value) throw new Error('model output is empty');
  value = value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const first = value.indexOf('{');
  const last = value.lastIndexOf('}');
  if (first >= 0 && last > first) {
    value = value.slice(first, last + 1);
  }
  return value;
}

function parseModelJson(text, label) {
  const payload = extractJsonObjectText(text);
  try {
    return JSON.parse(payload);
  } catch (_err) {
    const preview = payload.slice(0, 250);
    throw new Error(`${label} returned invalid JSON. Preview: ${preview}`);
  }
}

function normalizeTextForMatch(value) {
  return String(value || '')
    .replace(/[\u2018\u2019]/g, '\'')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/[ \t]*([,.;:!?])/g, '$1')
    .trim()
    .toLowerCase();
}

function isExcerptGrounded(excerpt, cleanText) {
  const needle = normalizeTextForMatch(excerpt);
  const haystack = normalizeTextForMatch(cleanText);
  if (!needle) return false;
  if (!haystack) return false;
  return haystack.includes(needle);
}

function ensureMetadataShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function parseTier2FinalOutput(text) {
  return parseModelJson(text, 'Tier-2 generation');
}

function parseTier2ChunkNoteOutput(text) {
  return parseModelJson(text, 'Tier-2 chunk note');
}

function buildTier2Artifact(raw, opts) {
  const options = opts || {};
  const model = String(options.model || '').trim();
  const requestType = String(options.request_type || '').trim();
  const chunkingStrategy = String(options.chunking_strategy || '').trim() || 'direct';
  const contentHash = String(options.content_hash || '').trim();
  const distillVersion = String(options.distill_version || 'distill_v1').trim() || 'distill_v1';
  const retryCount = Number.isFinite(Number(options.retry_count)) ? Number(options.retry_count) : 0;

  const excerptRaw = raw && raw.distill_excerpt;
  const excerpt = excerptRaw === null || excerptRaw === undefined
    ? null
    : String(excerptRaw).trim();

  return {
    distill_summary: raw && raw.distill_summary,
    distill_excerpt: excerpt === '' ? null : excerpt,
    distill_why_it_matters: raw && raw.distill_why_it_matters,
    distill_stance: raw && raw.distill_stance,
    distill_version: distillVersion,
    distill_created_from_hash: contentHash,
    distill_metadata: {
      created_at: new Date().toISOString(),
      model: model || null,
      request_type: requestType || null,
      error: null,
      chunking_strategy: chunkingStrategy,
      retry_count: retryCount,
    },
  };
}

function fail(errorCode, details) {
  return {
    accepted: false,
    error_code: errorCode,
    error_details: details || null,
  };
}

function validateTier2Artifact(input) {
  const payload = input && input.artifact ? input.artifact : {};
  const cleanText = String((input && input.clean_text) || '');
  const currentContentHash = String((input && input.content_hash) || '').trim();

  if (payload.distill_summary === undefined) {
    return fail(DISTILL_VALIDATION_ERROR_CODES.MISSING_SUMMARY);
  }
  if (typeof payload.distill_summary !== 'string') {
    return fail(DISTILL_VALIDATION_ERROR_CODES.SUMMARY_NOT_STRING);
  }
  if (!payload.distill_summary.trim()) {
    return fail(DISTILL_VALIDATION_ERROR_CODES.SUMMARY_EMPTY);
  }

  if (payload.distill_excerpt !== null && payload.distill_excerpt !== undefined) {
    if (typeof payload.distill_excerpt !== 'string') {
      return fail(DISTILL_VALIDATION_ERROR_CODES.EXCERPT_NOT_STRING);
    }
    if (!payload.distill_excerpt.trim()) {
      return fail(DISTILL_VALIDATION_ERROR_CODES.EXCERPT_EMPTY);
    }
    if (DISTILL_EXCERPT_PLACEHOLDERS.has(payload.distill_excerpt.trim().toLowerCase())) {
      return fail(DISTILL_VALIDATION_ERROR_CODES.EXCERPT_PLACEHOLDER_VALUE);
    }
    if (!isExcerptGrounded(payload.distill_excerpt, cleanText)) {
      return fail(DISTILL_VALIDATION_ERROR_CODES.EXCERPT_NOT_GROUNDED);
    }
  }

  if (payload.distill_why_it_matters === undefined) {
    return fail(DISTILL_VALIDATION_ERROR_CODES.MISSING_WHY_IT_MATTERS);
  }
  if (typeof payload.distill_why_it_matters !== 'string') {
    return fail(DISTILL_VALIDATION_ERROR_CODES.WHY_IT_MATTERS_NOT_STRING);
  }
  if (!payload.distill_why_it_matters.trim()) {
    return fail(DISTILL_VALIDATION_ERROR_CODES.WHY_IT_MATTERS_EMPTY);
  }

  if (payload.distill_stance === undefined) {
    return fail(DISTILL_VALIDATION_ERROR_CODES.MISSING_STANCE);
  }
  if (!DISTILL_STANCES.has(String(payload.distill_stance || '').trim())) {
    return fail(DISTILL_VALIDATION_ERROR_CODES.INVALID_STANCE);
  }

  if (payload.distill_version === undefined) {
    return fail(DISTILL_VALIDATION_ERROR_CODES.MISSING_VERSION);
  }
  if (typeof payload.distill_version !== 'string') {
    return fail(DISTILL_VALIDATION_ERROR_CODES.VERSION_NOT_STRING);
  }
  if (!payload.distill_version.trim()) {
    return fail(DISTILL_VALIDATION_ERROR_CODES.VERSION_EMPTY);
  }

  if (payload.distill_created_from_hash === undefined) {
    return fail(DISTILL_VALIDATION_ERROR_CODES.MISSING_CREATED_FROM_HASH);
  }
  if (typeof payload.distill_created_from_hash !== 'string') {
    return fail(DISTILL_VALIDATION_ERROR_CODES.CREATED_FROM_HASH_NOT_STRING);
  }
  if (payload.distill_created_from_hash.trim() !== currentContentHash) {
    return fail(DISTILL_VALIDATION_ERROR_CODES.CREATED_FROM_HASH_MISMATCH);
  }

  if (payload.distill_metadata === undefined) {
    return fail(DISTILL_VALIDATION_ERROR_CODES.MISSING_METADATA);
  }
  const metadata = ensureMetadataShape(payload.distill_metadata);
  if (!metadata) {
    return fail(DISTILL_VALIDATION_ERROR_CODES.METADATA_NOT_OBJECT);
  }
  if (!String(metadata.created_at || '').trim()) {
    return fail(DISTILL_VALIDATION_ERROR_CODES.METADATA_MISSING_CREATED_AT);
  }
  if (!String(metadata.model || '').trim()) {
    return fail(DISTILL_VALIDATION_ERROR_CODES.METADATA_MISSING_MODEL);
  }
  if (!String(metadata.chunking_strategy || '').trim()) {
    return fail(DISTILL_VALIDATION_ERROR_CODES.METADATA_MISSING_CHUNKING_STRATEGY);
  }

  const summaryNorm = normalizeTextForMatch(payload.distill_summary);
  const whyNorm = normalizeTextForMatch(payload.distill_why_it_matters);
  if (summaryNorm && summaryNorm === whyNorm) {
    return fail(DISTILL_VALIDATION_ERROR_CODES.SUMMARY_WHY_IT_MATTERS_DUPLICATE);
  }

  return {
    accepted: true,
    error_code: null,
    error_details: null,
  };
}

module.exports = {
  parseTier2FinalOutput,
  parseTier2ChunkNoteOutput,
  buildTier2Artifact,
  validateTier2Artifact,
};
