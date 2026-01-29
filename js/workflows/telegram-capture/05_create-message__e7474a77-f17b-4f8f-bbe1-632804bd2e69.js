/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Telegram Capture (telegram-capture)
 * Node: Create Message
 * Node ID: e7474a77-f17b-4f8f-bbe1-632804bd2e69
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

const entryId = ($json.entry_id ?? '').toString().trim();

const url = String($json.url_canonical || $json.url || '').trim();
const title = String($json.title || '').trim();
const author = String($json.author || '').trim();
const cleanLen = Number($json.clean_len || 0);

const labelBase = title || 'link';
const label = author ? `${labelBase} — ${author}` : labelBase;

// Determine status purely from extracted length
let status = 'failed';
if (cleanLen > 0) status = cleanLen < 500 ? 'low_quality' : 'ok';

let msg;
const idLine = entryId ? ` (#${entryId})` : '';

if (status === 'ok') {
  msg = `✅ Saved${idLine}: ${label} (${cleanLen} chars)\n${url}`;
} else if (status === 'low_quality') {
  msg = `⚠️ Saved (low quality)${idLine}: ${label} (${cleanLen} chars)\n${url}`;
} else {
  msg = `❌ Saved (extraction failed)${idLine}: ${labelBase}\n${url}`;
}

// hard cap for Telegram
const MAX = 4000;
if (msg.length > MAX) msg = msg.slice(0, MAX - 1) + '…';

return [{ json: { ...$json, telegram_message: msg } }];
};
