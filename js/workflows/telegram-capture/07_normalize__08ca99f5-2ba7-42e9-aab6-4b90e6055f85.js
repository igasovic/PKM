/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Telegram Capture (telegram-capture)
 * Node: Normalize
 * Node ID: 08ca99f5-2ba7-42e9-aab6-4b90e6055f85
 */
'use strict';

module.exports = async function run(ctx) {
  const { $json } = ctx;

  // Telegram normalization node (fits pkm.entries schema)

  // 1) Get Telegram text
  const rawText = $json.message?.text || '';
  let capture_text = String(rawText || '');

  // --- Helpers for PKM JSON note mode ---

  function maybeUnescapeTelegramText(s) {
    const t = String(s ?? '');

    // If it contains lots of \n and \" but no real newlines, it's likely escaped.
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

  // Extract a JSON object from the message by balanced brace parsing.
  // We accept the first object that contains title + topic.
  function extractJsonObjectAndRemainder(text) {
    const hay = String(text || '');
    const MAX_SCAN_CHARS = 20000;  // safe for long notes
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
              after = after.replace(/^\s+/, ''); // trim leading whitespace
              return { obj, jsonStr, after };
            }
            break; // this candidate wasn't our JSON; try next '{'
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

  // Try to normalize escaped display to real text before parsing JSON.
  capture_text = maybeUnescapeTelegramText(capture_text);

  const parsed = extractJsonObjectAndRemainder(capture_text);

  // --- PKM JSON note fast-path ---
  if (parsed?.obj) {
    const j = parsed.obj;

    const title = (j.title ?? null);
    const topic = normTopic(j.topic);
    const secondary_topic = normTopic(j.secondary_topic);
    const secondary_topic_confidence = clamp01(j.secondary_topic_confidence);

    const gist = (j.gist ?? null);
    const excerpt = (j.excerpt ?? null);

    const clean_text = String(parsed.after ?? '');

    return [
      {
        ...$json,

        _pkm_mode: 'pkm_json_note_v1',

        // fixed fields for this flow
        source: 'telegram',
        intent: 'think',
        content_type: 'note',
        author: null,

        // capture + derived
        capture_text,
        clean_text,

        // extracted vars
        title,
        topic,
        primary_topic_confidence: 1,
        secondary_topic,
        secondary_topic_confidence,
        gist,
        excerpt,

        // IMPORTANT: bypass URL extraction flow
        url: null,
        url_canonical: null,
      }
    ];
  }

  // --- Fallback to original behavior (URL-based newsletter/note) ---

  // 2) Extract first URL from Telegram text
  const match = capture_text.match(/https?:\/\/[^\s<>()]+/i);
  let url = match ? match[0] : null;

  // Trim common trailing punctuation/brackets
  if (url) {
    while (/[)\],.?!:;"'»]+$/.test(url)) {
      url = url.replace(/[)\],.?!:;"'»]+$/, '');
    }
  }

  // 3) Canonicalize using plain JS (no URL(), no modules)
  function canonicalizeUrl(raw) {
    if (!raw) return null;

    let s = String(raw).trim();

    // Remove invisible characters
    s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');

    // Drop fragment
    const hashIdx = s.indexOf('#');
    if (hashIdx !== -1) s = s.slice(0, hashIdx);

    // Split base / query
    const qIdx = s.indexOf('?');
    let base = qIdx === -1 ? s : s.slice(0, qIdx);
    let query = qIdx === -1 ? '' : s.slice(qIdx + 1);

    // Normalize scheme + host casing
    base = base.replace(/^https?:\/\//i, m => m.toLowerCase());
    base = base.replace(
      /^https?:\/\/([^\/]+)/i,
      (m, host) => m.replace(host, host.toLowerCase())
    );

    // Remove trailing slash (except root)
    base = base.replace(/^(https?:\/\/[^\/]+)\/+$/, '$1');
    base = base.replace(/(.+?)\/+$/, '$1');

    // Filter tracking query params
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

  const url_canonical = canonicalizeUrl(url);

  // 4) Guidelines -> content_type + intent
  const content_type = url ? 'newsletter' : 'note';
  const intent = content_type === 'newsletter' ? 'archive' : 'think';

  // 5) Optional: pull title/author if Telegram provides them (usually not)
  const title =
    $json.message?.document?.file_name ||
    $json.message?.caption ||
    null;

  const author = null;

  // 6) Return normalized fields (keep original payload too)
  return [
    {
      ...$json,

      // pkm.entries core fields you care about downstream
      source: 'telegram',
      intent,
      content_type,
      title,
      author,

      capture_text,
      url,
      url_canonical,
    }
  ];
};
