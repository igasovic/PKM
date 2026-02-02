/**
 * Telegram Capture — Normalize (07)
 * PKM JSON note fast-path:
 * - capture_text = whole telegram message
 * - parse JSON (fenced ```json ... ```, or leading {...})
 * - clean_text = text after JSON block
 * - url/url_canonical forced null (no extraction)
 * - source=telegram, intent=think, content_type=note, author=null
 */
function getTelegramText(json) {
  // Try common n8n Telegram node shapes.
  return (
    json.message?.text ??
    json.message?.caption ??
    json.text ??
    json.body?.message?.text ??
    json.update?.message?.text ??
    ''
  );
}

function tryParseJsonString(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function extractFencedJsonBlock(text) {
  const re = /```json\s*([\s\S]*?)\s*```/i;
  const m = text.match(re);
  if (!m) return null;
  const jsonStr = m[1].trim();
  const obj = tryParseJsonString(jsonStr);
  if (!obj) return null;

  const after = text.slice(m.index + m[0].length).replace(/^\s+/, '');
  return { obj, jsonStr, after, rawBlock: m[0] };
}

/**
 * Extract a leading JSON object even if not fenced.
 * We only accept it if it begins near the start (ignoring whitespace),
 * and braces are balanced.
 */
function extractLeadingJsonObject(text) {
  const leading = text.replace(/^\s+/, '');
  if (!leading.startsWith('{')) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < leading.length; i++) {
    const ch = leading[i];

    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    } else {
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      if (depth === 0) {
        const jsonStr = leading.slice(0, i + 1).trim();
        const obj = tryParseJsonString(jsonStr);
        if (!obj) return null;

        const after = leading.slice(i + 1).replace(/^\s+/, '');
        return { obj, jsonStr, after, rawBlock: jsonStr };
      }
    }
  }
  return null;
}

function normalizeTopic(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  return t.length ? t : null;
}

function normalizeNumber01(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

const text = getTelegramText($json);
const fenced = extractFencedJsonBlock(text);
const leading = fenced ? null : extractLeadingJsonObject(text);

const parsed = fenced ?? leading;

if (parsed?.obj) {
  const j = parsed.obj;

  // Required behavior for PKM JSON note mode
  const title = j.title ?? null;
  const topic = normalizeTopic(j.topic) ?? null;

  const secondary_topic = normalizeTopic(j.secondary_topic) ?? null;
  const secondary_topic_confidence = normalizeNumber01(j.secondary_topic_confidence, null);

  const gist = j.gist ?? null;
  const excerpt = j.excerpt ?? null;

  const out = {
    // marker so downstream nodes can preserve fields
    _pkm_mode: 'pkm_json_note_v1',

    // pipeline core
    source: 'telegram',
    intent: 'think',
    content_type: 'note',
    author: null,

    // IMPORTANT: bypass URL extraction flow
    url: null,
    url_canonical: null,

    // store whole message
    capture_text: text,

    // store only text after the JSON block
    clean_text: parsed.after ?? '',

    // extracted vars
    title,
    topic,
    primary_topic_confidence: 1,
    secondary_topic,
    secondary_topic_confidence,
    gist,
    excerpt
  };

  return [{ json: out }];
}

// Fallback: no JSON detected -> keep existing behavior.
// If you already have legacy normalize logic below, keep it.
// Otherwise just pass-through:
return [{ json: { ...$json, capture_text: text } }];
