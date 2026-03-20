'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;
  const { mdv2Message } = require('@igasovic/n8n-blocks/shared/telegram-markdown.js');
  const mailbox = String($json?.stdout ?? 'empty');
  return [{ json: { ...$json, telegram_message: mdv2Message('Importing mailbox ' + mailbox) } }];
};
