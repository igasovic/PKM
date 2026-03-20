'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;
  const { mdv2Message } = require('@igasovic/n8n-blocks/shared/telegram-markdown.js');
  const asText = (value) => String(value === undefined || value === null ? '' : value).trim();
  const status = asText($json.status);
  const chatId = asText($json.telegram_chat_id || ($json.message && $json.message.chat && $json.message.chat.id));
  
  let text = '';
  if (status === 'needs_clarification') {
    text = asText($json.clarification_question) || 'I need a bit more detail before creating this event.';
  } else if (status === 'rejected') {
    text = asText($json.message) || 'This request is not supported in the current calendar flow.';
  } else {
    text = 'Calendar request status updated.';
  }
  
  return [{ json: { ...$json, telegram_chat_id: chatId, telegram_message: mdv2Message(text) } }];
};
