'use strict';

const ALLOWED_ROUTES = new Set([
  'pkm_capture',
  'calendar_create',
  'calendar_query',
  'recipe_search',
  'ambiguous',
]);

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
  if (!s) throw new Error('routing parse: model output is empty');

  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }

  return JSON.parse(s);
}

function parseRoutingLlmResult(raw) {
  const parsed = extractJsonObject(raw);
  const route = text(parsed && parsed.route).toLowerCase();

  if (!ALLOWED_ROUTES.has(route)) {
    throw new Error(`routing parse: invalid route "${route || 'unknown'}"`);
  }

  let clarificationQuestion = null;
  if (route === 'ambiguous') {
    clarificationQuestion = text(parsed && parsed.clarification_question)
      || 'Should I save this as a note or add it to the family calendar?';
  }

  let recipeQuery = null;
  if (route === 'recipe_search') {
    recipeQuery = text(parsed && (parsed.recipe_query || parsed.query)) || null;
  }

  return {
    route,
    confidence: clamp01(parsed && parsed.confidence, route === 'ambiguous' ? 0.5 : 0.7),
    clarification_question: clarificationQuestion,
    recipe_query: recipeQuery,
  };
}

module.exports = {
  parseRoutingLlmResult,
};
