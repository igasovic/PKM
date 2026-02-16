'use strict';

const { buildSampledPrompt, buildWholePrompt } = require('../../libs/prompt-builder.js');
const { extractResponseText } = require('../litellm-client.js');
const { CLEAN_TEXT_SAMPLE_LIMIT } = require('./constants.js');

function parseTier1Json(text) {
  let s = String(text || '').trim();
  if (!s) throw new Error('Tier-1 parse: model output text is empty');

  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }

  let t1;
  try {
    t1 = JSON.parse(s);
  } catch (_err) {
    const preview = s.slice(0, 250);
    throw new Error(`Tier-1 parse: invalid JSON. Preview: ${preview}`);
  }

  const reqStr = (k) => typeof t1[k] === 'string' && t1[k].trim().length > 0;
  if (!reqStr('topic_primary')) throw new Error('Tier-1 parse: missing topic_primary');
  if (!reqStr('topic_secondary')) throw new Error('Tier-1 parse: missing topic_secondary');
  if (!reqStr('gist')) throw new Error('Tier-1 parse: missing gist');
  if (!Array.isArray(t1.keywords)) throw new Error('Tier-1 parse: keywords must be an array');

  t1.topic_primary = t1.topic_primary.trim();
  t1.topic_secondary = t1.topic_secondary.trim();
  t1.gist = t1.gist.trim();

  t1.keywords = t1.keywords
    .map((x) => String(x ?? '').trim())
    .filter(Boolean);
  t1.keywords = Array.from(new Set(t1.keywords));

  if (t1.keywords.length < 5) throw new Error('Tier-1 parse: keywords must have at least 5 items');
  if (t1.keywords.length > 12) t1.keywords = t1.keywords.slice(0, 12);

  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  if (typeof t1.topic_primary_confidence === 'number') {
    t1.topic_primary_confidence = clamp01(t1.topic_primary_confidence);
  }
  if (typeof t1.topic_secondary_confidence === 'number') {
    t1.topic_secondary_confidence = clamp01(t1.topic_secondary_confidence);
  }

  return t1;
}

function buildTier1Prompt(input) {
  const text = String(input.clean_text || '');
  if (text.length > CLEAN_TEXT_SAMPLE_LIMIT) {
    return buildSampledPrompt(input);
  }
  return buildWholePrompt(input);
}

function toTier1Response(t1, quality) {
  const q = quality || {};
  return {
    topic_primary: t1.topic_primary,
    topic_primary_confidence: t1.topic_primary_confidence ?? null,
    topic_secondary: t1.topic_secondary,
    topic_secondary_confidence: t1.topic_secondary_confidence ?? null,
    keywords: t1.keywords,
    gist: t1.gist,
    flags: {
      boilerplate_heavy: !!q.boilerplate_heavy,
      low_signal: !!q.low_signal,
    },
    quality_score: q.quality_score ?? null,
    clean_word_count: q.clean_word_count ?? null,
    clean_char_count: q.clean_char_count ?? null,
    link_count: q.link_count ?? null,
    link_ratio: q.link_ratio ?? null,
    retrieval_excerpt: q.retrieval_excerpt ?? null,
  };
}

function buildBatchRequests(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) throw new Error('enrich/t1 batch requires non-empty items');

  return list.map((item, idx) => {
    const clean_text = item && item.clean_text;
    if (!String(clean_text || '').trim()) {
      throw new Error(`enrich/t1 batch item ${idx} missing clean_text`);
    }
    const promptBuilt = buildTier1Prompt({
      title: item.title ?? null,
      author: item.author ?? null,
      content_type: item.content_type ?? 'other',
      clean_text,
    });
    return {
      custom_id: String(item.custom_id || item.id || `item_${Date.now()}_${idx}`),
      prompt: promptBuilt.prompt,
      prompt_mode: promptBuilt.prompt_mode,
      title: item.title ?? null,
      author: item.author ?? null,
      content_type: item.content_type ?? 'other',
    };
  });
}

function parseJsonl(text) {
  const rows = [];
  const lines = String(text || '').split('\n').map((x) => x.trim()).filter(Boolean);
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch (_err) {
      rows.push({ parse_error: true, raw_line: line });
    }
  }
  return rows;
}

function mapBatchLineToResult(row) {
  const custom_id = String(row && row.custom_id ? row.custom_id : '');
  if (!custom_id) return null;

  const responseBody = row && row.response && row.response.body;
  const statusCode = row && row.response && row.response.status_code;
  const isHttpOk = Number(statusCode) >= 200 && Number(statusCode) < 300;
  const hasModelResponse = !!responseBody;

  if (isHttpOk && hasModelResponse) {
    const text = extractResponseText(responseBody);
    try {
      const parsed = parseTier1Json(text);
      return {
        custom_id,
        status: 'ok',
        response_text: text,
        parsed,
        error: null,
        raw: row,
      };
    } catch (err) {
      return {
        custom_id,
        status: 'parse_error',
        response_text: text || null,
        parsed: null,
        error: { message: err.message },
        raw: row,
      };
    }
  }

  return {
    custom_id,
    status: 'error',
    response_text: null,
    parsed: null,
    error: row && (row.error || row.response || { message: 'batch item failed' }),
    raw: row,
  };
}

function mergeResultRows(rows) {
  const byId = new Map();
  for (const row of rows) {
    if (!row || !row.custom_id) continue;
    const existing = byId.get(row.custom_id);
    if (!existing) {
      byId.set(row.custom_id, row);
      continue;
    }
    if (existing.status !== 'ok' && row.status === 'ok') {
      byId.set(row.custom_id, row);
    }
  }
  return Array.from(byId.values());
}

module.exports = {
  parseTier1Json,
  buildTier1Prompt,
  toTier1Response,
  buildBatchRequests,
  parseJsonl,
  mapBatchLineToResult,
  mergeResultRows,
};
