'use strict';

const {
  TASK_SHAPES,
  asText,
  parseConfidence,
} = require('./constants.js');

function parseNormalizationLlmResult(rawText) {
  const text = asText(rawText);
  if (!text) {
    throw new Error('todoist normalization parse: empty response');
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`todoist normalization parse: invalid JSON (${err.message})`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('todoist normalization parse: expected object');
  }

  const normalized_title_en = asText(parsed.normalized_title_en);
  const task_shape = asText(parsed.task_shape).toLowerCase();
  const suggested_next_action = asText(parsed.suggested_next_action) || null;
  const parse_confidence = parseConfidence(parsed.parse_confidence, NaN);

  if (!normalized_title_en) {
    throw new Error('todoist normalization parse: normalized_title_en is required');
  }
  if (!TASK_SHAPES.has(task_shape)) {
    throw new Error(`todoist normalization parse: invalid task_shape ${task_shape || '(missing)'}`);
  }
  if (!Number.isFinite(parse_confidence)) {
    throw new Error('todoist normalization parse: parse_confidence must be a number');
  }

  return {
    normalized_title_en,
    task_shape,
    suggested_next_action,
    parse_confidence,
  };
}

function buildFallbackNormalization(input, reason) {
  return {
    normalized_title_en: asText(input && input.raw_title),
    task_shape: 'unknown',
    suggested_next_action: null,
    parse_confidence: 0,
    parse_failed: true,
    parse_failure_reason: asText(reason) || 'fallback',
  };
}

function cleanupNormalization(input, parsed) {
  const fallback = buildFallbackNormalization(input, null);
  if (!parsed || typeof parsed !== 'object') return fallback;

  const normalized_title_en = asText(parsed.normalized_title_en) || fallback.normalized_title_en;
  const task_shape = TASK_SHAPES.has(asText(parsed.task_shape).toLowerCase())
    ? asText(parsed.task_shape).toLowerCase()
    : 'unknown';
  const suggested_next_action = asText(parsed.suggested_next_action) || null;
  const parse_confidence = parseConfidence(parsed.parse_confidence, 0);

  return {
    normalized_title_en,
    task_shape,
    suggested_next_action,
    parse_confidence,
    parse_failed: task_shape === 'unknown' && parse_confidence === 0,
    parse_failure_reason: null,
  };
}

module.exports = {
  parseNormalizationLlmResult,
  buildFallbackNormalization,
  cleanupNormalization,
};
