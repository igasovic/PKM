'use strict';

const {
  asText,
  parseBoolean,
  parseConfidence,
  detectExplicitProjectSignal,
} = require('../constants.js');
const { runTodoistLlmAgent } = require('./runner.js');
const {
  parseNormalizationLlmResult,
  buildFallbackNormalization,
  cleanupNormalization,
} = require('../normalization.schema.js');
const {
  buildNormalizationSystemPrompt,
  buildNormalizationUserPrompt,
} = require('../normalization.prompt.js');

const NORMALIZE_TASK_AGENT_ID = 'todoist.normalize_task';
const NORMALIZE_TASK_AGENT_VERSION = 'v1';

function normalizeFewShotExamples(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => row && typeof row === 'object');
}

function hasCommaProjectEvidence(rawTitle) {
  const text = asText(rawTitle);
  if (!text || !text.includes(',')) return false;
  const segments = text
    .split(',')
    .map((seg) => asText(seg))
    .filter(Boolean);
  return segments.length >= 3;
}

function hasProjectEvidence(input) {
  if (!input || typeof input !== 'object') return false;
  if (input.explicit_project_signal === true) return true;
  if (input.has_subtasks === true) return true;
  if (hasCommaProjectEvidence(input.raw_title)) return true;
  if (/(\-\>|\u2192|=>)/.test(asText(input.raw_title))) return true;
  return false;
}

function hasFollowUpEvidence(input) {
  if (!input || typeof input !== 'object') return false;
  const title = asText(input.raw_title).toLowerCase();
  const desc = asText(input.raw_description).toLowerCase();
  const text = `${title} ${desc}`.trim();
  if (!text) return false;

  if (/\b(follow\s*up|follow-up|wait(?:ing)?\s+for|remind|ping)\b/.test(text)) return true;
  if (/\b(ask|write|email|message|check|confirm|call|text|contact)\b.{0,24}\b(with|to|from)\b/.test(text)) return true;
  if (/\b(pisati|proveriti|potvrditi|zvati|cekati|čekati)\b.{0,24}\b(sa|s|od)\b/.test(text)) return true;
  if (/\b(zvati|pozvati)\b.{0,40}\b(proveriti|provjeriti)\b/.test(text)) return true;
  return false;
}

function looksActionable(input) {
  if (!input || typeof input !== 'object') return false;
  const title = asText(input.raw_title);
  const text = title.toLowerCase();
  if (!text) return false;
  if (text.includes('?')) return false;
  if (/^(note|idea|someday|maybe|thought)\b/.test(text)) return false;

  return /\b(make|do|buy|book|call|write|email|message|send|check|confirm|review|replace|set up|install|return|pay|get|look|go|clean|mow|fix|prepare|create|update|sort|arrange|plan|schedule|take)\b/.test(text)
    || /\b(kupiti|uraditi|proveriti|pisati|javiti|vratiti|srediti|namestiti|namjestiti|pogledati|pokositi|zvati|otici|otići|napraviti|uzeti)\b/.test(text);
}

function applyDeterministicShapeRules(input, parsed) {
  const base = parsed && typeof parsed === 'object'
    ? { ...parsed }
    : buildFallbackNormalization(input, 'invalid_agent_output');

  const projectEvidence = hasProjectEvidence(input);
  if (projectEvidence) {
    return {
      ...base,
      task_shape: 'project',
      parse_confidence: Math.max(parseConfidence(base.parse_confidence, 0), 0.9),
      parse_failed: false,
      parse_failure_reason: null,
    };
  }

  if (asText(base.task_shape).toLowerCase() === 'project') {
    return {
      ...base,
      task_shape: 'next_action',
      parse_confidence: Math.min(Math.max(parseConfidence(base.parse_confidence, 0), 0.7), 0.89),
      parse_failed: false,
      parse_failure_reason: null,
    };
  }

  if (hasFollowUpEvidence(input)) {
    return {
      ...base,
      task_shape: 'follow_up',
      parse_confidence: Math.max(parseConfidence(base.parse_confidence, 0), 0.85),
      parse_failed: false,
      parse_failure_reason: null,
    };
  }

  if (asText(base.task_shape).toLowerCase() === 'unknown' && looksActionable(input)) {
    return {
      ...base,
      task_shape: 'next_action',
      parse_confidence: Math.max(parseConfidence(base.parse_confidence, 0), 0.7),
      parse_failed: false,
      parse_failure_reason: null,
    };
  }

  return base;
}

function normalizeTaskInput(input) {
  const rawTitle = asText(input && input.raw_title);
  if (!rawTitle) {
    throw new Error('raw_title is required');
  }
  return {
    raw_title: rawTitle,
    raw_description: asText(input && input.raw_description) || null,
    project_key: asText(input && input.project_key) || null,
    todoist_section_name: asText(input && input.todoist_section_name) || null,
    lifecycle_status: asText(input && input.lifecycle_status) || 'open',
    has_subtasks: parseBoolean(input && input.has_subtasks, false),
    explicit_project_signal: parseBoolean(
      input && input.explicit_project_signal,
      detectExplicitProjectSignal(rawTitle)
    ),
    few_shot_examples: normalizeFewShotExamples(input && input.few_shot_examples),
  };
}

async function runNormalizeTaskAgent(input, options = {}) {
  const normalizedInput = normalizeTaskInput(input);
  const run = await runTodoistLlmAgent({
    agent_id: NORMALIZE_TASK_AGENT_ID,
    version: NORMALIZE_TASK_AGENT_VERSION,
    stage: 'normalize',
    model: 'pkm-default',
    build_prompt: (ctx) => ({
      system: buildNormalizationSystemPrompt(),
      user: buildNormalizationUserPrompt(ctx),
    }),
    parse_response: (responseText, ctx) => cleanupNormalization(
      ctx,
      parseNormalizationLlmResult(responseText),
    ),
    fallback: ({ input: ctx, reason }) => buildFallbackNormalization(ctx, reason),
  }, normalizedInput, options);

  const llmResult = run && run.output
    ? run.output
    : buildFallbackNormalization(normalizedInput, 'missing_agent_output');
  const result = applyDeterministicShapeRules(normalizedInput, llmResult);

  return {
    result,
    trace: {
      ...(run && run.trace ? run.trace : {}),
      parse_failed: result.parse_failed === true,
      task_shape: asText(result.task_shape) || null,
      parse_confidence: Number.isFinite(Number(result.parse_confidence))
        ? Number(result.parse_confidence)
        : null,
    },
  };
}

module.exports = {
  NORMALIZE_TASK_AGENT_ID,
  NORMALIZE_TASK_AGENT_VERSION,
  runNormalizeTaskAgent,
};
