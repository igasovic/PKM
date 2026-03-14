'use strict';

function text(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function buildPeopleAliasMap(config) {
  const map = config && config.people && config.people.map ? config.people.map : {};
  const entries = Object.entries(map)
    .map(([alias, row]) => {
      const code = text(row && row.code);
      if (!code) return null;
      return `${alias}=>${code}`;
    })
    .filter(Boolean)
    .sort();
  return entries.join(', ');
}

function buildExtractionSystemPrompt(ctx) {
  const options = ctx && typeof ctx === 'object' ? ctx : {};
  const timezone = text(options.timezone || 'America/Chicago');
  const peopleCodes = Array.isArray(options.people_codes) ? options.people_codes : [];
  const categories = Array.isArray(options.category_codes) ? options.category_codes : [];
  const peopleAliasMap = text(options.people_alias_map);

  return [
    'You extract family calendar events from Telegram text.',
    'Return ONLY valid JSON with no markdown and no extra text.',
    `timezone: ${timezone}`,
    `allowed_people_codes: ${JSON.stringify(peopleCodes)}`,
    `allowed_category_codes: ${JSON.stringify(categories)}`,
    `people_alias_to_code: ${JSON.stringify(peopleAliasMap)}`,
    'Schema:',
    '{"title":string|null,"date_local":"YYYY-MM-DD"|null,"start_time_local":"HH:MM"|null,"end_date_local":"YYYY-MM-DD"|null,"end_time_local":"HH:MM"|null,"duration_minutes":number|null,"people_codes":string[]|null,"category_code":string|null,"location":string|null,"clarification_question":string|null,"confidence":0..1}',
    'Prefer null over guessing when unknown.',
  ].join('\n');
}

function buildExtractionUserPrompt(input) {
  const data = input && typeof input === 'object' ? input : {};
  const clarificationTurns = Array.isArray(data.clarification_turns)
    ? data.clarification_turns
    : [];
  const normalizedTurns = clarificationTurns
    .map((turn) => ({
      question_text: text(turn && turn.question_text) || null,
      answer_text: text(turn && turn.answer_text) || null,
    }))
    .filter((turn) => turn.question_text || turn.answer_text);

  return [
    'Extract event fields from this request.',
    `today_local: ${JSON.stringify(text(data.today_local))}`,
    `raw_text: ${JSON.stringify(text(data.raw_text))}`,
    `clarification_turns: ${JSON.stringify(normalizedTurns)}`,
  ].join('\n');
}

function buildPromptContext(config, input) {
  const calendarConfig = config && typeof config === 'object' ? config : {};
  const peopleMap = calendarConfig.people && calendarConfig.people.map ? calendarConfig.people.map : {};
  const order = Array.isArray(calendarConfig.people && calendarConfig.people.order)
    ? calendarConfig.people.order
    : [];
  const categoryCodes = Object.keys(calendarConfig.categories || {}).sort();

  return {
    timezone: text(input && input.timezone) || text(calendarConfig.timezone) || 'America/Chicago',
    people_codes: order.length ? order : Array.from(new Set(
      Object.values(peopleMap).map((row) => text(row && row.code)).filter(Boolean)
    )).sort(),
    category_codes: categoryCodes,
    people_alias_map: buildPeopleAliasMap(calendarConfig),
  };
}

module.exports = {
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
  buildPromptContext,
};
