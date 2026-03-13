'use strict';

module.exports = async function run(ctx) {
  const { $json } = ctx;
  const asText = (value) => String(value === undefined || value === null ? '' : value).trim();

  const message = ($json && $json.message) || ($json && $json.edited_message) || {};
  const rawText = asText($json.raw_text || message.text || message.caption || '');

  const telegramChatId = asText($json.telegram_chat_id || (message.chat && message.chat.id));
  const telegramMessageId = asText($json.telegram_message_id || message.message_id);
  const telegramUserId = asText($json.telegram_user_id || (message.from && message.from.id));
  const username = asText($json.telegram_username || (message.from && message.from.username));
  const firstName = asText($json.telegram_first_name || (message.from && message.from.first_name));

  let actorCode = asText($json.actor_code).toLowerCase();
  if (!actorCode) {
    const hint = `${username} ${firstName}`.toLowerCase();
    if (hint.includes('igor')) actorCode = 'igor';
    else if (hint.includes('danij')) actorCode = 'danijela';
    else actorCode = 'unknown';
  }

  let routeHint = 'backend_route';
  if (/^cal:\s*/i.test(rawText)) routeHint = 'calendar_create';

  return [{
    json: {
      ...$json,
      message,
      raw_text: rawText,
      telegram_chat_id: telegramChatId,
      telegram_message_id: telegramMessageId,
      telegram_user_id: telegramUserId,
      telegram_username: username || null,
      actor_code: actorCode,
      is_command: rawText.startsWith('/'),
      route_hint: routeHint,
    },
  }];
};
