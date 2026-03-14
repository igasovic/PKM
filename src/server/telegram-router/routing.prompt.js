'use strict';

function text(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function buildRoutingSystemPrompt() {
  return [
    'You route Telegram messages for a PKM + family calendar assistant.',
    'Return ONLY valid JSON (no markdown).',
    'Classify into exactly one route: pkm_capture, calendar_create, calendar_query, ambiguous.',
    'Use ambiguous when the user intent is unclear between note capture and calendar actions.',
    'For calendar_query, user is asking to view/list schedule/events (today/tomorrow/weekday/etc).',
    'For calendar_create, user is requesting to create/schedule/remind about an event.',
    'For pkm_capture, user is writing a note/thought/link to save, not asking calendar operations.',
    'JSON schema:',
    '{"route":"pkm_capture|calendar_create|calendar_query|ambiguous","confidence":0..1,"clarification_question":string|null}',
  ].join('\n');
}

function buildRoutingUserPrompt(input) {
  const rawText = text(input && (input.text || input.raw_text || input.message_text));
  return [
    'Classify this Telegram message.',
    `message: ${JSON.stringify(rawText)}`,
    'If route is ambiguous, include a concise clarification_question asking whether to save as note or add/read calendar.',
  ].join('\n');
}

module.exports = {
  buildRoutingSystemPrompt,
  buildRoutingUserPrompt,
};
