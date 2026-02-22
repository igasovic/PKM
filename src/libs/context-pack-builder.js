'use strict';

function normWS(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function snip(value, maxLen) {
  const text = normWS(value);
  if (!text) return '';
  const cap = Number.isFinite(Number(maxLen)) ? Math.max(50, Number(maxLen)) : 800;
  if (text.length <= cap) return text;
  return `${text.slice(0, cap - 1)}…`;
}

function pick(obj, keys) {
  for (const key of keys) {
    const value = normWS(obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : '');
    if (value) return value;
  }
  return '';
}

function pickAny(obj, keys) {
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  }
  return null;
}

function escapeMarkdownV2(value) {
  return String(value || '').replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function shortDate(value) {
  const raw = normWS(value);
  if (!raw) return '-';
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return raw.slice(0, 10);
}

function normalizeKeywords(value) {
  if (Array.isArray(value)) {
    return value
      .map((v) => normWS(v))
      .filter(Boolean)
      .slice(0, 12);
  }
  if (value && typeof value === 'string') {
    return value
      .split(',')
      .map((v) => normWS(v))
      .filter(Boolean)
      .slice(0, 12);
  }
  return [];
}

function deriveExcerptFromRecord(record, opts) {
  const obj = record && typeof record === 'object' ? record : {};
  const options = opts || {};
  const maxLen = Number(options.maxLen || 800);
  const includeFallbackKeys = options.includeFallbackKeys !== false;

  const gist = pick(obj, ['gist']);
  if (gist) return snip(gist, maxLen);

  const retrievalExcerpt = pick(obj, ['retrieval_excerpt', 'excerpt']);
  if (retrievalExcerpt) return snip(retrievalExcerpt, maxLen);

  const snippet = pick(obj, ['snippet']);
  if (snippet) return snip(snippet, maxLen);

  const cleanText = pick(obj, ['clean_text']);
  if (cleanText) return snip(cleanText, maxLen);

  const captureText = pick(obj, ['capture_text']);
  if (captureText) return snip(captureText, maxLen);

  if (!includeFallbackKeys) return '';
  const keys = Object.keys(obj).sort();
  return keys.length > 0 ? `JSON keys: ${keys.join(', ')}` : 'No textual content';
}

function toContextPackItem(record, opts) {
  const obj = record && typeof record === 'object' ? record : {};
  const options = opts || {};
  const maxContentLen = Number(options.maxContentLen || 800);

  return {
    entry_id: pick(obj, ['entry_id', 'id']) || '-',
    content_type: pick(obj, ['content_type', 'intent', 'type']) || '-',
    author: pick(obj, ['author']) || '-',
    title: pick(obj, ['title']) || '-',
    date: shortDate(pick(obj, ['created_at', 'date'])),
    topic_primary: pick(obj, ['topic_primary']) || '-',
    topic_secondary: pick(obj, ['topic_secondary']) || '-',
    keywords: normalizeKeywords(pickAny(obj, ['keywords'])),
    content: deriveExcerptFromRecord(obj, {
      maxLen: maxContentLen,
      includeFallbackKeys: true,
    }) || '-',
  };
}

function buildRetrievalLine(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const method = normWS(m.method || m.operation || m.cmd) || '-';
  const query = normWS(m.query || m.q);
  const daysRaw = m.days;
  const limitRaw = m.limit;
  const days = daysRaw === null || daysRaw === undefined || daysRaw === '' ? 'default' : String(daysRaw);
  const limit = limitRaw === null || limitRaw === undefined || limitRaw === '' ? 'default' : String(limitRaw);
  const queryPart = query ? ` q="${query}"` : '';
  return `${method}${queryPart} | days=${days} | limit=${limit}`;
}

function buildContextPackMarkdown(items, meta, opts) {
  const options = opts || {};
  const markdownV2 = Boolean(options.markdownV2);
  const maxContentLen = Number(options.maxContentLen || 800);
  const rows = Array.isArray(items) ? items : [];
  const normalizedItems = rows.map((row) => toContextPackItem(row, { maxContentLen }));

  // Context pack template:
  // CONTEXT PACK
  // Retrieval: <method + query + time window>
  // Top matches (most relevant first):
  // - <entry_id> | <content type> | <Author> | <Title> | <date YYYY-MM-DD>
  //   - Topic: <primary topic> -> <secondary topic>
  //   - Keywords: <keyword1>, <keyword2>, ...
  //   - Content: <content>
  // END CONTEXT PACK
  const lines = [];
  lines.push('CONTEXT PACK');
  lines.push(`Retrieval: ${buildRetrievalLine(meta)}`);
  lines.push('Top matches (most relevant first):');

  normalizedItems.forEach((item) => {
    const keywords = item.keywords.length ? item.keywords.join(', ') : '-';
    lines.push(`- ${item.entry_id} | ${item.content_type} | ${item.author} | ${item.title} | ${item.date}`);
    lines.push(`  - Topic: ${item.topic_primary} -> ${item.topic_secondary}`);
    lines.push(`  - Keywords: ${keywords}`);
    lines.push(`  - Content: ${item.content}`);
  });

  if (normalizedItems.length === 0) {
    lines.push('- (no matches)');
  }
  lines.push('END CONTEXT PACK');

  const out = lines.join('\n');
  return markdownV2 ? escapeMarkdownV2(out) : out;
}

module.exports = {
  buildContextPackMarkdown,
  deriveExcerptFromRecord,
  escapeMarkdownV2,
  normWS,
  snip,
  toContextPackItem,
};
