/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Read (read)
 * Node: Build Context Pack
 * Node ID: 3580c243-cd64-4bc2-8b4f-ab5215ff71a1
 *
 * Notes:
 * - Generated from workflow export for clean Git diffs.
 * - Keep return shape identical to original Code node.
 * - Sandbox: require() allowed (allowlisted); fs/process not available.
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

/**
 * Build Telegram Context Pack from Postgres UNION result:
 * - One meta row: is_meta=true
 * - N hit rows:  is_meta=false
 *
 * Expected meta fields:
 * - query_text, days, limit, hits
 * - cmd (optional; /find and /continue already include this in your SQL; /last may not)
 *
 * Expected hit fields:
 * - entry_id (bigint)
 * - id (uuid)
 * - created_at, source, intent
 * - url, url_canonical
 * - title
 * - text_len
 * - snippet
 *
 * Output:
 * - telegram_message (<= ~3500 chars safety cap)
 */

const rows = $input.all().map(i => i.json);

// meta row is always present
const meta = rows.find(r => r.is_meta === true) || {};

// cmd handling:
// - /find and /continue meta already include cmd in your SQL
// - /last meta currently does NOT; default to 'last'
const cmd = String(meta.cmd || 'last').toLowerCase();

const q = String(meta.query_text || '').trim();
const days = meta.days ?? '';
const limit = meta.limit ?? '';
const hits = meta.hits ?? 0;

// hit rows
const hitsRows = rows.filter(r => r.is_meta === false && r.id);

// No hits
if (!hitsRows.length) {
  const msg =
    `Context Pack — /${cmd}${q ? ` "${q}"` : ''}\n` +
    `Window: ${days}d | Limit: ${limit} | Hits: 0\n\n` +
    `No matches. Try a larger --days or broader terms.`;

  return [{ json: { telegram_message: msg } }];
}

const maxSnippet = 300;
const lines = [];

lines.push(`Context Pack — /${cmd}${q ? ` "${q}"` : ''}`);
lines.push(`Window: ${days}d | Limit: ${limit} | Hits: ${hits}`);
lines.push('');

// Render each hit
hitsRows.forEach((r, idx) => {
  const created = String(r.created_at).slice(0, 19).replace('T', ' ');
  const source = r.source || '';
  const intent = r.intent || '';
  const title = String(r.title || '').trim();
  const url = r.url_canonical || r.url || '';
  const textLen = Number(r.text_len || 0);

  const entryId = (r.entry_id === null || r.entry_id === undefined) ? '' : String(r.entry_id);

  let snippet = String(r.snippet || '').trim();
  if (snippet.length > maxSnippet) snippet = snippet.slice(0, maxSnippet - 1) + '…';

  // Header line includes WP2 entry_id for /pull
  // Example: "1) #12345 • 2026-01-26 04:56:56 • email • archive • 886 chars"
  const idPart = entryId ? `#${entryId} • ` : '';
  lines.push(`${idx + 1}) ${idPart}${created} • ${source}${intent ? ` • ${intent}` : ''} • ${textLen} chars`);

  if (title) lines.push(`Title: ${title}`);
  if (url) lines.push(`URL: ${url}`);
  if (snippet) lines.push(`Snippet: ${snippet}`);
  lines.push('');
});

let msg = lines.join('\n').trim();

// safety cap (Telegram hard limit is 4096; keep margin for safety)
const MAX_TELEGRAM = 3500;
if (msg.length > MAX_TELEGRAM) {
  msg = msg.slice(0, MAX_TELEGRAM - 1) + '…\n\n(Truncated — reduce --limit)';
}

return [{ json: { telegram_message: msg } }];
};
