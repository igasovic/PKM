'use strict';

const crypto = require('crypto');

const BIG_TEXT_FIELDS = new Set(['capture_text', 'extracted_text', 'clean_text']);
const DEFAULT_SUMMARY_MAX_BYTES = (() => {
  const raw = Number(process.env.PKM_LOG_SUMMARY_MAX_BYTES || 12 * 1024);
  return Number.isFinite(raw) && raw >= 2048 ? Math.trunc(raw) : 12 * 1024;
})();

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function typeOfValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function shouldIncludeTextSample(opts) {
  return !!(opts && opts.include_text_samples);
}

function summarizeString(value, key, opts) {
  const text = String(value || '');
  const out = {
    type: 'string',
    char_count: text.length,
  };
  if (text.length > 0) out.sha256 = sha256(text);

  const includeSample = shouldIncludeTextSample(opts);
  if (includeSample) {
    const max = Number((opts && opts.sample_max_chars) || 120);
    out.sample = text.slice(0, Math.max(20, max));
  }

  if (BIG_TEXT_FIELDS.has(String(key || ''))) {
    // Hard guard: never emit full heavy fields in summaries.
    delete out.sample;
  }
  return out;
}

function summarizeArray(arr, depth, opts) {
  const maxItems = Number((opts && opts.max_array_items) || 5);
  const out = {
    type: 'array',
    length: arr.length,
    item_types: Array.from(new Set(arr.slice(0, maxItems).map(typeOfValue))),
  };
  if (depth <= 0 || arr.length === 0) return out;
  out.sample = arr.slice(0, maxItems).map((item) => summarizeInner(item, depth - 1, null, opts));
  if (arr.length > maxItems) out.truncated = true;
  return out;
}

function summarizeObject(obj, depth, opts) {
  const keys = Object.keys(obj || {});
  const maxKeys = Number((opts && opts.max_object_keys) || 20);
  const out = {
    type: 'object',
    key_count: keys.length,
    keys: keys.slice(0, maxKeys),
  };
  if (keys.length > maxKeys) out.truncated = true;
  if (depth <= 0 || keys.length === 0) return out;

  const fields = {};
  for (const key of keys.slice(0, maxKeys)) {
    fields[key] = summarizeInner(obj[key], depth - 1, key, opts);
  }
  out.fields = fields;
  return out;
}

function summarizeInner(value, depth, key, opts) {
  const t = typeOfValue(value);
  if (t === 'string') return summarizeString(value, key, opts);
  if (t === 'number' || t === 'boolean' || t === 'undefined' || t === 'null') {
    return { type: t, value: value ?? null };
  }
  if (t === 'array') return summarizeArray(value, depth, opts);
  if (t === 'object') return summarizeObject(value, depth, opts);
  return { type: t };
}

function enforceSize(summary, maxBytes) {
  const hardCap = Number(maxBytes) || DEFAULT_SUMMARY_MAX_BYTES;
  let json = '';
  try {
    json = JSON.stringify(summary);
  } catch (_err) {
    return {
      type: 'summary_error',
      truncated: true,
      message: 'failed to stringify summary',
    };
  }
  if (Buffer.byteLength(json, 'utf8') <= hardCap) {
    return summary;
  }

  const compact = {
    type: summary && summary.type ? summary.type : 'object',
    truncated: true,
    key_count: summary && summary.key_count,
    keys: summary && summary.keys,
    note: 'summary exceeded size cap',
    approx_bytes: Buffer.byteLength(json, 'utf8'),
  };
  return compact;
}

function summarize(value, opts) {
  const options = opts || {};
  const depth = Number.isFinite(Number(options.max_depth)) ? Number(options.max_depth) : 2;
  const summary = summarizeInner(value, Math.max(0, depth), null, options);
  return enforceSize(summary, options.max_bytes);
}

module.exports = {
  summarize,
  sha256,
};
