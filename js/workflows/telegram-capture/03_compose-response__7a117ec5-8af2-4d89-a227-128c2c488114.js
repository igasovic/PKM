/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Telegram Capture (telegram-capture)
 * Node: Compose Response
 * Node ID: 7a117ec5-8af2-4d89-a227-128c2c488114
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

const config = $items('PKM Config')[0].json.config;
const isTestMode = !!(config && config.db && config.db.is_test_mode);


const entryId = ($json.entry_id ?? '').toString().trim();

const text = String($json.capture_text || '').trim();
const textLen = $json.text_len;

// short preview to avoid spam
const previewMax = 240;
const preview =
  textLen > previewMax
    ? text.slice(0, previewMax - 1) + '…'
    : text;

let msg =
  `🧠 Thought saved` +
  (entryId ? ` (#${entryId})` : ``) +
  ` (${textLen} chars)\n` +
  `${preview}`;

if (isTestMode) msg = `⚗️🧪 TEST MODE\n` + msg;

// hard cap for Telegram
const MAX = 4000;
if (msg.length > MAX) msg = msg.slice(0, MAX - 1) + '…';

return [{ json: { ...$json, telegram_message: msg } }];
};
