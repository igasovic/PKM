'use strict';

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

  const noUrls = normWS(s.replace(/https?:\/\/[^\s<>()]+/gi, ''));
  const base = (noUrls.length >= 50) ? noUrls : s;

  if (base.length <= maxChars) return base;

  const cut = base.slice(0, maxChars + 1);
  let idx = cut.lastIndexOf(' ');
  if (idx < Math.floor(maxChars * 0.6)) idx = maxChars;
  return base.slice(0, idx).replace(/\s+$/g, '') + '…';
}

function lowSignalThresholdFor(content_type, lowSignalDefault) {
  if (content_type === 'note') return { min_words: 8, min_chars: 40 };
  return lowSignalDefault;
}

function clamp01Score(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function buildRetrieval({
  capture_text,
  content_type,
  extracted_text,
  url_canonical,
  url,
  config,
  excerpt_override,
  excerpt_source,
  quality_source_text,
}) {
  const cfg = config.qualityThresholds;
  const TH = {
    excerpt_max_chars: cfg.excerpt_max_chars,
    low_signal: {
      min_words: cfg.low_signal.min_words,
      min_chars: cfg.low_signal.min_chars,
    },
    boilerplate: {
      link_ratio_high: cfg.boilerplate.link_ratio_high,
      link_count_high: cfg.boilerplate.link_count_high,
    },
  };

  const qualityBase = (quality_source_text !== undefined && quality_source_text !== null)
    ? String(quality_source_text)
    : String(capture_text);
  const clean = normWS(qualityBase);
  const clean_word_count = clean ? clean.split(/\s+/).filter(Boolean).length : 0;
  const clean_char_count = clean.length;

  const extracted_char_count = String(extracted_text || '').length;

  const link_count = linkCountFromText(clean);
  const link_ratio = link_count / Math.max(1, clean_word_count);

  const lowTH = lowSignalThresholdFor(content_type, TH.low_signal);
  const low_signal = (clean_word_count < lowTH.min_words) || (clean_char_count < lowTH.min_chars);

  const boilerplate_heavy =
    (link_ratio > TH.boilerplate.link_ratio_high) ||
    (link_count >= TH.boilerplate.link_count_high);

  const signal =
    0.6 * Math.min(1, clean_word_count / 120) +
    0.4 * Math.min(1, clean_char_count / 1200);

  const penalty =
    (boilerplate_heavy ? 0.25 : 0) +
    (low_signal ? 0.35 : 0);

  const quality_score = clamp01Score(signal - penalty);

  const excerpt_text = excerpt_source || capture_text;
  const computed_excerpt = buildExcerpt(excerpt_text, TH.excerpt_max_chars);
  const excerpt = excerpt_override != null ? String(excerpt_override) : computed_excerpt;

  return {
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
}

module.exports = {
  buildRetrieval,
  normWS,
};
