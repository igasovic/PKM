'use strict';

const {
  pullWorkingMemory,
  wrapCommit,
  ChatgptValidationError,
} = require('./chatgpt/service.js');

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ChatgptValidationError(`${fieldName} must be an object`);
  }
  return value;
}

async function runChatgptWorkingMemoryAction(payload, requestMeta) {
  const input = requireObject(payload || {}, 'working_memory payload');
  const topic = asText(input.topic || input.topic_primary || input.resolved_topic_primary || input.q);
  if (!topic) {
    throw new ChatgptValidationError('topic is required for pull_working_memory', {
      field: 'topic',
      code: 'missing_topic',
    });
  }

  const result = await pullWorkingMemory({ topic }, requestMeta || {});
  return {
    action: 'chatgpt_read',
    method: 'pull_working_memory',
    outcome: result && result.meta && result.meta.found ? 'success' : 'no_result',
    result,
  };
}

async function runChatgptWrapCommitAction(payload, requestMeta) {
  const input = requireObject(payload || {}, 'wrap_commit payload');
  const result = await wrapCommit(input, requestMeta || {});
  return {
    action: 'chatgpt_wrap_commit',
    outcome: 'success',
    result,
  };
}

module.exports = {
  runChatgptWorkingMemoryAction,
  runChatgptWrapCommitAction,
};
