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
 * Extract the first valid JSON object in the message by scanning for '{'
 * and attempting a balanced-brace parse.
 *
 * Safety:
 * - Only accepts parsed JSON if it contains required keys: title + topic
 * - Scans up to MAX_SCAN_CHARS to avoid O(n^2) on huge messages
 * - Tries up to MAX_CANDIDATES brace-start positions
 */
function extractLeadingJsonObject(text) {
  const hay = String(text || '');
  const MAX_SCAN_CHARS = 12000;     // plenty for long notes
  const MAX_CANDIDATES = 30;        // prevents pathological cases
  const scan = hay.slice(0, MAX_SCAN_CHARS);

  const requiredKeysPresent = (obj) =>
    obj && typeof obj === 'object' &&
    typeof obj.title === 'string' && obj.title.trim().length > 0 &&
    typeof obj.topic === 'string' && obj.topic.trim().length > 0;

  let candidatesTried = 0;
  let startIdx = scan.indexOf('{');

  while (startIdx !== -1 && candidatesTried < MAX_CANDIDATES) {
    candidatesTried++;

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
            let after = hay.slice(startIdx + i + 1).replace(/^\s+/, '');
            // If you *do* ever include END as a literal marker, strip it:
            after = after.replace(/\n?\s*END\s*$/i, '').replace(/^\s+/, '');

            return { obj, jsonStr, after, rawBlock: jsonStr };
          }

          // Not our JSON object; break and continue scanning for the next '{'
          break;
        }
      }
    }

    startIdx = scan.indexOf('{', startIdx + 1);
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
