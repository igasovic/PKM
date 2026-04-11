'use strict';

const mockSendMessage = jest.fn();

jest.mock('../../src/server/runtime-env.js', () => {
  const actual = jest.requireActual('../../src/server/runtime-env.js');
  return {
    ...actual,
    hasLiteLLMKey: jest.fn(),
  };
});

jest.mock('../../src/server/litellm-client.js', () => ({
  LiteLLMClient: jest.fn(() => ({
    sendMessage: mockSendMessage,
  })),
}));

const { hasLiteLLMKey } = require('../../src/server/runtime-env.js');
const {
  runTodoistLlmAgent,
  __resetTodoistAgentRunnerForTests,
} = require('../../src/server/todoist/agents/runner.js');

describe('todoist llm agent runner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetTodoistAgentRunnerForTests();
  });

  test('uses fallback when LiteLLM key is missing', async () => {
    hasLiteLLMKey.mockReturnValue(false);
    const out = await runTodoistLlmAgent({
      agent_id: 'todoist.test_agent',
      version: 'v1',
      build_prompt: () => ({ system: 'sys', user: 'user' }),
      fallback: ({ reason }) => ({ reason }),
    }, { foo: 'bar' });

    expect(out.output).toEqual({ reason: 'litellm_not_configured' });
    expect(out.trace).toEqual(expect.objectContaining({
      agent_id: 'todoist.test_agent',
      agent_version: 'v1',
      llm_used: false,
      llm_reason: 'litellm_not_configured',
      parse_status: 'skipped',
    }));
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  test('parses response when LLM call succeeds', async () => {
    hasLiteLLMKey.mockReturnValue(true);
    mockSendMessage.mockResolvedValue({ text: '{"ok":true}' });

    const out = await runTodoistLlmAgent({
      agent_id: 'todoist.test_agent',
      version: 'v1',
      build_prompt: () => ({ system: 'sys', user: 'user' }),
      parse_response: (raw) => JSON.parse(raw),
      fallback: () => ({ ok: false }),
    }, {});

    expect(out.output).toEqual({ ok: true });
    expect(out.trace).toEqual(expect.objectContaining({
      llm_used: true,
      llm_reason: null,
      parse_status: 'parsed',
    }));
  });

  test('falls back when parse step fails', async () => {
    hasLiteLLMKey.mockReturnValue(true);
    mockSendMessage.mockResolvedValue({ text: 'not-json' });

    const out = await runTodoistLlmAgent({
      agent_id: 'todoist.test_agent',
      version: 'v1',
      build_prompt: () => ({ system: 'sys', user: 'user' }),
      parse_response: () => {
        throw new Error('bad_parse');
      },
      fallback: ({ reason, error }) => ({ reason, error }),
    }, {});

    expect(out.output).toEqual({ reason: 'parse_error', error: 'bad_parse' });
    expect(out.trace).toEqual(expect.objectContaining({
      llm_used: true,
      llm_reason: 'parse_error',
      llm_error: 'bad_parse',
      parse_status: 'parse_error',
    }));
  });
});
