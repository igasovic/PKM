'use strict';

module.exports = async function run(ctx) {
  const { $json = {} } = ctx || {};
  const asText = (value) => String(value === undefined || value === null ? '' : value).trim();

  const message = ($json && $json.message) || {};
  const rawTextInput = asText($json.raw_text || message.text || message.caption || '');
  const rawText = rawTextInput.replace(/^cal:\s*/i, '').trim();
  const chatId = asText($json.telegram_chat_id || (message.chat && message.chat.id));
  const messageId = asText($json.telegram_message_id || message.message_id);
  const actorCode = asText($json.actor_code).toLowerCase() || 'unknown';
  const userId = asText($json.telegram_user_id || (message.from && message.from.id));

  if (!rawText) throw new Error('calendar create requires raw_text');
  if (!chatId) throw new Error('calendar create requires telegram_chat_id');
  if (!messageId) throw new Error('calendar create requires telegram_message_id');

  return [{
    json: {
      ...$json,
      raw_text: rawText,
      actor_code: actorCode,
      source: {
        chat_id: chatId,
        message_id: messageId,
        user_id: userId || null,
      },
      request_id: asText($json.request_id) || null,
      telegram_user_id: userId || null,
      route_confidence: Number.isFinite(Number($json.confidence)) ? Number($json.confidence) : null,
      family_calendar_id: asText($json.family_calendar_id || ($json.config && $json.config.calendar && $json.config.calendar.family_calendar_id)) || null,
    },
  }];
};

