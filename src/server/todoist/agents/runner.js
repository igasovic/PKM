'use strict';

const { LiteLLMClient } = require('../../litellm-client.js');
const { hasLiteLLMKey } = require('../../runtime-env.js');
const { getLogger } = require('../../logger/index.js');
const { asText } = require('../constants.js');

const DEFAULT_MODEL = 'pkm-default';

let litellmClient = null;

function getLiteLLMClient() {
  if (litellmClient) return litellmClient;
  litellmClient = new LiteLLMClient({});
  return litellmClient;
}

function buildTrace(spec, model, patch = {}) {
  return {
    agent_id: spec.agent_id,
    agent_version: spec.version,
    llm_used: false,
    llm_reason: null,
    llm_model: model,
    llm_error: null,
    parse_status: null,
    ...patch,
  };
}

function safeFallback(spec, input, reason, errorMessage) {
  if (typeof spec.fallback !== 'function') return null;
  try {
    return spec.fallback({
      input,
      reason,
      error: asText(errorMessage) || null,
    });
  } catch (_err) {
    return null;
  }
}

async function runTodoistLlmAgent(spec, input, options = {}) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('agent spec is required');
  }
  const agentId = asText(spec.agent_id);
  const version = asText(spec.version) || 'v1';
  if (!agentId) {
    throw new Error('agent spec agent_id is required');
  }
  if (typeof spec.build_prompt !== 'function') {
    throw new Error(`agent ${agentId} is missing build_prompt`);
  }

  const resolvedSpec = {
    ...spec,
    version,
    agent_id: agentId,
  };
  const model = asText(options.model) || asText(resolvedSpec.model) || DEFAULT_MODEL;
  const logger = getLogger().child({
    pipeline: 'todoist_planning',
    meta: {
      agent_id: resolvedSpec.agent_id,
      agent_version: resolvedSpec.version,
      agent_stage: asText(resolvedSpec.stage) || null,
    },
  });

  return logger.step(
    `todoist.agent.${resolvedSpec.agent_id}.run`,
    async () => {
      const prompt = resolvedSpec.build_prompt(input);
      const userPrompt = asText(prompt && prompt.user);
      const systemPrompt = asText(prompt && prompt.system);
      if (!userPrompt) {
        const output = safeFallback(resolvedSpec, input, 'prompt_error', 'missing_user_prompt');
        return {
          output,
          trace: buildTrace(resolvedSpec, model, {
            llm_used: false,
            llm_reason: 'prompt_error',
            llm_error: 'missing_user_prompt',
            parse_status: 'skipped',
          }),
        };
      }

      if (!hasLiteLLMKey()) {
        const output = safeFallback(resolvedSpec, input, 'litellm_not_configured');
        return {
          output,
          trace: buildTrace(resolvedSpec, model, {
            llm_used: false,
            llm_reason: 'litellm_not_configured',
            parse_status: 'skipped',
          }),
        };
      }

      let responseText = null;
      try {
        const response = await getLiteLLMClient().sendMessage(userPrompt, {
          model,
          systemPrompt: systemPrompt || undefined,
          metadata: {
            pipeline: 'todoist_planning',
            stage: asText(resolvedSpec.stage) || resolvedSpec.agent_id,
            agent_id: resolvedSpec.agent_id,
            agent_version: resolvedSpec.version,
          },
        });
        responseText = asText(response && response.text);
      } catch (err) {
        const message = asText(err && err.message) || 'llm_error';
        const output = safeFallback(resolvedSpec, input, 'llm_error', message);
        return {
          output,
          trace: buildTrace(resolvedSpec, model, {
            llm_used: false,
            llm_reason: 'llm_error',
            llm_error: message,
            parse_status: 'skipped',
          }),
        };
      }

      if (!responseText) {
        const output = safeFallback(resolvedSpec, input, 'empty_response');
        return {
          output,
          trace: buildTrace(resolvedSpec, model, {
            llm_used: true,
            llm_reason: 'empty_response',
            parse_status: 'empty',
          }),
        };
      }

      if (typeof resolvedSpec.parse_response !== 'function') {
        return {
          output: responseText,
          trace: buildTrace(resolvedSpec, model, {
            llm_used: true,
            parse_status: 'parsed',
          }),
        };
      }

      try {
        const parsed = resolvedSpec.parse_response(responseText, input);
        return {
          output: parsed,
          trace: buildTrace(resolvedSpec, model, {
            llm_used: true,
            parse_status: 'parsed',
          }),
        };
      } catch (err) {
        const message = asText(err && err.message) || 'parse_error';
        const output = safeFallback(resolvedSpec, input, 'parse_error', message);
        return {
          output,
          trace: buildTrace(resolvedSpec, model, {
            llm_used: true,
            llm_reason: 'parse_error',
            llm_error: message,
            parse_status: 'parse_error',
          }),
        };
      }
    },
    {
      input: {
        agent_id: resolvedSpec.agent_id,
        agent_version: resolvedSpec.version,
        has_input: input !== undefined && input !== null,
        model,
      },
      output: (out) => ({
        llm_used: !!(out && out.trace && out.trace.llm_used),
        llm_reason: asText(out && out.trace && out.trace.llm_reason) || null,
        parse_status: asText(out && out.trace && out.trace.parse_status) || null,
      }),
      meta: {
        agent_id: resolvedSpec.agent_id,
        agent_version: resolvedSpec.version,
        stage: asText(resolvedSpec.stage) || null,
      },
    },
  );
}

function __resetTodoistAgentRunnerForTests() {
  litellmClient = null;
}

module.exports = {
  runTodoistLlmAgent,
  __resetTodoistAgentRunnerForTests,
};
