'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;
  const { mdv2Message } = require('@igasovic/n8n-blocks/shared/telegram-markdown.js');
  const entryId = String($json.entry_id ?? 'unknown').trim() || 'unknown';
  const action = String($json.action ?? 'inserted').trim() || 'inserted';
  const text = 'Thought saved as entry ' + entryId + ' operation ' + action;
  return [{ json: { ...$json, telegram_message: mdv2Message(text) } }];
};
