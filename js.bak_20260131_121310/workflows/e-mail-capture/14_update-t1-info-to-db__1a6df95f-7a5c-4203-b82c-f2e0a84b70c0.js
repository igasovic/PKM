/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: E-Mail Capture (e-mail-capture)
 * Node: Update T1 Info to DB
 * Node ID: 1a6df95f-7a5c-4203-b82c-f2e0a84b70c0
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

// Update Info to DB (Tier-1): build UPDATE from $json.t1 (already parsed upstream)
// Pattern: output { ...$json, sql } then Postgres Execute Query runs {{$json.sql}}

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "''");
}
function lit(v) {
  return (v === null || v === undefined) ? 'NULL' : `'${esc(v)}'`;
}
function jsonbLit(obj) {
  if (obj === null || obj === undefined) return 'NULL';
  const s = JSON.stringify(obj).replace(/\\/g, '\\\\').replace(/'/g, "''");
  return `'${s}'::jsonb`;
}
function textArrayLit(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 'NULL';
  const items = arr
    .map(x => String(x ?? '').trim())
    .filter(Boolean)
    .map(x => `'${esc(x)}'`);
  if (items.length === 0) return 'NULL';
  return `ARRAY[${items.join(', ')}]::text[]`;
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// --- required identity ---
const id = $json.id;
if (!id) throw new Error('Tier-1 update: missing id (merge must include INSERT RETURNING id)');

// --- use parsed Tier-1 payload from previous node ---
const t1 = $json.t1;
if (!t1 || typeof t1 !== 'object') {
  throw new Error('Tier-1 update: missing $json.t1 (Parse Tier-1 node must run before this)');
}

// validate required fields (defensive)
const reqStr = (k) => typeof t1[k] === 'string' && t1[k].trim().length > 0;
if (!reqStr('topic_primary')) throw new Error('Tier-1 update: missing topic_primary');
if (!reqStr('topic_secondary')) throw new Error('Tier-1 update: missing topic_secondary');
if (!reqStr('gist')) throw new Error('Tier-1 update: missing gist');
if (!Array.isArray(t1.keywords)) throw new Error('Tier-1 update: keywords must be an array');

// normalize
const topic_primary = t1.topic_primary.trim();
const topic_secondary = t1.topic_secondary.trim();
const gist = t1.gist.trim();

let keywords = t1.keywords
  .map(x => String(x ?? '').trim())
  .filter(Boolean);

keywords = Array.from(new Set(keywords));
if (keywords.length < 5) throw new Error('Tier-1 update: keywords must have at least 5 items');
if (keywords.length > 12) keywords = keywords.slice(0, 12);

// confidences optional
const topic_primary_confidence =
  (typeof t1.topic_primary_confidence === 'number') ? clamp01(t1.topic_primary_confidence) : null;
const topic_secondary_confidence =
  (typeof t1.topic_secondary_confidence === 'number') ? clamp01(t1.topic_secondary_confidence) : null;

// optional instrumentation fields
const enrichment_model = $json.enrichment_model ?? 'gpt-5-nano';
const prompt_version = $json.prompt_version ?? 'v1';
const saveRaw = true;

// build SQL
const sql = `
UPDATE pkm.entries
SET
  topic_primary = ${lit(topic_primary)}::text,
  topic_primary_confidence = ${topic_primary_confidence === null ? 'NULL' : Number(topic_primary_confidence)},
  topic_secondary = ${lit(topic_secondary)}::text,
  topic_secondary_confidence = ${topic_secondary_confidence === null ? 'NULL' : Number(topic_secondary_confidence)},
  keywords = ${textArrayLit(keywords)},
  gist = ${lit(gist)}::text,
  enrichment_status = 'done',
  enrichment_model = ${lit(enrichment_model)}::text,
  prompt_version = ${lit(prompt_version)}::text,

  metadata = CASE
    WHEN ${saveRaw ? 'true' : 'false'} THEN
      jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{t1_raw}',
        ${jsonbLit(t1)},
        true
      )
    ELSE metadata
  END

WHERE id = ${lit(id)}::uuid
RETURNING
  entry_id,
  id,
  created_at,
  source,
  intent,
  content_type,
  COALESCE(title,'') AS title,
  COALESCE(author,'') AS author,
  COALESCE(url_canonical,'') AS url_canonical,
  topic_primary,
  topic_secondary,
  gist,
  clean_text,
  array_length(keywords,1) AS kw_count,
  enrichment_status;
`.trim();

return [{ json: { ...$json, sql } }];
};
