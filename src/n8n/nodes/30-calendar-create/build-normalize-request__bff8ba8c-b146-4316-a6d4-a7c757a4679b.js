'use strict';

module.exports = async function run(ctx) {
  const { $json } = ctx;
  const asText = (value) => String(value === undefined || value === null ? '' : value).trim();

  const message = ($json && $json.message) || {};
  const rawTextInput = asText($json.raw_text || message.text || message.caption || '');
  const rawText = rawTextInput.replace(/^cal:\s*/i, '').trim();
  const chatId = asText($json.telegram_chat_id || (message.chat && message.chat.id));
  const messageId = asText($json.telegram_message_id || message.message_id);
  const actorCode = asText($json.actor_code).toLowerCase() || 'unknown';
  const userId = asText($json.telegram_user_id || (message.from && message.from.id));
  const smokeMode = $json.smoke_mode === true;
  const calendarTestMode = $json.calendar_test_mode === true;
  const testRunId = asText($json.test_run_id);
  const explicitTestCalendarId = asText($json.test_calendar_id || ($json.config && $json.config.calendar && $json.config.calendar.test_calendar_id));
  const explicitProdCalendarId = asText($json.prod_calendar_id || ($json.config && $json.config.calendar && $json.config.calendar.family_calendar_id));
  const configuredCalendarId = asText($json.family_calendar_id || ($json.config && $json.config.calendar && $json.config.calendar.family_calendar_id));

  if (!rawText) throw new Error('calendar create requires raw_text');
  if (!chatId) throw new Error('calendar create requires telegram_chat_id');
  if (!messageId) throw new Error('calendar create requires telegram_message_id');

  if (calendarTestMode) {
    if (!explicitTestCalendarId) throw new Error('calendar_test_mode requires test_calendar_id');
    if (!explicitProdCalendarId) throw new Error('calendar_test_mode requires prod_calendar_id');
    if (explicitTestCalendarId === explicitProdCalendarId) {
      throw new Error('calendar_test_mode blocked: test_calendar_id must differ from prod_calendar_id');
    }
  }

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
      smoke_mode: smokeMode,
      test_run_id: testRunId || null,
      calendar_test_mode: calendarTestMode,
      test_calendar_id: explicitTestCalendarId || null,
      prod_calendar_id: explicitProdCalendarId || null,
      family_calendar_id: calendarTestMode ? explicitTestCalendarId : configuredCalendarId || null,
    },
  }];
};
