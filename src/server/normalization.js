'use strict';

const { getConfig } = require('../libs/config.js');
const { buildRetrievalForDb } = require('./quality.js');
const {
  buildIdempotencyForNormalized,
  attachIdempotencyFields,
} = require('./idempotency.js');

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
  retrieval_fields,
}) {
  // Shared URL normalization fallback:
  // if caller didn't provide canonical URL but did provide URL, derive it
  // using the same canonicalizer used in Telegram normalization.
  const resolved_url = url || null;
  const resolved_url_canonical = (url_canonical && String(url_canonical).trim())
    ? String(url_canonical).trim()
    : canonicalizeUrl(resolved_url);

  const out = {
    source,
    intent,
    content_type,
    title,
    author,
    capture_text,
    clean_text,
    url: resolved_url,
    url_canonical: resolved_url_canonical,
    ...retrieval_fields,
  };
  return out;
}

function cleanWebpageExtractedText(s) {
  if (!s) return '';

  let t = String(s);

  // Remove zero-width transport artifacts + BOM before downstream scoring.
  t = t.replace(/[\u200B-\u200D\uFEFF]/g, '');
  t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  t = t.replace(/\u00A0/g, ' ');

  // Keep paragraph boundaries, but collapse repeated blank lines.
  const lines = t.split('\n').map((line) => line.trim());
  const out = [];
  let prevBlank = false;
  for (const line of lines) {
    const blank = line.length === 0;
    if (blank) {
      if (!prevBlank) out.push('');
      prevBlank = true;
    } else {
      out.push(line);
      prevBlank = false;
    }
  }

  t = out.join('\n').trim();
  t = t.replace(/[ \t]+/g, ' ');
  return t;
}

