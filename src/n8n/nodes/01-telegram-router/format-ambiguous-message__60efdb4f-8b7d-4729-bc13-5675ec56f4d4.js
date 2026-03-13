'use strict';

module.exports = async function run(ctx) {
  const { $json } = ctx;

  const asText = (value) => String(value === undefined || value === null ? '' : value).trim();

  const question = asText($json.clarification_question)
    || 'Do you want this saved as a calendar event or as a PKM note?';

  return [{
    json: {
      ...$json,
      telegram_chat_id: asText($json.telegram_chat_id || ($json.message && $json.message.chat && $json.message.chat.id)),
      telegram_message: question,
    },
  }];
};
