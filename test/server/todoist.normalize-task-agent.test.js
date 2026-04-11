'use strict';

jest.mock('../../src/server/todoist/agents/runner.js', () => ({
  runTodoistLlmAgent: jest.fn(),
}));

const { runTodoistLlmAgent } = require('../../src/server/todoist/agents/runner.js');
const { runNormalizeTaskAgent } = require('../../src/server/todoist/agents/normalize-task-agent.js');

describe('todoist normalize task agent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('requires raw_title', async () => {
    await expect(runNormalizeTaskAgent({
      raw_title: '',
    })).rejects.toMatchObject({
      message: 'raw_title is required',
    });
    expect(runTodoistLlmAgent).not.toHaveBeenCalled();
  });

  test('returns fallback result when runner output is missing', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: null,
      trace: {
        llm_used: false,
        llm_reason: 'litellm_not_configured',
        parse_status: 'skipped',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Follow up with Alex',
      raw_description: 'Waiting for response',
      project_key: 'work',
      todoist_section_name: 'Waiting',
      lifecycle_status: 'waiting',
    });

    expect(out.result).toEqual(expect.objectContaining({
      normalized_title_en: 'Follow up with Alex',
      parse_failed: true,
      parse_failure_reason: 'missing_agent_output',
    }));
    expect(out.trace).toEqual(expect.objectContaining({
      llm_reason: 'litellm_not_configured',
      parse_status: 'skipped',
      parse_failed: true,
    }));
  });
});
