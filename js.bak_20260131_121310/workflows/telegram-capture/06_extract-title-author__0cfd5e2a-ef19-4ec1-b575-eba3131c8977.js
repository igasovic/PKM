/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Telegram Capture (telegram-capture)
 * Node: Extract Title & Author
 * Node ID: 0cfd5e2a-ef19-4ec1-b575-eba3131c8977
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

// Combined TITLE + AUTHOR extraction
// Outputs only: title, author

const html = $json.html || '';
const clean_text = ($json.clean_text || '').trim();

// ---------------- helpers ----------------
const decodeEntities = (s) =>
  String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ');

const norm = (s) => {
  if (!s) return null;
  const t = decodeEntities(s).replace(/\s+/g, ' ').trim();
  return t.length ? t : null;
};

const pickFirst = (arr) => {
  for (const v of arr) {
    const t = norm(v);
    if (t) return t;
  }
  return null;
};

// ---------------- TITLE ----------------
let title = null;

// 1) og:title
let m = html.match(
  /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i
);
if (m?.[1]) title = norm(m[1]);

// 2) <title>
if (!title) {
  m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m?.[1]) title = norm(m[1]);
}

// 3) first line of clean_text
if (!title && clean_text) {
  const firstLine = clean_text
    .split('\n')
    .map(s => s.trim())
    .find(Boolean);
  if (firstLine) title = firstLine.slice(0, 140);
}

// ---------------- AUTHOR ----------------
const metaContent = (key, attr) => {
  const re = new RegExp(
    `<meta[^>]+${attr}\\s*=\\s*["']${key}["'][^>]*content\\s*=\\s*["']([^"']+)["'][^>]*>`,
    'i'
  );
  const m = html.match(re);
  return m ? m[1] : null;
};

const titleCase = (s) =>
  String(s)
    .split(' ')
    .filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1))
    .join(' ');

const authorFromValue = (val) => {
  const v = norm(val);
  if (!v) return null;

  const parts = v.split(',').map(p => p.trim()).filter(Boolean);
  const names = [];

  for (const p of parts) {
    if (/^https?:\/\//i.test(p)) {
      const seg = p.replace(/\/+$/, '').match(/\/([^\/?#]+)$/)?.[1];
      if (!seg) continue;
      names.push(titleCase(seg.replace(/[-_]+/g, ' ')));
    } else {
      names.push(p);
    }
  }

  const seen = new Set();
  return names
    .filter(n => {
      const k = n.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .join(', ') || null;
};

const rawAuthor = pickFirst([
  authorFromValue(metaContent('author', 'name')),
  authorFromValue(metaContent('parsely-author', 'name')),
  authorFromValue(metaContent('dc.creator', 'name')),
  authorFromValue(metaContent('dc.creator', 'property')),
  authorFromValue(metaContent('article:author', 'property')),
]);

// Keep only the first author if multiple are present
const author = rawAuthor
  ? rawAuthor.split(',').map(s => s.trim()).find(Boolean) || null
  : null;


// ---------------- output ----------------
return [
  {
    json: {
      ...$json,
      title: title || $json.title || null,
      author: author || $json.author || null,
    },
  },
];
};
