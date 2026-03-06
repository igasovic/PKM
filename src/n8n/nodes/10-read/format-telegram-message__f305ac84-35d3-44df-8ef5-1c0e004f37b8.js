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

const { getConfig } = require('../../../src/libs/config.js');

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

function s(v){ return (v ?? '').toString().trim(); }

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

// Build message
const lines = [];
lines.push(`🧾 #${entryId || '?'}`);
if (title) lines.push(`📰 ${title}`);
if (author) lines.push(`🗣️ ${author}`);
if (tp && ts) lines.push(`🏷️ ${tp} → ${ts}`);
else if (tp) lines.push(`🏷️ ${tp}`);
if (url) lines.push(`🔗 ${url}`);
if (gist) lines.push(`\n_${gist}_`);

lines.push(`\n${body}`);

let msg = lines.join('\n');

const config = getConfig();
if (config.db.is_test_mode === true) {
  msg = `⚗️🧪 TEST MODE
${msg}`;
}

// Telegram cap
const MAX = 4000;
if (msg.length > MAX) msg = msg.slice(0, MAX - 1) + '…';

return [{ json: { ...$json, telegram_message: msg } }];
};
