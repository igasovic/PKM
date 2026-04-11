'use strict';

const { asText } = require('../constants.js');
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

  const result = run && run.output
    ? run.output
    : buildFallbackNormalization(normalizedInput, 'missing_agent_output');

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