async function normalizeTelegram({ text, source }) {
  const src = source && typeof source === 'object' ? source : null;
  const inputText = text !== undefined && text !== null
    ? text
    : (src ? (src.text || src.body || '') : '');
  if (inputText === undefined || inputText === null || String(inputText).trim() === '') {
    throw new Error('text is required');
  }
  // system is inferred by /normalize/telegram API handler.
  const sourceForIdem = { ...(src || {}), system: 'telegram' };

  const config = getConfig();

  let capture_text = String(inputText || '');
  capture_text = maybeUnescapeTelegramText(capture_text);

  const parsed = extractJsonObjectAndRemainder(capture_text);

  if (parsed && parsed.obj) {
    const j = parsed.obj;
    const title = (j.title ?? null);
    const explicit_excerpt = (j.excerpt ?? null);

    const clean_text = String(parsed.after ?? '');

    const retrieval_fields = buildRetrievalForDb({
      capture_text,
      content_type: 'note',
      extracted_text: '',
      url_canonical: null,
      url: null,
      config,
      excerpt_override: explicit_excerpt,
      excerpt_source: clean_text || capture_text,
    });

    const normalized = formatForInsert({
      source: 'telegram',
      intent: 'think',
      content_type: 'note',
      title,
      author: null,
      capture_text,
      clean_text,
      url: null,
      url_canonical: null,
      retrieval_fields,
    });
    const idem = buildIdempotencyForNormalized({
      source: sourceForIdem,
      normalized,
    });
    if (!idem) {
      throw new Error('unable to compute idempotency keys for telegram payload');
    }
    return attachIdempotencyFields(normalized, idem);
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

  const retrieval_fields = buildRetrievalForDb({
    capture_text,
    content_type,
    extracted_text: '',
    url_canonical,
    url,
    config,
    excerpt_override: null,
    excerpt_source: capture_text,
  });

  const normalized = formatForInsert({
    source: 'telegram',
    intent,
    content_type,
    title: null,
    author: null,
    capture_text,
    clean_text: null,
    url,
    url_canonical,
    retrieval_fields,
  });
  const idem = buildIdempotencyForNormalized({
    source: sourceForIdem,
    normalized,
  });
  if (!idem) {
    throw new Error('unable to compute idempotency keys for telegram payload');
  }
  return attachIdempotencyFields(normalized, idem);
}

function normalizeNewlines(s) {
  return String(s || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function normalizeQuotedPrintableSoftBreaks(s) {
  const text = normalizeNewlines(String(s || ''));
  const softBreakCount = (text.match(/=\n/g) || []).length;
  // Conservative: only repair when this looks like quoted-printable transport.
  if (softBreakCount < 2) return text;
  return text.replace(/=\n/g, '');
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function makeCfRegex() {
  try {
    return new RegExp('\\p{Cf}+', 'gu');
  } catch {
    return /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\u034F]/g;
  }
}

const RE_CF = makeCfRegex();
const RE_UNI_SPACE = /[\u00A0\u1680\u2000-\u200A\u2007\u202F\u205F\u3000]/g;

function stripInvisibleTransport(s) {
  return String(s || '')
    .replace(/\u0000/g, '')
    .replace(RE_UNI_SPACE, ' ')
    .replace(RE_CF, '')
    .replace(/\u00A0/g, ' ');
}

function collapseWhitespacePreserveNewlines(s) {
  const text = normalizeNewlines(s);
  const lines = text.split('\n');
  const out = [];
  let blankRun = 0;

  for (let line of lines) {
    line = String(line || '').replace(/[ \t]+/g, ' ').trim();
    if (!line) {
      blankRun += 1;
      if (blankRun <= 2) out.push('');
      continue;
    }
    blankRun = 0;
    out.push(line);
  }

  return out.join('\n').trim();
}

const MOJI_SIGNAL = /(?:â[\u0080-\u00BF]|Ã[\u0080-\u00BF]|Â[\u0080-\u00BF]|â€”|â€“|â€™|â€œ|â€\x9d|â€¢|â€¦|Â )/;

function mojiScore(s) {
  const str = String(s || '');
  if (!str) return 0;
  const m = str.match(new RegExp(MOJI_SIGNAL.source, 'g'));
  const scoreSignals = m ? m.length : 0;
  const scoreRepl = (str.match(/\uFFFD/g) || []).length;
  return scoreSignals + scoreRepl;
}

function fixMojibakeGuarded(s) {
  const str = String(s || '');
  if (!str) return { text: str, fixed: false, method: 'none' };

  if (!MOJI_SIGNAL.test(str) && str.indexOf('\uFFFD') === -1) {
    return { text: str, fixed: false, method: 'none' };
  }

  try {
    const bytes = Uint8Array.from(str, (c) => c.charCodeAt(0) & 0xff);
    let out = null;
    if (typeof TextDecoder !== 'undefined') {
      out = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } else if (typeof Buffer !== 'undefined') {
      out = Buffer.from(bytes).toString('utf8');
    }
    if (out && out !== str && mojiScore(out) <= mojiScore(str)) {
      return { text: out, fixed: true, method: 'latin1->utf8' };
    }
  } catch (_) {}

  const out2 = str
    .replace(/â€™/g, '’')
    .replace(/â€œ/g, '“')
    .replace(/â€\x9d/g, '”')
    .replace(/â€“/g, '–')
    .replace(/â€”/g, '—')
    .replace(/â€¦/g, '…')
    .replace(/â€¢/g, '•')
    .replace(/Â /g, ' ')
    .replace(/Â/g, '');

  return { text: out2, fixed: out2 !== str, method: out2 !== str ? 'replace' : 'none' };
}

function dropTransportArtifactLines(text) {
  const lines = normalizeNewlines(text).split('\n');
  const out = [];
  for (const line of lines) {
    const t = String(line || '').trim();
    if (/^<#m_-?\d+_>\s*$/i.test(t)) continue;
    out.push(line);
  }
  return out.join('\n');
}

function sanitizeHeaderText(s) {
  let t = String(s || '').trim();
  if (!t) return null;
  t = decodeEntities(t);
  t = fixMojibakeGuarded(t).text;
  t = stripInvisibleTransport(t);
  t = t.replace(/\s+/g, ' ').trim();
  return t || null;
}

function looksDecorativeDividerLine(line) {
  const s = String(line || '').trim();
  if (!s) return false;
  if (/^[-_=*•·]{6,}$/.test(s)) return true;
  let alphaNum = 0;
  let uniq = new Set();
  for (let i = 0; i < s.length && i < 300; i++) {
    const c = s[i];
    uniq.add(c);
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) alphaNum++;
  }
  if (s.length >= 24 && alphaNum === 0 && uniq.size <= 8) return true;
  try {
    const letters = (s.match(/\p{L}/gu) || []).length;
    if (s.length >= 24 && letters === 0 && uniq.size <= 10) return true;
  } catch {}
  return false;
}

function collapseDecorativeDividerRuns(text) {
  const lines = normalizeNewlines(text).split('\n');
  const out = [];
  let lastWasDivider = false;
  for (const line of lines) {
    const isDiv = looksDecorativeDividerLine(line);
    if (isDiv) {
      if (!lastWasDivider) out.push('---');
      lastWasDivider = true;
      continue;
    }
    lastWasDivider = false;
    out.push(line);
  }
  return out.join('\n');
}

function splitIntoBlocks(text) {
  const lines = normalizeNewlines(text).split('\n');
  const blocks = [];
  let cur = [];
  for (const line of lines) {
    if (String(line || '').trim() === '') {
      if (cur.length) {
        blocks.push(cur);
        cur = [];
      }
      continue;
    }
    cur.push(line);
  }
  if (cur.length) blocks.push(cur);
  return blocks;
}

const TEASER_HEADER_RE = /(view (in (your )?)?browser|view online|read online|open in browser|trouble viewing|having trouble viewing|web version)/i;

function stripTeaserNoiseLines(blockText) {
  const lines = normalizeNewlines(blockText).split('\n');
  const kept = [];
  for (const line of lines) {
    const t = String(line || '').trim();
    if (!t) continue;
    if (TEASER_HEADER_RE.test(t)) continue;
    if (/^(https?:\/\/\S+|www\.\S+)\s*$/i.test(t)) continue;
    kept.push(line);
  }
  return kept.join('\n').trim();
}

function normalizeForDup(s) {
  let t = String(s || '');
  t = t.replace(/https?:\/\/[^\s<>()]+/gi, ' ');
  t = t.replace(/www\.[^\s<>()]+/gi, ' ');
  t = t.toLowerCase();
  t = t.replace(/[\u2010-\u2015]/g, '-');
  t = t.replace(/[^a-z0-9\s-]+/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function maybeDropTeaser(text) {
  const blocks = splitIntoBlocks(text);
  if (blocks.length < 2) {
    return { text, dropped: false };
  }

  const joinedBlocks = blocks.map((b) => b.join('\n').trim());
  const maxDrop = Math.min(3, joinedBlocks.length - 1);

  for (let n = 1; n <= maxDrop; n++) {
    const before = joinedBlocks.slice(0, n).join('\n\n').trim();
    const after = joinedBlocks.slice(n).join('\n\n').trim();
    if (!before || !after) continue;

    const beforeLen = before.length;
    const afterLen = after.length;

    if (!(afterLen >= beforeLen * 1.8 && afterLen >= 900)) continue;

    const beforeLastLine = String(joinedBlocks[n - 1].split('\n').slice(-1)[0] || '').trim();
    const hasSeparator =
      looksDecorativeDividerLine(beforeLastLine) ||
      TEASER_HEADER_RE.test(before) ||
      /\.\.\.\s*$/.test(before) ||
      /…\s*$/.test(before);

    if (!hasSeparator) continue;

    const beforeCore = stripTeaserNoiseLines(before);
    const beforeCoreNorm = normalizeForDup(beforeCore);
    const afterNorm = normalizeForDup(after);
    const teaserish = /\.\.\.\s*$/.test(beforeCore) || /…\s*$/.test(beforeCore);

    if (beforeCoreNorm.length < 120 && !teaserish) continue;

    const needle = beforeCoreNorm.slice(0, 600);
    const dup = needle && afterNorm.includes(needle);

    if (!dup && !teaserish) continue;

    return { text: after.trim(), dropped: true };
  }

  return { text, dropped: false };
}

const URL_RE = /(https?:\/\/[^\s)<>]+|www\.[^\s)<>]+)/ig;

function countAlpha(s) {
  try {
    const m = String(s || '').match(/\p{L}/gu);
    return m ? m.length : 0;
  } catch {
    const m = String(s || '').match(/[A-Za-z]/g);
    return m ? m.length : 0;
  }
}

function lineFeatures(line) {
  const raw = String(line || '');
  const l = raw.trim();
  const lower = l.toLowerCase();
  const urls = l.match(URL_RE) || [];
  const urlCount = urls.length;
  const urlChars = urls.reduce((a, u) => a + u.length, 0);
  const alpha = countAlpha(l);
  const total = Math.max(1, l.length);
  const alphaRatio = alpha / total;
  const linkDensity = urlChars / total;
  const noUrls = l.replace(URL_RE, '').replace(/[\s\W_]+/g, '');
  const isUrlOnly = noUrls.length === 0 && urlCount > 0;
  const strongHit = ['unsubscribe', 'manage preferences', 'update preferences', 'email preferences', 'you are receiving', 'this email was sent', 'view in browser', 'feedblitz', 'substack', 'mailchimp', 'beehiiv', 'convertkit', 'campaign monitor', 'constant contact', 'klaviyo', 'sendinblue'].some((k) => lower.includes(k));
  const weakHit = ['privacy', 'contact', 'archives', 'subscribe', 'settings', 'terms'].some((k) => lower.includes(k));
  const looksAddress =
    /\b\d{1,6}\b/.test(l) &&
    /\b(st|street|ave|avenue|rd|road|suite|ste|po box|p\.?o\.?\s*box|blvd|boulevard|lane|ln|drive|dr)\b/i.test(l);

  return { alphaRatio, linkDensity, urlCount, isUrlOnly, strongHit, weakHit, looksAddress };
}

function splitBlocksWithSpans(text) {
  const lines = normalizeNewlines(text).split('\n');
  const blocks = [];
  let cur = [];
  let start = 0;
  const flush = (endExclusive) => {
    if (!cur.length) return;
    blocks.push({ start, end: endExclusive, lines: cur.slice() });
    cur = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (String(line || '').trim() === '') {
      flush(i);
      start = i + 1;
      continue;
    }
    cur.push(line);
  }
  flush(lines.length);
  return { lines, blocks };
}

function blockFooterScore(blockLines) {
  let score = 0;
  for (const line of blockLines) {
    const l = String(line || '').trim();
    if (!l) continue;
    const f = lineFeatures(l);
    if (f.strongHit) score += 5;
    if (f.weakHit) score += 2;
    if (f.looksAddress) score += 3;
    if (f.isUrlOnly) score += 2;
    if (f.urlCount > 0 && f.alphaRatio < 0.22) score += 1;
    if (f.linkDensity > 0.55) score += 2;
    if (l.length <= 70 && (f.strongHit || f.weakHit || f.isUrlOnly)) score += 1;
  }
  return score;
}

function findFooterAnchorLineIndex(lines) {
  const TAIL_LINES = 140;
  const start = Math.max(0, lines.length - TAIL_LINES);
  let best = null;
  for (let i = start; i < lines.length; i++) {
    const t = String(lines[i] || '').trim();
    if (!t) continue;
    const f = lineFeatures(t);
    let s = 0;
    if (f.strongHit) s += 6;
    if (f.weakHit) s += 2;
    if (f.looksAddress) s += 4;
    if (f.isUrlOnly) s += 2;
    if (f.urlCount > 0 && f.alphaRatio < 0.20) s += 2;
    if (f.linkDensity > 0.60) s += 2;
    if (s < 6) continue;
    if (!best || i < best.idx || (i === best.idx && s > best.score)) {
      best = { idx: i, score: s };
    }
  }
  return best;
}

function trimFooterSpanAware(text) {
  const original = text;
  const { lines, blocks } = splitBlocksWithSpans(text);
  if (!lines.length) {
    return { text: '', trimmed: false };
  }
  let endBlock = blocks.length - 1;
  while (endBlock >= 0) {
    const score = blockFooterScore(blocks[endBlock].lines);
    if (score >= 8) {
      endBlock--;
      continue;
    }
    break;
  }
  let keptLines = lines.slice(0);
  if (blocks.length && endBlock < blocks.length - 1) {
    const cutLine = blocks[endBlock] ? blocks[endBlock].end : 0;
    keptLines = lines.slice(0, cutLine);
  }
  const anchor = findFooterAnchorLineIndex(keptLines);
  if (anchor && anchor.idx >= Math.floor(keptLines.length * 0.55)) {
    keptLines = keptLines.slice(0, anchor.idx);
  }
  let out = keptLines.join('\n').trim();
  const origLen = String(original || '').trim().length;
  const outLen = out.length;
  const tooSmall =
    (origLen >= 1200 && outLen < 300) ||
    (origLen >= 2000 && outLen < origLen * 0.25) ||
    (origLen >= 4000 && outLen < origLen * 0.18);
  if (tooSmall) {
    return { text: String(original || '').trim(), trimmed: false };
  }
  return { text: out, trimmed: true };
}

function buildMdFromText(textInput) {
  let t = String(textInput || '');
  const moji = fixMojibakeGuarded(t);
  t = moji.text;
  t = decodeEntities(t);
  t = stripInvisibleTransport(t);
  t = dropTransportArtifactLines(t);
  t = collapseWhitespacePreserveNewlines(t);
  const lines = t.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = out.length ? out[out.length - 1] : '';
    const trimmed = String(line || '').trim();
    const isAllCaps =
      trimmed.length >= 6 &&
      trimmed.length <= 80 &&
      /^[A-Z0-9][A-Z0-9\s\-:&/]+$/.test(trimmed) &&
      (trimmed.match(/[A-Z]/g) || []).length >= 4;
    const looksHeading = isAllCaps || /^#{1,6}\s+/.test(trimmed);
    if (looksHeading && prev && prev.trim() !== '') out.push('');
    out.push(line);
  }
  t = collapseWhitespacePreserveNewlines(out.join('\n'));
  return { md: t };
}

const URL_RE2 = /(https?:\/\/[^\s)<>]+|www\.[^\s)<>]+)/ig;

