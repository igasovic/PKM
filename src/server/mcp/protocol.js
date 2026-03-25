'use strict';

const {
  callTool,
  listTools,
  McpError,
  McpValidationError,
  McpToolNotFoundError,
  markVisibleFailure,
  summarizeToolCallResult,
} = require('./service.js');

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isJsonRpc(body) {
  return isObject(body) && body.jsonrpc === '2.0' && typeof body.method === 'string';
}

function asMethod(body) {
  if (isObject(body) && typeof body.method === 'string') return body.method.trim();
  if (isObject(body) && typeof body.action === 'string') return body.action.trim();
  if (isObject(body) && typeof body.tool === 'string') return 'tools/call';
  return '';
}

function parseToolCall(body) {
  if (!isObject(body)) {
    throw new McpValidationError('mcp request body must be an object');
  }

  if (typeof body.tool === 'string') {
    return {
      name: body.tool.trim(),
      args: isObject(body.input) ? body.input : {},
    };
  }

  const params = isObject(body.params) ? body.params : {};
  const name = String(params.name || body.name || '').trim();
  if (!name) {
    throw new McpValidationError('tools/call requires params.name');
  }

  const args = params.arguments !== undefined
    ? params.arguments
    : (body.arguments !== undefined ? body.arguments : {});
  if (args !== null && !isObject(args)) {
    throw new McpValidationError('tools/call arguments must be an object');
  }

  return {
    name,
    args: isObject(args) ? args : {},
  };
}

function toRpcError(err) {
  if (err instanceof McpToolNotFoundError) {
    return {
      code: -32601,
      message: err.message,
      data: {
        error_code: err.code,
      },
    };
  }
  if (err instanceof McpValidationError) {
    return {
      code: -32602,
      message: err.message,
      data: {
        error_code: err.code,
        field: err.field || null,
      },
    };
  }
  if (err instanceof McpError) {
    return {
      code: -32000,
      message: err.message,
      data: {
        error_code: err.code,
      },
    };
  }
  return {
    code: -32000,
    message: err && err.message ? err.message : 'internal mcp error',
    data: {
      error_code: 'internal_error',
    },
  };
}

async function runMcpRequest(body, requestMeta) {
  const method = asMethod(body);
  if (!method) {
    throw new McpValidationError('mcp request must include method/action');
  }

  if (method === 'tools/list') {
    const tools = listTools();
    return {
      type: 'tools/list',
      tools,
    };
  }

  if (method !== 'tools/call') {
    throw new McpValidationError(`unsupported mcp method: ${method}`);
  }

  const call = parseToolCall(body);
  const toolResult = await callTool(call.name, call.args, requestMeta || {});
  return {
    type: 'tools/call',
    name: toolResult.tool,
    outcome: toolResult.outcome,
    result: toolResult.result,
    summary: summarizeToolCallResult(toolResult),
  };
}

async function processMcpRequest(body, requestMeta) {
  const rpc = isJsonRpc(body);
  const requestId = rpc ? body.id : undefined;

  try {
    const result = await runMcpRequest(body, requestMeta);
    if (rpc) {
      return {
        jsonrpc: '2.0',
        id: requestId === undefined ? null : requestId,
        result,
      };
    }
    return result;
  } catch (err) {
    markVisibleFailure();
    if (rpc) {
      return {
        jsonrpc: '2.0',
        id: requestId === undefined ? null : requestId,
        error: toRpcError(err),
      };
    }
    throw err;
  }
}

module.exports = {
  processMcpRequest,
};
