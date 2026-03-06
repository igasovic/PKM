/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Telegram Capture (telegram-capture)
 * Node: Compute Retrieval Excerpt + Quality Signals (from capture_text)
 * Node ID: f9724210-2848-4b77-be35-30b5007bc3ef
 */
'use strict';

const { getConfig } = require('../../../src/libs/config.js');

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

// WP1 Step 1A: compute retrieval excerpt + quality signals from capture_text
// Output: $json.retrieval (object) + $json.metadata_patch ({ retrieval: ... })

const config = getConfig();

const cfg = config.qualityThresholds;
const TH = {
  excerpt_max_chars: cfg.excerpt_max_chars ?? 320,
  low_signal: {
    min_words: cfg.low_signal?.min_words ?? 35,
    min_chars: cfg.low_signal?.min_chars ?? 220,
  },
  boilerplate: {
    link_ratio_high: cfg.boilerplate?.link_ratio_high ?? 0.18,
    link_count_high: cfg.boilerplate?.link_count_high ?? 25,
  },
};

// Notes should NOT be penalized just because they're short.
function lowSignalThresholdFor(content_type) {
  if (content_type === 'note') return { min_words: 8, min_chars: 40 };
  return TH.low_signal;
}

function normWS(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function trimUrl(u) {
  let url = String(u || '');
  while (/[)\],.?!:;"'»]+$/.test(url)) url = url.replace(/[)\],.?!:;"'»]+$/, '');
  return url;
}

function linkCountFromText(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s<>()]+/gi) || [];
  return matches.map(trimUrl).filter(Boolean).length;
}

function buildExcerpt(raw, maxChars) {
  const s = normWS(raw);
  if (!s) return '';

  // Prefer removing URLs so excerpt isn't just a link
  const noUrls = normWS(s.replace(/https?:\/\/[^\s<>()]+/gi, ''));
  const base = (noUrls.length >= 50) ? noUrls : s;

  if (base.length <= maxChars) return base;

  const cut = base.slice(0, maxChars + 1);
  let idx = cut.lastIndexOf(' ');
  if (idx < Math.floor(maxChars * 0.6)) idx = maxChars;
  return base.slice(0, idx).replace(/\s+$/g, '') + '…';
}

function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

const content_type = $json.content_type || 'note';

const capture_text_raw = $json.capture_text ?? '';
const capture_text = String(capture_text_raw);
const clean = normWS(capture_text);

const clean_word_count = clean ? clean.split(/\s+/).filter(Boolean).length : 0;
const clean_char_count = clean.length;

const extracted_text = $json.extracted_text ?? '';
const extracted_char_count = String(extracted_text || '').length;

const link_count = linkCountFromText(capture_text);
const link_ratio = link_count / Math.max(1, clean_word_count);

const lowTH = lowSignalThresholdFor(content_type);
const low_signal = (clean_word_count < lowTH.min_words) || (clean_char_count < lowTH.min_chars);

const boilerplate_heavy =
  (link_ratio > TH.boilerplate.link_ratio_high) ||
  (link_count >= TH.boilerplate.link_count_high);

// Optional quality_score (0..1). Only for sorting/penalties later; not used as “relevance”.
const signal =
  0.6 * Math.min(1, clean_word_count / 120) +
  0.4 * Math.min(1, clean_char_count / 1200);

const penalty =
  (boilerplate_heavy ? 0.25 : 0) +
  (low_signal ? 0.35 : 0);

const quality_score = clamp01(signal - penalty);

const excerpt = buildExcerpt(capture_text, TH.excerpt_max_chars);

const retrieval = {
  version: 'v1',
  excerpt,
  quality: {
    clean_word_count,
    clean_char_count,
    extracted_char_count,
    link_count,
    link_ratio,
    boilerplate_heavy,
    low_signal,
    quality_score,
  },
};

return [{
  json: {
    ...$json,
    retrieval,
    metadata_patch: { retrieval },
  }
}];
};
