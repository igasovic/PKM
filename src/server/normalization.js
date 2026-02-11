'use strict';

const { getConfig } = require('./config.js');
const { buildRetrieval } = require('./quality.js');

function maybeUnescapeTelegramText(s) {
  const t = String(s ?? '');

  const hasEscNewlines = t.includes('\\n');
  const hasEscQuotes = t.includes('\\"');
  const hasRealNewline = t.includes('\n');

  if ((hasEscNewlines || hasEscQuotes) && !hasRealNewline) {
    return t
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return t;
}

function tryParseJsonString(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function extractJsonObjectAndRemainder(text) {
  const hay = String(text || '');
  const MAX_SCAN_CHARS = 20000;
  const MAX_CANDIDATES = 40;
  const scan = hay.slice(0, MAX_SCAN_CHARS);

  const requiredKeysPresent = (obj) =>
    obj && typeof obj === 'object' &&
    typeof obj.title === 'string' && obj.title.trim().length > 0 &&
    typeof obj.topic === 'string' && obj.topic.trim().length > 0;

  let tried = 0;
  let startIdx = scan.indexOf('{');

  while (startIdx !== -1 && tried < MAX_CANDIDATES) {
    tried++;

    const slice = scan.slice(startIdx);
    let depth = 0;
    let inStr = false;
    let esc = false;

    for (let i = 0; i < slice.length; i++) {
      const ch = slice[i];

      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      } else {
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') depth++;
        if (ch === '}') depth--;

        if (depth === 0) {
          const jsonStr = slice.slice(0, i + 1).trim();
          const obj = tryParseJsonString(jsonStr);

          if (obj && requiredKeysPresent(obj)) {
            let after = hay.slice(startIdx + i + 1);
            after = after.replace(/^\s+/, '');
            return { obj, jsonStr, after };
          }
          break;
        }
      }
    }

    startIdx = scan.indexOf('{', startIdx + 1);
  }

  return null;
}

function normTopic(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  return t.length ? t : null;
}

function clamp01(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function canonicalizeUrl(raw) {
  if (!raw) return null;

  let s = String(raw).trim();
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');

  const hashIdx = s.indexOf('#');
  if (hashIdx !== -1) s = s.slice(0, hashIdx);

  const qIdx = s.indexOf('?');
  let base = qIdx === -1 ? s : s.slice(0, qIdx);
  let query = qIdx === -1 ? '' : s.slice(qIdx + 1);

  base = base.replace(/^https?:\/\//i, (m) => m.toLowerCase());
  base = base.replace(
    /^https?:\/\/([^\/]+)/i,
    (m, host) => m.replace(host, host.toLowerCase())
  );

  base = base.replace(/^(https?:\/\/[^\/]+)\/+$/, '$1');
  base = base.replace(/(.+?)\/+$/, '$1');

  if (!query) return base;

  const parts = query.split('&').filter(Boolean);
  const kept = [];

  for (const part of parts) {
    const eq = part.indexOf('=');
    const k = eq === -1 ? part : part.slice(0, eq);

    let key;
    try { key = decodeURIComponent(k).toLowerCase(); }
    catch { key = k.toLowerCase(); }

    const drop =
      key.startsWith('utm_') ||
      key === 'fbclid' ||
      key === 'gclid' ||
      key === 'dclid' ||
      key === 'msclkid' ||
      key === 'igshid' ||
      key === 'mc_cid' ||
      key === 'mc_eid' ||
      key === 'mkt_tok' ||
      key === 'oly_anon_id' ||
      key === 'oly_enc_id';

    if (!drop) kept.push(part);
  }

  return kept.length ? `${base}?${kept.join('&')}` : base;
}

function formatForInsert({
  source,
  intent,
  content_type,
  title,
  author,
  capture_text,
  clean_text,
  url,
  url_canonical,
  topic_primary,
  topic_primary_confidence,
  topic_secondary,
  topic_secondary_confidence,
  gist,
  retrieval,
}) {
  const quality = retrieval.quality;
  return {
    source,
    intent,
    content_type,
    title,
    author,
    capture_text,
    clean_text,
    url,
    url_canonical,
    topic_primary,
    topic_primary_confidence,
    topic_secondary,
    topic_secondary_confidence,
    gist,
    retrieval_excerpt: retrieval.excerpt,
    retrieval_version: retrieval.version,
    source_domain: retrieval.source_domain,
    clean_word_count: quality.clean_word_count,
    clean_char_count: quality.clean_char_count,
    extracted_char_count: quality.extracted_char_count,
    link_count: quality.link_count,
    link_ratio: quality.link_ratio,
    boilerplate_heavy: quality.boilerplate_heavy,
    low_signal: quality.low_signal,
    extraction_incomplete: quality.extraction_incomplete,
    quality_score: quality.quality_score,
    metadata: { retrieval },
  };
}

async function normalizeTelegram({ text }) {
  if (text === undefined || text === null) {
    throw new Error('text is required');
  }

  const config = await getConfig();
  if (!config || !config.qualityThresholds) {
    throw new Error('config missing qualityThresholds');
  }

  let capture_text = String(text || '');
  capture_text = maybeUnescapeTelegramText(capture_text);

  const parsed = extractJsonObjectAndRemainder(capture_text);

  if (parsed && parsed.obj) {
    const j = parsed.obj;
    const title = (j.title ?? null);
    const topic_primary = normTopic(j.topic);
    const topic_secondary = normTopic(j.secondary_topic);
    const topic_secondary_confidence = clamp01(j.secondary_topic_confidence);
    const gist = (j.gist ?? null);
    const explicit_excerpt = (j.excerpt ?? null);

    const clean_text = String(parsed.after ?? '');

    const retrieval = buildRetrieval({
      capture_text,
      content_type: 'note',
      extracted_text: '',
      url_canonical: null,
      url: null,
      config,
      excerpt_override: explicit_excerpt,
      excerpt_source: clean_text || capture_text,
    });

    return formatForInsert({
      source: 'telegram',
      intent: 'think',
      content_type: 'note',
      title,
      author: null,
      capture_text,
      clean_text,
      url: null,
      url_canonical: null,
      topic_primary,
      topic_primary_confidence: 1,
      topic_secondary,
      topic_secondary_confidence,
      gist,
      retrieval,
    });
  }

  const match = capture_text.match(/https?:\/\/[^\s<>()]+/i);
  let url = match ? match[0] : null;
  if (url) {
    while (/[)\],.?!:;"'»]+$/.test(url)) {
      url = url.replace(/[)\],.?!:;"'»]+$/, '');
    }
  }

  const url_canonical = canonicalizeUrl(url);
  const content_type = url ? 'newsletter' : 'note';
  const intent = content_type === 'newsletter' ? 'archive' : 'think';

  const retrieval = buildRetrieval({
    capture_text,
    content_type,
    extracted_text: '',
    url_canonical,
    url,
    config,
    excerpt_override: null,
    excerpt_source: capture_text,
  });

  return formatForInsert({
    source: 'telegram',
    intent,
    content_type,
    title: null,
    author: null,
    capture_text,
    clean_text: null,
    url,
    url_canonical,
    topic_primary: null,
    topic_primary_confidence: null,
    topic_secondary: null,
    topic_secondary_confidence: null,
    gist: null,
    retrieval,
  });
}

module.exports = {
  normalizeTelegram,
};
