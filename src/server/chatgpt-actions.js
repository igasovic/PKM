'use strict';

const {
  callTool,
  McpValidationError,
} = require('./mcp/service.js');

const READ_METHOD_TO_TOOL = {
  continue: 'pkm.continue',
  last: 'pkm.last',
  find: 'pkm.find',
  pull: 'pkm.pull',
  pull_working_memory: 'pkm.pull_working_memory',
};

const SEMANTIC_INTENT_TO_METHOD = {
  continue: 'continue',
  continue_thread: 'continue',
  last: 'last',
  vague_recall: 'last',
  find: 'find',
  detail_lookup: 'find',
  pull: 'pull',
  source_pull: 'pull',
  pull_working_memory: 'pull_working_memory',
  topic_memory: 'pull_working_memory',
};

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new McpValidationError(`${fieldName} must be an object`);
  }
  return value;
}

function parseOptionalPositiveInt(value, fieldName) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new McpValidationError(`${fieldName} must be a positive integer`, {
      field: fieldName,
      code: 'validation_error',
    });
  }
  return Math.trunc(n);
}

function parseRequiredPositiveInt(value, fieldName) {
  const parsed = parseOptionalPositiveInt(value, fieldName);
  if (parsed === undefined) {
    throw new McpValidationError(`${fieldName} is required`, {
      field: fieldName,
      code: `missing_${fieldName}`,
    });
  }
  return parsed;
}

function resolveReadMethod(input) {
  const explicitMethod = asText(input.method || input.read_method).toLowerCase();
  if (explicitMethod) {
    if (READ_METHOD_TO_TOOL[explicitMethod]) return explicitMethod;
    throw new McpValidationError('unsupported read method', {
      field: 'method',
      code: 'unsupported_method',
    });
  }

  const semanticIntent = asText(input.intent || input.read_intent).toLowerCase();
  if (semanticIntent) {
    const mapped = SEMANTIC_INTENT_TO_METHOD[semanticIntent];
    if (mapped) return mapped;
    throw new McpValidationError('unsupported read intent', {
      field: 'intent',
      code: 'unsupported_intent',
    });
  }

  const entryId = parseOptionalPositiveInt(input.entry_id, 'entry_id');
  if (entryId !== undefined) return 'pull';

  const topic = asText(input.topic || input.topic_primary || input.resolved_topic_primary);
  if (topic) {
    if (input.prefer_working_memory !== false) return 'pull_working_memory';
    return 'continue';
  }

  const q = asText(input.q || input.query || input.query_text);
  if (q) return 'continue';

  throw new McpValidationError('read request requires method/intent or retrievable input', {
    field: 'method',
    code: 'missing_read_method',
  });
}

function buildReadArgs(method, input) {
  const q = asText(input.q || input.query || input.query_text || input.topic || input.topic_primary);
  const topic = asText(input.topic || input.topic_primary || input.resolved_topic_primary || input.q);

  if (method === 'pull_working_memory') {
    if (!topic) {
      throw new McpValidationError('topic is required for pull_working_memory', {
        field: 'topic',
        code: 'missing_topic',
      });
    }
    return {
      topic,
    };
  }

  if (method === 'pull') {
    return {
      entry_id: parseRequiredPositiveInt(input.entry_id, 'entry_id'),
      shortN: parseOptionalPositiveInt(input.shortN, 'shortN'),
      longN: parseOptionalPositiveInt(input.longN, 'longN'),
    };
  }

  if (!q) {
    throw new McpValidationError('q is required for this read method', {
      field: 'q',
      code: 'missing_q',
    });
  }

  return {
    q,
    days: parseOptionalPositiveInt(input.days, 'days'),
    limit: parseOptionalPositiveInt(input.limit, 'limit'),
  };
}

async function runChatgptReadAction(payload, requestMeta) {
  const input = requireObject(payload || {}, 'read payload');
  const method = resolveReadMethod(input);
  const args = buildReadArgs(method, input);
  const toolName = READ_METHOD_TO_TOOL[method];

  const toolResult = await callTool(toolName, args, requestMeta || {});
  return {
    action: 'chatgpt_read',
    method,
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
  READ_METHODS: Object.keys(READ_METHOD_TO_TOOL),
  runChatgptReadAction,
  runChatgptWrapCommitAction,
};
