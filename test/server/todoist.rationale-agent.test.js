'use strict';

jest.mock('../../src/server/todoist/agents/runner.js', () => ({
  runTodoistLlmAgent: jest.fn(),
}));

const { runTodoistLlmAgent } = require('../../src/server/todoist/agents/runner.js');
const { runRationaleAgent } = require('../../src/server/todoist/agents/rationale-agent.js');

describe('todoist rationale agent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('fills fallback rationale for shortlist items missing in llm output', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        a1: 'Custom reason from llm',
      },
      trace: {
        llm_used: true,
        parse_status: 'parsed',
      },
    });

    const out = await runRationaleAgent('waiting', [
      {
        todoist_task_id: 'a1',
        raw_title: 'Follow up with Alex',
        normalized_title_en: null,
      },
      {
        todoist_task_id: 'b2',
        raw_title: 'Ping vendor',
        normalized_title_en: null,
      },
    ]);

    expect(out.result).toEqual({
      a1: 'Custom reason from llm',
      b2: 'Ping vendor: waiting age and follow-up impact suggest nudging now.',
    });
    expect(out.trace).toEqual(expect.objectContaining({
      llm_used: true,
      parse_status: 'parsed',
      shortlist_count: 2,
      rationale_kind: 'waiting',
    }));
  });

  test('returns deterministic empty-shortlist trace without llm call', async () => {
    const out = await runRationaleAgent('daily', []);
    expect(out.result).toEqual({});
    expect(out.trace).toEqual(expect.objectContaining({
      llm_used: false,
      llm_reason: 'empty_shortlist',
      parse_status: 'skipped',
      shortlist_count: 0,
      rationale_kind: 'daily',
    }));
    expect(runTodoistLlmAgent).not.toHaveBeenCalled();
  });
});
