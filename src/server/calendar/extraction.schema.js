'use strict';

function text(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function clamp01(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function extractJsonObject(raw) {
  let s = text(raw);
  if (!s) throw new Error('calendar extraction parse: model output is empty');

  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }

  return JSON.parse(s);
}

function pick(source, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      return source[key];
    }
  }
  return undefined;
}

function asNullableString(value) {
  const s = text(value);
  return s || null;
}

function asNullableInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const v = Math.trunc(n);
  if (v <= 0) return null;
  return v;
}

function normalizePeople(value) {
  if (Array.isArray(value)) {
    return value.map((v) => text(v)).filter(Boolean);
  }
  const s = text(value);
  if (!s) return [];
  return s
    .split(/[,;\s]+/)
    .map((part) => text(part))
    .filter(Boolean);
}

function parseExtractionLlmResult(raw) {
  const parsed = extractJsonObject(raw);
  const source = (
    parsed &&
    typeof parsed === 'object' &&
    parsed.event &&
    typeof parsed.event === 'object'
  )
    ? parsed.event
    : (
      parsed &&
      typeof parsed === 'object' &&
      parsed.normalized_event &&
      typeof parsed.normalized_event === 'object'
    )
      ? parsed.normalized_event
      : parsed;

  if (!source || typeof source !== 'object') {
    throw new Error('calendar extraction parse: expected JSON object');
  }

  const categoryRaw = asNullableString(pick(source, ['category_code', 'category']));
  const peopleRaw = pick(source, ['people_codes', 'people']);
  const clarificationQuestion = asNullableString(
    pick(source, ['clarification_question', 'question'])
  );

  return {
    title: asNullableString(pick(source, ['title', 'name', 'subject'])),
    date_local: asNullableString(pick(source, ['date_local', 'date'])),
    start_time_local: asNullableString(pick(source, ['start_time_local', 'start_time'])),
    end_date_local: asNullableString(pick(source, ['end_date_local', 'end_date'])),
    end_time_local: asNullableString(pick(source, ['end_time_local', 'end_time'])),
    duration_minutes: asNullableInteger(pick(source, ['duration_minutes', 'duration'])),
    people_codes: normalizePeople(peopleRaw),
    category_code: categoryRaw ? categoryRaw.toUpperCase() : null,
    location: asNullableString(pick(source, ['location', 'place'])),
    confidence: clamp01(pick(source, ['confidence']), 0.5),
    clarification_question: clarificationQuestion,
  };
}

module.exports = {
  parseExtractionLlmResult,
};