function extractUrls(line) {
  const m = String(line || '').match(URL_RE2);
  return m ? m.map((u) => u.trim()) : [];
}

function firstUrl(line) {
  const u = extractUrls(line);
  return u.length ? u[0] : null;
}

function urlFromMarkdownLink(line) {
  const m = String(line || '').match(/\[[^\]]*\]\((https?:\/\/[^)]+)\)/i);
  return m ? m[1] : null;
}

function parseHost(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  try {
    const fixed = u.startsWith('http') ? u : `https://${u}`;
    return new URL(fixed).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function lineIsUrlOnly(line) {
  const l = String(line || '').trim();
  if (!l) return false;
  const urls = extractUrls(l);
  if (!urls.length) return false;
  let t = l.replace(/\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi, '');
  t = t.replace(URL_RE2, '');
  t = t.replace(/[<>\[\]()*•·—–\-_,.:;'"“”‘’|/\\]/g, '');
  t = t.replace(/\s+/g, '').trim();
  return t.length === 0;
}

function isTransportArtifactLine(line) {
  const l = String(line || '').trim();
  return /^<?#?m_[\w-]+_>?$/i.test(l) || /^<#m_-?\d+_>\s*$/i.test(l);
}

function isEmptyAngleLink(line) {
  const l = String(line || '').trim();
  return /^<\s*>$/.test(l);
}

function isDecorativeSeparator(line) {
  const l = String(line || '').trim();
  if (!l) return false;
  if (l === '---') return false;
  return /^-{12,}$/.test(l) || /^_{12,}$/.test(l) || /^={12,}$/.test(l);
}

function looksViewOnlineLabelLineStrict(line) {
  const raw = String(line || '').trim();
  if (!raw) return false;
  const md = raw.match(/^\s*\[([^\]]+)\]\((https?:\/\/[^)]+)\)\s*$/i);
  if (md) {
    const label = String(md[1] || '').trim().toLowerCase();
    return (
      label === 'view online' ||
      label === 'view in browser' ||
      label === 'view in your browser' ||
      label === 'open in browser' ||
      label === 'read online' ||
      label === 'web version'
    );
  }
  if (raw.length > 42) return false;
  return /^(view (online|in (your )?browser)|open in browser|read online|web version)\s*[:\-–—]?\s*$/i.test(raw);
}

function tryExtractViewOnline(lines) {
  const MAX = Math.min(30, lines.length);
  for (let i = 0; i < MAX; i++) {
    const cur = String(lines[i] || '').trim();
    if (!cur) continue;
    if (!looksViewOnlineLabelLineStrict(cur)) continue;
    let url =
      urlFromMarkdownLink(cur) ||
      firstUrl(cur) ||
      urlFromMarkdownLink(lines[i + 1] || '') ||
      firstUrl(lines[i + 1] || '');
    if (!url) {
      return { found: true, removed: false, url: null };
    }
    lines[i] = '';
    const next = String(lines[i + 1] || '').trim();
    if (next && lineIsUrlOnly(next)) {
      lines[i + 1] = '';
    }
    return { found: true, removed: true, url };
  }
  return { found: false, removed: false, url: null };
}

function isFeedblitzTrackingHost(host) {
  if (!host) return false;
  return (
    host === 'p.feedblitz.com' ||
    host === 'app.feedblitz.com' ||
    host === 'archive.feedblitz.com' ||
    host === 'feeds.feedblitz.com'
  );
}

function removeFeedblitzTracking(lines) {
  const out = [];
  for (let line of lines) {
    const raw = String(line || '');
    const trimmed = raw.trim();
    if (!trimmed) {
      out.push(raw);
      continue;
    }
    const urls = extractUrls(trimmed);
    if (!urls.length) {
      out.push(raw);
      continue;
    }
    const hosts = urls.map(parseHost);
    const hasFeedblitz = hosts.some(isFeedblitzTrackingHost);
    if (!hasFeedblitz) {
      out.push(raw);
      continue;
    }
    if (lineIsUrlOnly(trimmed) && hosts.every((h) => isFeedblitzTrackingHost(h))) {
      continue;
    }
    let newLine = raw;
    for (const u of urls) {
      const h = parseHost(u);
      if (isFeedblitzTrackingHost(h)) {
        newLine = newLine.split(u).join('');
      }
    }
    newLine = newLine.replace(/\(\s*\)/g, ' ');
    newLine = newLine.replace(/[ \t]+/g, ' ').trim();
    if (!newLine || newLine.trim() === '' || lineIsUrlOnly(newLine)) {
      continue;
    }
    out.push(newLine);
  }
  return { lines: out };
}

function looksLikePersonName(s) {
  const v = String(s || '').trim();
  if (!v) return false;
  if (v.length < 2 || v.length > 60) return false;
  if (/https?:\/\//i.test(v) || /@/.test(v)) return false;
  if (/[<>]/.test(v)) return false;
  if (/^the\b/i.test(v)) return false;
  if (/^the way\b/i.test(v)) return false;
  if (!/^[A-Za-z\u00C0-\u024F\u1E00-\u1EFF\s.'’-]+$/.test(v)) return false;
  const words = v.split(/\s+/).filter(Boolean);
  if (words.length > 6) return false;
  if (countAlpha(v) < 2) return false;
  return true;
}

function deriveAuthorFromTop(mdText) {
  const lines = normalizeNewlines(String(mdText || '')).split('\n').slice(0, 25);
  for (const ln of lines) {
    const t = String(ln || '').trim();
    if (!t) continue;
    const m = t.match(/^by\s+(.+)\s*$/i);
    if (!m) continue;
    const cand = String(m[1] || '').trim();
    if (!looksLikePersonName(cand)) continue;
    return cand;
  }
  return null;
}

function buildEmailNewsletterText(core_text) {
  let text = String(core_text || '');
  text = normalizeQuotedPrintableSoftBreaks(text);
  const mojiText = fixMojibakeGuarded(text);
  text = mojiText.text;
  text = decodeEntities(text);
  const preStrip = text;
  text = stripInvisibleTransport(text);
  // Drop noisy "n" lines caused by hidden transport artifacts.
  text = dropNoisyNLines(preStrip, text);
  text = dropTransportArtifactLines(text);
  text = collapseDecorativeDividerRuns(text);
  text = collapseWhitespacePreserveNewlines(text);

  const teaser = maybeDropTeaser(text);
  let newsletter_text = teaser.text;

  const footer = trimFooterSpanAware(newsletter_text);
  newsletter_text = footer.text;
  newsletter_text = collapseWhitespacePreserveNewlines(newsletter_text);

  return { newsletter_text };
}

function dropNoisyNLines(rawText, cleanedText) {
  const rawLines = normalizeNewlines(String(rawText || '')).split('\n');
  const cleanLines = normalizeNewlines(String(cleanedText || '')).split('\n');
  const out = [];

  const badGlyphs = /[\u034F\u200B-\u200D\u2060\uFEFF\u00AD]/;

  for (let i = 0; i < cleanLines.length; i++) {
    const raw = rawLines[i] ?? '';
    const clean = cleanLines[i] ?? '';
    const trimmed = String(clean || '').trim().toLowerCase();

    if (trimmed === 'n') {
      const rawHasBad = badGlyphs.test(raw);
      const rawLong = String(raw).length >= 5;
      if (rawHasBad || rawLong) {
        continue;
      }
    }

    out.push(clean);
  }

  return out.join('\n');
}

function prepareCorrespondenceText(text) {
  let t = stripInvisibleTransport(normalizeNewlines(text));

  const dropLine = [
    /^proprietary\s*$/i,
    /^get outlook for ios$/i,
    /^caution:\s*this email originated from outside/i,
    /^links contained in this email have been replaced by zixprotect/i,
  ];

  t = t
    .split('\n')
    .filter((line) => !dropLine.some((re) => re.test(String(line || '').trim())))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return t;
}

function parseOutlookBlocks(text) {
  const t = String(text || '');
  const blocks = [];
  const re = /^From:\s*(.+)\nSent:\s*(.+)\nTo:\s*(.+)\nSubject:\s*(.+)\s*$/gim;

  const matches = [];
  let m;
  while ((m = re.exec(t)) !== null) {
    matches.push({
      idx: m.index,
      headerLen: String(m[0] || '').length,
      from: m[1],
      sent: m[2],
      to: m[3],
      subject: m[4],
    });
  }

  if (matches.length === 0) return null;

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const nextIdx = (i + 1 < matches.length) ? matches[i + 1].idx : t.length;
    const startBodyIdx = cur.idx + cur.headerLen;
    const body = t.slice(startBodyIdx, nextIdx).trim();

    blocks.push({
      from: String(cur.from || '').trim(),
      sent: String(cur.sent || '').trim(),
      to: String(cur.to || '').trim(),
      subject: String(cur.subject || '').trim(),
      body,
    });
  }

  return blocks;
}

function stripSignature(body) {
  let lines = stripInvisibleTransport(body)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  const killIf = [
    /^get outlook for ios$/i,
    /^follow us\b/i,
    /zixprotect/i,
    /^caution:\s*this email originated from outside/i,
    /^\[cid:/i,
  ];

  lines = lines.filter((l) => !killIf.some((re) => re.test(String(l || '').trim())));

  const contactish = (l) =>
    /(phone|mobile|tel|fax|address|website|linkedin|ht?ecgroup|@)/i.test(l) ||
    /\+?\d[\d\s().-]{7,}\d/.test(l);

  for (let i = Math.max(0, lines.length - 25); i < lines.length; i++) {
    if (contactish(lines[i])) {
      const tail = lines.slice(i).filter((x) => String(x || '').trim() !== '');
      const tailContactCount = tail.filter(contactish).length;
      if (tailContactCount >= 2) {
        lines = lines.slice(0, i);
        break;
      }
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function formatThreadMarkdown(blocks) {
  const safeBlocks = Array.isArray(blocks) ? blocks : [];

  const fmtBlock = (b, idx) => {
    const header = [
      `### Message ${idx + 1}`,
      b.from ? `- From: ${b.from}` : null,
      b.to ? `- To: ${b.to}` : null,
      b.sent ? `- Sent: ${b.sent}` : null,
      b.subject ? `- Subject: ${b.subject}` : null,
    ].filter(Boolean).join('\n');

    const body = stripSignature(b.body || '');
    return `${header}\n\n${body}`.trim();
  };

  const parts = safeBlocks.map(fmtBlock).filter(Boolean);
  return parts.join('\n\n---\n\n').trim();
}

function deriveAuthorFromFromHeader(fromRaw) {
  const raw = sanitizeHeaderText(fromRaw);
  if (!raw) return null;
  const m = raw.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  if (m && m[1]) return m[1].trim();
  return raw;
}

function stripForwardPrefixOnce(subject) {
  const raw = sanitizeHeaderText(subject);
  if (!raw) return null;
  return raw.replace(/^\s*(?:fwd?|fw|forward)\s*:\s*/i, '').trim();
}

function normalizeIdemFromHeader(fromValue) {
  return sanitizeHeaderText(fromValue);
}

function normalizeIdemSubject(subjectValue) {
  const base = stripForwardPrefixOnce(subjectValue);
  if (!base) return null;
  // Keep idempotency subject stable by removing decorative leading symbols/emojis.
  const cleaned = base.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  return cleaned || null;
}

function parseMiniHeaderBlock(lines, startIdx, opts) {
  const maxLines = (opts && opts.maxLines) || 30;
  const keys = /^(From|To|Subject|Date|Sent|Cc|Bcc|Reply-To|Message-ID):\s*(.*)\s*$/i;

  let i = startIdx;
  let skipped = 0;
  while (i < lines.length && skipped < 3 && String(lines[i] || '').trim() === '') {
    i++;
    skipped++;
  }

  const headers = {};
  const wrapperLines = [];
  let lastKey = null;
  let seenBlankTerminator = false;

  for (let n = 0; i < lines.length && n < maxLines; i++, n++) {
    const line = String(lines[i] || '');
    wrapperLines.push(line);

    if (line.trim() === '') {
      seenBlankTerminator = true;
      i++;
      break;
    }

    const hm = line.match(keys);
    if (hm) {
      lastKey = hm[1].toLowerCase().replace(/-/g, '_');
      const val = String(hm[2] || '').trim();
      headers[lastKey] = headers[lastKey] ? `${headers[lastKey]} ${val}`.trim() : val;
      continue;
    }

    if (lastKey && /^\s+/.test(line)) {
      headers[lastKey] = `${headers[lastKey]} ${line.trim()}`.trim();
    }
  }

  const score =
    (headers.from ? 1 : 0) +
    (headers.to ? 1 : 0) +
    (headers.subject ? 1 : 0) +
    (headers.date || headers.sent ? 1 : 0);

  const found = seenBlankTerminator && score >= ((opts && opts.minScore) || 2);

  return { found, headers, wrapperLines, bodyStart: i, score, seenBlankTerminator };
}

function stripTopHeaderBlockIfPresent(text) {
  const t = normalizeNewlines(text);
  const lines = t.split('\n');

  let first = -1;
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    if (String(lines[i] || '').trim() !== '') {
      first = i;
      break;
    }
  }
  if (first === -1) return { text: t.trim(), stripped: false, parsed: null };

  const hb = parseMiniHeaderBlock(lines, first, { minScore: 3, maxLines: 25 });
  if (!hb.found) return { text: t.trim(), stripped: false, parsed: null };

  const remaining = lines.slice(hb.bodyStart).join('\n').trim();
  if (remaining.length < 80) return { text: t.trim(), stripped: false, parsed: null };

  return {
    text: remaining,
    stripped: true,
    parsed: { headers: hb.headers, wrapper_text: hb.wrapperLines.join('\n').trim(), score: hb.score },
  };
}

function extractForwardedPlainText(raw) {
  const text = normalizeNewlines(raw);
  const lines = text.split('\n');

  const MAX_SCAN = 80;

  const MARKERS = [
    { name: 'gmail', re: /^-+\s*Forwarded message\s*-+\s*$/i },
    { name: 'gmail_begin', re: /^Begin forwarded message:\s*$/i },
    { name: 'outlook', re: /^-+\s*Original Message\s*-+\s*$/i },
    { name: 'generic_fwd', re: /^-+\s*Forwarded\s+Message\s*-+\s*$/i },
    { name: 'generic_fwd2', re: /^-{2,}\s*Forwarded\s+message\s*-{2,}\s*$/i },
  ];

  let idx = -1;
  let parser = 'none';
  let marker_line = '';

  for (let i = 0; i < Math.min(lines.length, MAX_SCAN); i++) {
    const t = String(lines[i] || '').trim();
    for (const m of MARKERS) {
      if (m.re.test(t)) {
        idx = i;
        parser = m.name;
        marker_line = lines[i] || '';
        break;
      }
    }
    if (idx !== -1) break;
  }

  if (idx === -1) {
    const stripped = stripTopHeaderBlockIfPresent(text);
    if (stripped.stripped) {
      return {
        found: true,
        parser: 'header_block',
        marker_line: null,
        preamble: '',
        headers: stripped.parsed.headers,
        wrapper_text: stripped.parsed.wrapper_text,
        body: stripped.text,
      };
    }

    return {
      found: false,
      parser: 'none',
      marker_line: null,
      preamble: '',
      headers: {},
      wrapper_text: '',
      body: text.trim(),
    };
  }

  const preamble = lines.slice(0, idx).join('\n').trim();
  const hb = parseMiniHeaderBlock(lines, idx + 1, { minScore: 2, maxLines: 35 });

  if (!hb.found) {
    return {
      found: false,
      parser: 'none',
      marker_line: null,
      preamble: '',
      headers: {},
      wrapper_text: '',
      body: text.trim(),
    };
  }

  let body = lines.slice(hb.bodyStart).join('\n').trim();
  body = body.replace(/^(?:\s*(?:From|To|Subject|Date|Sent):[^\n]*\n){1,10}\s*\n?/i, '').trim();

  return {
    found: true,
    parser,
    marker_line,
    preamble,
    headers: hb.headers,
    wrapper_text: [marker_line, hb.wrapperLines.join('\n')].filter(Boolean).join('\n').trim(),
    body,
  };
}

function applyThink(text) {
  const lines = normalizeNewlines(text).split('\n');

  let firstIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (String(lines[i] || '').trim() !== '') {
      firstIdx = i;
      break;
    }
  }
  if (firstIdx === -1) return { intent: 'archive', text: '' };

  const first = String(lines[firstIdx] || '').trim();
  const m = first.match(/^think\s*:?\s*(.*)$/i);
  if (!m) return { intent: 'archive', text };

  const remainder = String(m[1] || '').trim();
  if (remainder) {
    lines[firstIdx] = remainder;
  } else {
    lines.splice(firstIdx, 1);
  }
  return { intent: 'think', text: lines.join('\n').trim() };
}

function looksLikeThread(text) {
  const t = String(text || '');
  if (/^From:\s.+\nSent:\s.+\nTo:\s.+\nSubject:\s.+/im.test(t)) return true;
  if (/^On .+wrote:\s*$/im.test(t)) return true;
  if (/^\s*>/m.test(t)) return true;
  if (/^_{8,}\s*$/m.test(t)) return true;
  return false;
}

function normalizeEmailTransport(rawText) {
  const capture_text = normalizeNewlines(String(rawText || ''));
  const fwd = extractForwardedPlainText(capture_text);

  let core_text_raw = fwd.found
    ? [fwd.preamble, fwd.body].filter(Boolean).join('\n\n').trim()
    : capture_text.trim();

  const topStrip = stripTopHeaderBlockIfPresent(core_text_raw);
  core_text_raw = topStrip.text;
  core_text_raw = normalizeQuotedPrintableSoftBreaks(core_text_raw);

  const coreMoji = fixMojibakeGuarded(core_text_raw);
  let core_text = stripInvisibleTransport(decodeEntities(coreMoji.text));
  core_text = collapseWhitespacePreserveNewlines(core_text);

  return {
    capture_text,
    core_text,
    forwarded: {
      found: !!fwd.found,
      headers: fwd.headers || {},
    },
  };
}

function decideEmailIntentFromCore(core_text) {
  const thinkApplied = applyThink(core_text);
  const intent = thinkApplied.intent;
  const content_type = intent === 'think'
    ? 'note'
    : 'newsletter';
  return { intent, content_type, core_text: thinkApplied.text };
}

function decideEmailIntent(rawText) {
  const { core_text } = normalizeEmailTransport(rawText);
  return decideEmailIntentFromCore(core_text);
}

function buildEmailRetrieval({
  capture_text,
  content_type,
  clean_text,
  config,
  url = null,
  url_canonical = null,
}) {
  return buildRetrievalForDb({
    capture_text,
    content_type,
    extracted_text: '',
    url_canonical,
    url,
    config,
    excerpt_override: null,
    excerpt_source: clean_text,
    quality_source_text: clean_text,
  });
}

async function normalizeEmailInternal({ raw_text, force_content_type, from, subject }) {
  if (raw_text === undefined || raw_text === null) {
    throw new Error('raw_text is required');
  }

  const config = getConfig();
  if (!config || !config.qualityThresholds) {
    throw new Error('config missing qualityThresholds');
  }

  // Step 1: transport-level cleanup (forwarded wrappers, mojibake, invisibles)
  const { capture_text, core_text, forwarded } = normalizeEmailTransport(raw_text);

  // Step 2: intent + content_type decision (note/newsletter/correspondence)
  const decision = decideEmailIntentFromCore(core_text);
  const normalizedCoreText = decision.core_text;
  const content_type = force_content_type || decision.content_type;
  const intent = decision.intent;
  const forwardedFrom = forwarded?.found ? forwarded.headers?.from : null;
  const forwardedSubject = forwarded?.found ? forwarded.headers?.subject : null;
  const authorFromHeader = deriveAuthorFromFromHeader(forwardedFrom || from);
  const titleFromHeader = forwarded?.found
    ? stripForwardPrefixOnce(forwardedSubject || subject)
    : (subject ? String(subject).trim() : null);

  if (content_type === 'correspondence') {
    // Step 3a: correspondence path (newsletter-style cleanup -> thread parsing -> signatures -> markdown)
    const { newsletter_text } = buildEmailNewsletterText(normalizedCoreText);
    const corr_text = prepareCorrespondenceText(newsletter_text);

    const blocks = parseOutlookBlocks(corr_text) || [
      { from: authorFromHeader || '', sent: '', to: '', subject: titleFromHeader || '', body: corr_text },
    ];

    const clean_text = formatThreadMarkdown(blocks);

    const retrieval_fields = buildEmailRetrieval({
      capture_text,
      content_type: 'correspondence',
      clean_text,
      config,
    });

    return formatForInsert({
      source: 'email',
      intent,
      content_type: 'correspondence',
      title: titleFromHeader || null,
      author: authorFromHeader || null,
      capture_text,
      clean_text,
      url: null,
      url_canonical: null,
      retrieval_fields,
    });
  }

  if (content_type === 'note') {
    // Step 3b: note fallback (preserve cleaned core_text)
    const clean_text = collapseWhitespacePreserveNewlines(normalizedCoreText);
    const retrieval_fields = buildEmailRetrieval({
      capture_text,
      content_type: 'note',
      clean_text,
      config,
    });

    return formatForInsert({
      source: 'email',
      intent,
      content_type: 'note',
      title: titleFromHeader || null,
      author: authorFromHeader || null,
      capture_text,
      clean_text,
      url: null,
      url_canonical: null,
      retrieval_fields,
    });
  }

  // Step 3c: newsletter path (normalize -> markdown -> boilerplate removal)
  const { newsletter_text } = buildEmailNewsletterText(normalizedCoreText);

  const mdFromText = buildMdFromText(newsletter_text);
  const coreFallback = buildMdFromText(normalizedCoreText);

  let newsletter_md = mdFromText.md;
  if (!newsletter_md && coreFallback.md) {
    newsletter_md = coreFallback.md;
  }
  newsletter_md = dropTransportArtifactLines(newsletter_md);
  newsletter_md = collapseWhitespacePreserveNewlines(newsletter_md);

  const mdInNorm = normalizeNewlines(String(newsletter_md || ''));
  const moji1 = fixMojibakeGuarded(mdInNorm);
  let clean = moji1.text;
  clean = decodeEntities(clean);
  clean = stripInvisibleTransport(clean);
  clean = collapseWhitespacePreserveNewlines(clean);

  let lines = clean.split('\n');
  lines = lines.filter((ln) => {
    if (isTransportArtifactLine(ln)) return false;
    if (isEmptyAngleLink(ln)) return false;
    if (isDecorativeSeparator(ln)) return false;
    return true;
  });

  const viewOnline = tryExtractViewOnline(lines);
  let canonical_url = null;
  if (viewOnline.found && viewOnline.removed && viewOnline.url) {
    canonical_url = canonicalizeUrl(viewOnline.url);
  }

  lines = lines.filter((ln) => String(ln || '').trim() !== '');
  const fb = removeFeedblitzTracking(lines);
  lines = fb.lines;

  let clean_text = collapseWhitespacePreserveNewlines(lines.join('\n'));
  if (!clean_text) {
    clean_text = collapseWhitespacePreserveNewlines(newsletter_text);
  }

  const author = authorFromHeader || deriveAuthorFromTop(clean_text);

  const url_canonical = canonical_url || null;
  const url = url_canonical || null;

  const retrieval_fields = buildEmailRetrieval({
    capture_text,
    content_type: 'newsletter',
    clean_text,
    config,
    url,
    url_canonical,
  });

  return formatForInsert({
    source: 'email',
    intent,
    content_type: 'newsletter',
    title: titleFromHeader || null,
    author: author || null,
    capture_text,
    clean_text,
    url,
    url_canonical,
    retrieval_fields,
  });
}

async function normalizeEmail({ raw_text, from, subject, date, message_id, source }) {
  const src = source && typeof source === 'object' ? source : null;
  const resolvedRawText = raw_text ?? (src ? (src.body || src.text || src.raw_text || src.capture_text) : null);
  const resolvedFrom = normalizeIdemFromHeader(from ?? null);
  const resolvedSubject = normalizeIdemSubject(subject ?? null);
  const resolvedDate = sanitizeHeaderText(date ?? null);
  const resolvedMessageId = sanitizeHeaderText(message_id ?? null);
  const transport = normalizeEmailTransport(resolvedRawText);
  const fwd = transport && transport.forwarded ? transport.forwarded : { found: false, headers: {} };
  const fwdHeaders = (fwd && fwd.headers && typeof fwd.headers === 'object') ? fwd.headers : {};
  const forwardedFrom = normalizeIdemFromHeader(fwdHeaders.from);
  const forwardedSubjectRaw = sanitizeHeaderText(fwdHeaders.subject);
  const forwardedSubject = forwardedSubjectRaw ? normalizeIdemSubject(forwardedSubjectRaw) : null;
  const forwardedDate = sanitizeHeaderText(fwdHeaders.date || fwdHeaders.sent);
  const forwardedMessageId = sanitizeHeaderText(fwdHeaders.message_id);
  const normalized = await normalizeEmailInternal({
    raw_text: resolvedRawText,
    from: resolvedFrom,
    subject: resolvedSubject,
  });
  // system is inferred by /normalize/email API handler.
  const sourceForIdem = {
    ...(src || {}),
    system: 'email',
    from_addr: (fwd.found && forwardedFrom)
      ? forwardedFrom
      : (resolvedFrom || (src && (src.from_addr || src.from || src.sender) ? (src.from_addr || src.from || src.sender) : null)),
    subject: (fwd.found && forwardedSubject)
      ? forwardedSubject
      : (resolvedSubject || (src && src.subject ? src.subject : null)),
    date: (fwd.found && forwardedDate)
      ? forwardedDate
      : (resolvedDate || (src && src.date ? src.date : null)),
    message_id: (fwd.found && forwardedMessageId)
      ? forwardedMessageId
      : (resolvedMessageId || (src && src.message_id ? src.message_id : null)),
    body: (src && src.body) ? src.body : resolvedRawText,
  };
  const idem = buildIdempotencyForNormalized({
    source: sourceForIdem,
    normalized,
  });
  return attachIdempotencyFields(normalized, idem);
}

async function normalizeWebpage({
  text,
  extracted_text,
  clean_text,
  capture_text,
  content_type,
  url,
  url_canonical,
  excerpt,
}) {
  // Step 1: text-clean behavior from telegram-capture/09_text-clean.
  const extracted = String(
    text !== undefined && text !== null
      ? text
      : (extracted_text !== undefined && extracted_text !== null ? extracted_text : (clean_text || ''))
  );
  const cleaned = cleanWebpageExtractedText(
    clean_text !== undefined && clean_text !== null ? clean_text : extracted
  );

  // Preserve node parity: if cleaned text is empty, do not force retrieval overwrite.
  if (!cleaned) {
    return {
      extracted_text: extracted,
      extracted_len: extracted.length,
      clean_text: '',
      clean_len: 0,
      retrieval_update_skipped: true,
    };
  }

  // Step 2: recompute retrieval excerpt + quality (node 08 behavior) via quality module.
  const config = getConfig();
  const effectiveUrl = url || null;
  const effectiveCanonical = canonicalizeUrl(url_canonical || effectiveUrl);
  const effectiveContentType = String(content_type || '').trim() || 'newsletter';
  const effectiveCaptureText = (capture_text !== undefined && capture_text !== null)
    ? String(capture_text)
    : cleaned;
  const excerptOverride = (excerpt !== undefined && excerpt !== null)
    ? String(excerpt)
    : null;

  const retrieval_fields = buildRetrievalForDb({
    capture_text: effectiveCaptureText,
    content_type: effectiveContentType,
    extracted_text: extracted,
    url_canonical: effectiveCanonical,
    url: effectiveUrl,
    config,
    excerpt_override: excerptOverride,
    excerpt_source: cleaned,
    quality_source_text: cleaned,
  });

  return {
    extracted_text: extracted,
    extracted_len: extracted.length,
    clean_text: cleaned,
    clean_len: cleaned.length,
    ...retrieval_fields,
  };
}

module.exports = {
  normalizeTelegram,
  normalizeEmail,
  normalizeWebpage,
  decideEmailIntent,
};
