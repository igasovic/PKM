/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Telegram Capture (telegram-capture)
 * Node: Normalize
 * Node ID: 08ca99f5-2ba7-42e9-aab6-4b90e6055f85
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

// Telegram normalization node (fits pkm.entries schema)

// 1) Get Telegram text
const text = $json.message?.text || '';
const capture_text = String(text);

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
