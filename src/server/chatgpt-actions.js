'use strict';

const {
  callTool,
  McpValidationError,
} = require('./mcp/service.js');

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new McpValidationError(`${fieldName} must be an object`);
  }
  return value;
}

async function runChatgptWorkingMemoryAction(payload, requestMeta) {
  const input = requireObject(payload || {}, 'working_memory payload');
  const topic = asText(input.topic || input.topic_primary || input.resolved_topic_primary || input.q);
  if (!topic) {
    throw new McpValidationError('topic is required for pull_working_memory', {
      field: 'topic',
      code: 'missing_topic',
    });
  }

  const toolResult = await callTool('pkm.pull_working_memory', { topic }, requestMeta || {});
  return {
    action: 'chatgpt_read',
    method: 'pull_working_memory',
    outcome: toolResult.outcome,
    result: toolResult.result,
  };
}

async function runChatgptWrapCommitAction(payload, requestMeta) {
  const input = requireObject(payload || {}, 'wrap_commit payload');
  const toolResult = await callTool('pkm.wrap_commit', input, requestMeta || {});
  return {
    action: 'chatgpt_wrap_commit',
    outcome: toolResult.outcome,
    result: toolResult.result,
  };
}

module.exports = {
  runChatgptWorkingMemoryAction,
  runChatgptWrapCommitAction,
};
