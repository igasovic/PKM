/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: E-Mail Capture (e-mail-capture)
 * Node: Compute Retrieval Excerpt + Quality (email clean_text)
 * Node ID: 2b306dd2-9dfb-4d42-9302-0258fd2d5ce0
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

// Email WP1: compute retrieval excerpt + quality signals.
// HARD RULE: clean_text must be non-empty, else fail.
// Output: $json.retrieval + $json.metadata_patch

const cfg = $json.config?.qualityThresholds || {};
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
  extraction_incomplete: {
    min_extracted_chars_to_consider: cfg.extraction_incomplete?.min_extracted_chars_to_consider ?? 800,
    clean_vs_extracted_ratio_low: cfg.extraction_incomplete?.clean_vs_extracted_ratio_low ?? 0.25,
  },
};

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

function getDomain(rawUrl) {
  const u = String(rawUrl || '').trim();
  const m = u.match(/^https?:\/\/([^\/?#]+)/i);
  if (!m) return null;
  let host = m[1].toLowerCase();
  host = host.replace(/:\d+$/, '');
  host = host.replace(/^www\./, '');
  return host || null;
}

function buildExcerpt(raw, maxChars) {
  const s = normWS(raw);
  if (!s) return '';
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

// HARD RULE: must have clean_text
const clean_text = String($json.clean_text ?? '');
const base_text = normWS(clean_text);

if (!base_text) {
  throw new Error('Fail-fast: clean_text is empty after trim (do not enrich)');
}

const clean_word_count = base_text.split(/\s+/).filter(Boolean).length;
const clean_char_count = base_text.length;

const extracted_text = String($json.extracted_text ?? ''); // usually empty in email flow
const extracted_char_count = extracted_text.length;

const link_count = linkCountFromText(base_text);
const link_ratio = link_count / Math.max(1, clean_word_count);

const low_signal =
  (clean_word_count < TH.low_signal.min_words) ||
  (clean_char_count < TH.low_signal.min_chars);

const boilerplate_heavy =
  (link_ratio > TH.boilerplate.link_ratio_high) ||
  (link_count >= TH.boilerplate.link_count_high);

const extraction_incomplete =
  (extracted_char_count >= TH.extraction_incomplete.min_extracted_chars_to_consider) &&
  (clean_char_count / Math.max(1, extracted_char_count) < TH.extraction_incomplete.clean_vs_extracted_ratio_low);

const signal =
  0.6 * Math.min(1, clean_word_count / 120) +
  0.4 * Math.min(1, clean_char_count / 1200);

const penalty =
  (boilerplate_heavy ? 0.25 : 0) +
  (low_signal ? 0.35 : 0) +
  (extraction_incomplete ? 0.15 : 0);

const quality_score = clamp01(signal - penalty);

const source_domain = getDomain($json.url_canonical || $json.url || null);
const excerpt = buildExcerpt(base_text, TH.excerpt_max_chars);

const retrieval = {
  version: 'v1',
  excerpt,
  source_domain,
  quality: {
    clean_word_count,
    clean_char_count,
    extracted_char_count,
    link_count,
    link_ratio,
    boilerplate_heavy,
    low_signal,
    extraction_incomplete,
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
