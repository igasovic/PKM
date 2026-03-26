'use strict';

function defaultMdv2Message(value) {
  return String(value === undefined || value === null ? '' : value).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function createContextPackBuilder(deps) {
  const mdv2Message = deps && typeof deps.mdv2Message === 'function'
    ? deps.mdv2Message
    : defaultMdv2Message;

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

    const distillSummary = pick(obj, ['distill_summary']);
    if (distillSummary) return snip(distillSummary, maxLen);

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
      url: pick(obj, ['url', 'url_canonical']) || '-',
      topic_primary: pick(obj, ['topic_primary']) || '-',
      topic_secondary: pick(obj, ['topic_secondary']) || '-',
      keywords: normalizeKeywords(pickAny(obj, ['keywords'])),
      why_it_matters: pick(obj, ['distill_why_it_matters']) || '-',
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
    const whyItMattersShareRaw = Number(options.whyItMattersShare);
    const whyItMattersShare = Number.isFinite(whyItMattersShareRaw)
      ? Math.min(1, Math.max(0, whyItMattersShareRaw))
      : 0.25;
    const layout = String(options.layout || (markdownV2 ? 'telegram' : 'ui')).toLowerCase();
    const rows = Array.isArray(items) ? items : [];
    const normalizedItems = rows
      .filter((row) => !(row && typeof row === 'object' && row.is_meta === true))
      .map((row) => toContextPackItem(row, { maxContentLen }));
    const whyItMattersCount = normalizedItems.length > 0
      ? Math.min(
        normalizedItems.length,
        Math.max(1, Math.round(normalizedItems.length * whyItMattersShare)),
      )
      : 0;

    const lines = [];
    if (layout === 'ui') {
      lines.push('## Context Pack');
      lines.push(`retrieval: ${buildRetrievalLine(meta)}`);
      lines.push('');
      normalizedItems.forEach((item, index) => {
        const keywords = item.keywords.length ? item.keywords.join(', ') : '-';
        const includeWhyItMatters = index < whyItMattersCount && item.why_it_matters !== '-';
        const contentText = String(item.content || '-');
        const contentLines = contentText.split('\n').map((part) => normWS(part)).filter(Boolean);
        const firstContentLine = contentLines[0] || '-';
        const restContentLine = contentLines.slice(1).join(' ');
        lines.push(`Entry ${item.entry_id} | ${item.content_type} | ${item.author} | ${item.title} | ${item.date}`);
        lines.push(`topic: ${item.topic_primary} -> ${item.topic_secondary}`);
        lines.push(`keywords: ${keywords}`);
        lines.push(`url: ${item.url || '-'}`);
        if (markdownV2) {
          const rendered = restContentLine
            ? `${BOLD_OPEN}${firstContentLine}${BOLD_CLOSE} ${restContentLine}`
            : `${BOLD_OPEN}${firstContentLine}${BOLD_CLOSE}`;
          lines.push(`content: ${rendered}`);
        } else {
          lines.push(`content: ${firstContentLine}${restContentLine ? ` ${restContentLine}` : ''}`);
        }
        if (includeWhyItMatters) {
          lines.push(`why_it_matters: ${item.why_it_matters}`);
        }
        lines.push('');
      });
      if (normalizedItems.length === 0) {
        lines.push('No matches');
      }
    } else {
      lines.push('CONTEXT PACK');
      lines.push(`Retrieval: ${buildRetrievalLine(meta)}`);
      lines.push('Top matches (most relevant first):');
      normalizedItems.forEach((item, index) => {
        const keywords = item.keywords.length ? item.keywords.join(', ') : '-';
        const includeWhyItMatters = index < whyItMattersCount && item.why_it_matters !== '-';
        const contentText = String(item.content || '-');
        const contentLines = contentText.split('\n').map((part) => normWS(part)).filter(Boolean);
        const firstContentLine = contentLines[0] || '-';
        const restContentLine = contentLines.slice(1).join(' ');
        lines.push(`- ${item.entry_id} | ${item.content_type} | ${item.author} | ${item.title} | ${item.date}`);
        lines.push(`  - Topic: ${item.topic_primary} -> ${item.topic_secondary}`);
        lines.push(`  - Keywords: ${keywords}`);
        if (markdownV2) {
          const rendered = restContentLine
            ? `${BOLD_OPEN}${firstContentLine}${BOLD_CLOSE} ${restContentLine}`
            : `${BOLD_OPEN}${firstContentLine}${BOLD_CLOSE}`;
          lines.push(`  - Content: ${rendered}`);
        } else {
          lines.push(`  - Content: ${firstContentLine}${restContentLine ? ` ${restContentLine}` : ''}`);
        }
        if (includeWhyItMatters) {
          lines.push(`  - Why it matters: ${item.why_it_matters}`);
        }
      });
      if (normalizedItems.length === 0) {
        lines.push('- (no matches)');
      }
      lines.push('END CONTEXT PACK');
    }

    const out = lines.join('\n').trim();
    if (!markdownV2) return out;
    return mdv2Message(out)
      .replaceAll(BOLD_OPEN, '*')
      .replaceAll(BOLD_CLOSE, '*');
  }

  return {
    buildContextPackMarkdown,
    deriveExcerptFromRecord,
    normWS,
    snip,
    toContextPackItem,
  };
}

const defaultApi = createContextPackBuilder();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = defaultApi;
  module.exports.default = defaultApi;
  module.exports.createContextPackBuilder = createContextPackBuilder;
}
if (typeof globalThis !== 'undefined') {
  globalThis.__pkmContextPackBuilder = defaultApi;
}
    const BOLD_OPEN = 'PKMCTXBOLDOPEN';
    const BOLD_CLOSE = 'PKMCTXBOLDCLOSE';
