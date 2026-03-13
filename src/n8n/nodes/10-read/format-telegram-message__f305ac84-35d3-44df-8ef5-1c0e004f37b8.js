/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Read (read)
 * Node: Format Telegram Message
 * Node ID: f305ac84-35d3-44df-8ef5-1c0e004f37b8
 *
 * Notes:
 * - Generated from workflow export for clean Git diffs.
 * - Keep return shape identical to original Code node.
 * - Sandbox: require() allowed (allowlisted); fs/process not available.
 */
'use strict';

const { getConfig } = require('/data/src/libs/config.js');

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

function s(v){ return (v ?? '').toString().trim(); }
function mdv2(v) {
  return String(v ?? '').replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

const entryId = s($json.entry_id);
const title = s($json.title);
const author = s($json.author);
const url = s($json.url);
const tp = s($json.topic_primary);
const ts = s($json.topic_secondary);
const gist = s($json.gist);

const wantExcerpt = $json.want_excerpt === true;

// From SQL builder
const excerptShort = s($json.excerpt);
const excerptLong = s($json.excerpt_long);
const clean = s($json.clean_text);

// Body selection:
// - default: clean_text if present else short excerpt
// - with --excerpt: prefer excerpt_long; fallback clean_text; fallback short excerpt
let body = '';
if (wantExcerpt) body = excerptLong || clean || excerptShort || '(no text)';
else body = clean || excerptShort || '(no text)';

// Build MarkdownV2-safe message
const lines = [];
lines.push(`*Entry* \\#${mdv2(entryId || '?')}`);
if (title) lines.push(`*Title* ${mdv2(title)}`);
if (author) lines.push(`*Author* ${mdv2(author)}`);
if (tp && ts) lines.push(`*Topic* ${mdv2(tp)} \\-> ${mdv2(ts)}`);
else if (tp) lines.push(`*Topic* ${mdv2(tp)}`);
if (url) lines.push(`*URL* ${mdv2(url)}`);
if (gist) lines.push(`\\n*Gist* ${mdv2(gist)}`);

lines.push(`\\n*Text*\\n${mdv2(body)}`);

let msg = lines.join('\n');

const config = getConfig();
if (config.db.is_test_mode === true) {
  msg = `*TEST MODE*\\n${msg}`;
}

// Telegram cap
const MAX = 4000;
if (msg.length > MAX) msg = msg.slice(0, MAX - 1) + '…';

return [{ json: { ...$json, telegram_message: msg } }];
};
