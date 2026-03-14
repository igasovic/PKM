'use strict';

const {
  runRoutingGraph,
  runRoutingGraphWithTrace,
} = require('./telegram-router/routing.graph.js');
const {
  runCalendarExtractionGraph,
  runCalendarExtractionGraphWithTrace,
} = require('./calendar/extraction.graph.js');
const {
  listMissingFieldsMessage,
  normalizeCalendarRequestDeterministic,
  mergeTextWithClarificationTurns,
  buildDeterministicDraft,
} = require('./calendar/deterministic-extractor.js');

async function routeTelegramInput(input, options) {
  const result = await runRoutingGraph(input, options);
  if (!result || !result.route) {
    throw new Error('routing graph returned empty result');
  }
  return result;
}

async function routeTelegramInputWithTrace(input, options) {
  const out = await runRoutingGraphWithTrace(input, options);
  if (!out || !out.result || !out.result.route) {
    throw new Error('routing graph returned empty result');
  }
  return out;
}

async function normalizeCalendarRequest(input, options) {
  const result = await runCalendarExtractionGraph(input, options);
  if (!result || !result.status) {
    throw new Error('calendar extraction graph returned empty result');
  }
  return result;
}

async function normalizeCalendarRequestWithTrace(input, options) {
  const out = await runCalendarExtractionGraphWithTrace(input, options);
  if (!out || !out.result || !out.result.status) {
    throw new Error('calendar extraction graph returned empty result');
  }
  return out;
}

module.exports = {
  routeTelegramInput,
  routeTelegramInputWithTrace,
  normalizeCalendarRequest,
  normalizeCalendarRequestWithTrace,
  normalizeCalendarRequestDeterministic,
  buildDeterministicDraft,
  mergeTextWithClarificationTurns,
  listMissingFieldsMessage,
};
