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

const { getConfig } = require('igasovic-n8n-blocks/shared/config.js');
const { mdv2, bold, kv, arrow, joinLines, finalizeMarkdownV2 } = require('igasovic-n8n-blocks/shared/telegram-markdown.js');

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

const lines = [];
lines.push(kv('Entry', `#${entryId || '?'}`));
if (title) lines.push(kv('Title', title));
if (author) lines.push(kv('Author', author));
if (tp && ts) lines.push(`${bold('Topic')} ${arrow(tp, ts)}`);
else if (tp) lines.push(kv('Topic', tp));
if (url) lines.push(kv('URL', url));
if (gist) lines.push('', bold('Gist'), mdv2(gist));
lines.push('', bold('Text'), mdv2(body));

let msg = joinLines(lines, { trimTrailing: true });

const config = getConfig();
if (config.db.is_test_mode === true) {
  msg = joinLines([bold('TEST MODE'), msg], { trimTrailing: true });
}

msg = finalizeMarkdownV2(msg, { maxLen: 4000 });

return [{ json: { ...$json, telegram_message: msg } }];
};
