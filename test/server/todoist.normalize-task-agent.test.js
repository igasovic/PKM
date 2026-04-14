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
      task_shape: 'follow_up',
      parse_failed: false,
      parse_failure_reason: null,
    }));
    expect(out.trace).toEqual(expect.objectContaining({
      llm_reason: 'litellm_not_configured',
      parse_status: 'skipped',
      parse_failed: false,
    }));
  });

  test('passes through all few-shot examples to the runner input', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Review proposal',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.71,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const fewShot = Array.from({ length: 18 }, (_, idx) => ({
      input: { raw_title: `Example ${idx + 1}` },
      output: { normalized_title_en: `Example ${idx + 1}`, task_shape: 'next_action' },
    }));

    await runNormalizeTaskAgent({
      raw_title: 'Review proposal',
      few_shot_examples: fewShot,
    });

    const runnerInput = runTodoistLlmAgent.mock.calls[0][1];
    expect(Array.isArray(runnerInput.few_shot_examples)).toBe(true);
    expect(runnerInput.few_shot_examples).toHaveLength(18);
  });

  test('forces project shape for explicit project evidence', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Prj: write PRD',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.6,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Prj: write PRD',
      explicit_project_signal: true,
    });

    expect(out.result).toEqual(expect.objectContaining({
      task_shape: 'project',
    }));
    expect(out.result.parse_confidence).toBeGreaterThanOrEqual(0.9);
  });

  test('forces project shape for comma chain evidence with non-empty segments', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Prepare for call, have call, follow up',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.65,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'prepare for call, do call, follow up',
    });

    expect(out.result.task_shape).toBe('project');
  });

  test('does not force project on empty comma chunks', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Task',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.7,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'task,,,',
    });

    expect(out.result.task_shape).not.toBe('project');
  });

  test('demotes llm project to next_action when project evidence is absent', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Buy milk',
        task_shape: 'project',
        suggested_next_action: 'Buy milk',
        parse_confidence: 0.88,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Buy milk',
    });

    expect(out.result.task_shape).toBe('next_action');
  });

  test('promotes actionable unknown shape to next_action', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Replace air filter',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.58,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Replace air filter',
    });

    expect(out.result.task_shape).toBe('next_action');
  });

  test('forces follow_up when follow-up cues are present', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Ask Sahar to check with gPlex on grouping for team inbox',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.7,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'sahar to check with gPlex on grouping for team inbox',
    });

    expect(out.result.task_shape).toBe('follow_up');
    expect(out.result.parse_confidence).toBeGreaterThanOrEqual(0.85);
  });

  test('forces project when has_subtasks is true', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Organize taxes',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.72,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Organize taxes',
      has_subtasks: true,
    });

    expect(out.result.task_shape).toBe('project');
  });

  test('forces project on arrow multi-step titles', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Go to store -> buy pate -> make dinner',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.7,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Otici u prodavnicu -> kupiti pastetu -> napraviti veceru',
    });

    expect(out.result.task_shape).toBe('project');
  });

  test('does not promote question-style unknown title to next_action', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'What should I do',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.55,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'What should I do?',
    });

    expect(out.result.task_shape).toBe('unknown');
  });

  test('supports follow-up detection for Serbian phrasing', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Call the hospital to check whether Anthem paid',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.72,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Zvati bolnicu proveriti da li je anhtme platio',
    });

    expect(out.result.task_shape).toBe('follow_up');
  });

  test('does not force follow_up when only generic check verb is present', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Check tire pressure',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.76,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Check tire pressure',
    });

    expect(out.result.task_shape).toBe('next_action');
  });

  test('preserves non-project non-unknown shape when no deterministic override applies', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Little things, signs of attention',
        task_shape: 'vague_note',
        suggested_next_action: null,
        parse_confidence: 0.72,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'small things, small signs of attention',
    });

    expect(out.result.task_shape).toBe('vague_note');
  });

  test('normalizes few-shot examples by dropping non-object entries', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Review proposal',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.71,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    await runNormalizeTaskAgent({
      raw_title: 'Review proposal',
      few_shot_examples: [{ input: {}, output: {} }, null, 'bad', 1, { input: { raw_title: 'x' }, output: { normalized_title_en: 'x', task_shape: 'next_action' } }],
    });

    const runnerInput = runTodoistLlmAgent.mock.calls[0][1];
    expect(runnerInput.few_shot_examples).toHaveLength(2);
  });

  test('keeps llm project when comma chain contains real text segments', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Task one, task two, task three',
        task_shape: 'project',
        suggested_next_action: 'Start with task one',
        parse_confidence: 0.8,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Task one, task two, task three',
    });

    expect(out.result.task_shape).toBe('project');
  });

  test('treats explicit project signal detected from title prefix as project', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Project: Taxes',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.74,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'project: taxes',
    });

    expect(out.result.task_shape).toBe('project');
  });

  test('forces follow_up for waiting-for phrasing', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Waiting for finance response',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.7,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'waiting for finance response',
    });

    expect(out.result.task_shape).toBe('follow_up');
  });

  test('keeps unknown when title is not actionable and no stronger rule matches', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Sunset',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.62,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'sunset',
    });

    expect(out.result.task_shape).toBe('unknown');
  });

  test('forces follow_up for ask/check with pattern even when llm returns unknown', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Ask team to confirm setup',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.55,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Ask team to confirm setup with ops',
    });

    expect(out.result.task_shape).toBe('follow_up');
  });

  test('uses project override before follow_up override when both cues are present', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Ask ops, confirm rollout, follow up',
        task_shape: 'follow_up',
        suggested_next_action: null,
        parse_confidence: 0.75,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Ask ops, confirm rollout, follow up',
    });

    expect(out.result.task_shape).toBe('project');
  });

  test('does not lower parse confidence when deterministic overrides apply', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Prj: annual taxes',
        task_shape: 'project',
        suggested_next_action: null,
        parse_confidence: 0.97,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'prj: annual taxes',
    });

    expect(out.result.task_shape).toBe('project');
    expect(out.result.parse_confidence).toBe(0.97);
  });

  test('demoted project keeps confidence below forced project threshold when no evidence exists', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Install cameras',
        task_shape: 'project',
        suggested_next_action: null,
        parse_confidence: 0.95,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Install cameras',
    });

    expect(out.result.task_shape).toBe('next_action');
    expect(out.result.parse_confidence).toBeLessThan(0.9);
  });

  test('promoted actionable unknown clears parse_failed flags', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Set up cameras',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0,
        parse_failed: true,
        parse_failure_reason: 'missing_agent_output',
      },
      trace: {
        llm_used: false,
        llm_reason: 'litellm_not_configured',
        parse_status: 'skipped',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Set up cameras',
    });

    expect(out.result.task_shape).toBe('next_action');
    expect(out.result.parse_failed).toBe(false);
    expect(out.result.parse_failure_reason).toBe(null);
  });

  test('project evidence via subtasks overrides unknown output', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Organize move',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.58,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Organize move',
      has_subtasks: true,
    });

    expect(out.result.task_shape).toBe('project');
  });

  test('supports unicode arrow marker for project forcing', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Go store -> buy food -> cook dinner',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.7,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Go store → buy food → cook dinner',
    });

    expect(out.result.task_shape).toBe('project');
  });

  test('does not force project for two comma segments only', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Task one, task two',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.74,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Task one, task two',
    });

    expect(out.result.task_shape).toBe('next_action');
  });

  test('supports follow_up detection when cue is in description', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Insurance claim',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.5,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Insurance claim',
      raw_description: 'follow up with insurer tomorrow',
    });

    expect(out.result.task_shape).toBe('follow_up');
  });

  test('does not coerce non-actionable vague note from unknown when no action verb exists', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Little things',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.6,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'little things',
    });

    expect(out.result.task_shape).toBe('unknown');
  });

  test('keeps follow_up when llm already classifies follow_up and no project evidence', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Check with finance',
        task_shape: 'follow_up',
        suggested_next_action: null,
        parse_confidence: 0.81,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Check with finance',
    });

    expect(out.result.task_shape).toBe('follow_up');
  });

  test('retains suggested_next_action field during deterministic reshaping', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Buy groceries',
        task_shape: 'project',
        suggested_next_action: 'Create grocery list',
        parse_confidence: 0.77,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Buy groceries',
    });

    expect(out.result.task_shape).toBe('next_action');
    expect(out.result.suggested_next_action).toBe('Create grocery list');
  });

  test('retains normalized title from llm output after deterministic rules', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Prepare for call, have call, follow up',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.7,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'prepare for call, do call, follow up',
    });

    expect(out.result.normalized_title_en).toBe('Prepare for call, have call, follow up');
    expect(out.result.task_shape).toBe('project');
  });

  test('valid comma chain ignores surrounding whitespace', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'A, B, C',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.7,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: '  a ,  b  , c  ',
    });

    expect(out.result.task_shape).toBe('project');
  });

  test('comma chain with only punctuation does not force project', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Task',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.5,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: ' , , ',
    });

    expect(out.result.task_shape).toBe('unknown');
  });

  test('does not override to follow_up when project evidence already exists', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Ask ops, confirm rollout, follow up',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.6,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Ask ops, confirm rollout, follow up',
    });

    expect(out.result.task_shape).toBe('project');
  });

  test('actionable fallback handles Serbian action verbs', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Return money to Sloba',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.58,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Vratiti pare slobi',
    });

    expect(out.result.task_shape).toBe('next_action');
  });

  test('question marks block actionable unknown promotion', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Should we buy LEDs',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.57,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Should we buy LEDs?',
    });

    expect(out.result.task_shape).toBe('unknown');
  });

  test('idea prefix blocks actionable unknown promotion', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Idea: cameras',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.6,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Idea: cameras for backyard',
    });

    expect(out.result.task_shape).toBe('unknown');
  });

  test('project demotion does not erase normalized title', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Install cameras',
        task_shape: 'project',
        suggested_next_action: null,
        parse_confidence: 0.78,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Namestiti kamere',
    });

    expect(out.result.normalized_title_en).toBe('Install cameras');
    expect(out.result.task_shape).toBe('next_action');
  });

  test('project force keeps suggested_next_action when provided', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Prj: taxes',
        task_shape: 'next_action',
        suggested_next_action: 'Collect forms',
        parse_confidence: 0.7,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Prj: taxes',
    });

    expect(out.result.task_shape).toBe('project');
    expect(out.result.suggested_next_action).toBe('Collect forms');
  });

  test('follow_up forcing keeps normalized title and suggested_next_action', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Check with Sahar',
        task_shape: 'unknown',
        suggested_next_action: 'Message Sahar',
        parse_confidence: 0.6,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'check with sahar',
    });

    expect(out.result.task_shape).toBe('follow_up');
    expect(out.result.normalized_title_en).toBe('Check with Sahar');
    expect(out.result.suggested_next_action).toBe('Message Sahar');
  });

  test('fallback unknown with non-actionable title remains unknown', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: null,
      trace: {
        llm_used: false,
        llm_reason: 'litellm_not_configured',
        parse_status: 'skipped',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'sunset',
    });

    expect(out.result.task_shape).toBe('unknown');
    expect(out.result.parse_failed).toBe(true);
  });

  test('fallback unknown with actionable title becomes next_action', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: null,
      trace: {
        llm_used: false,
        llm_reason: 'litellm_not_configured',
        parse_status: 'skipped',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Mow lawn',
    });

    expect(out.result.task_shape).toBe('next_action');
    expect(out.result.parse_failed).toBe(false);
  });

  test('comma-based project rule requires actual text segments between commas', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'A,,C',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.7,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'a,,c',
    });

    expect(out.result.task_shape).toBe('next_action');
  });

  test('explicit project signal in brackets forces project', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: '[PRJ] taxes',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.66,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: '[PRJ] taxes',
    });

    expect(out.result.task_shape).toBe('project');
  });

  test('follow_up detection supports writing-to pattern', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Write to Sahar',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.72,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'write to sahar about quotes',
    });

    expect(out.result.task_shape).toBe('follow_up');
  });

  test('follow_up detection supports Serbian "pisati ... sa" pattern', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Write to team',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.7,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'pisati sa timom o konfiguraciji',
    });

    expect(out.result.task_shape).toBe('follow_up');
  });

  test('actionable fallback works with "set up" verb phrase', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Set up cameras',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.59,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Set up cameras',
    });

    expect(out.result.task_shape).toBe('next_action');
  });

  test('non-action noun title does not auto-promote unknown', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Lemonade',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.52,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'lemonade',
    });

    expect(out.result.task_shape).toBe('unknown');
  });

  test('project force does not require explicit project signal when subtasks true', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Organize backyard work',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.69,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Organize backyard work',
      has_subtasks: true,
      explicit_project_signal: false,
    });

    expect(out.result.task_shape).toBe('project');
  });

  test('project force supports ascii arrow marker', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Prep => execute => review',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.7,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'prep => execute => review',
    });

    expect(out.result.task_shape).toBe('project');
  });

  test('project force from comma-chain still applies when llm returns follow_up', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Prepare, call, follow up',
        task_shape: 'follow_up',
        suggested_next_action: null,
        parse_confidence: 0.76,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'prepare, call, follow up',
    });

    expect(out.result.task_shape).toBe('project');
  });

  test('follow_up override can lift unknown parse confidence to minimum threshold', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Check with bank',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.3,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'check with bank',
    });

    expect(out.result.task_shape).toBe('follow_up');
    expect(out.result.parse_confidence).toBe(0.85);
  });

  test('actionable promotion raises low confidence to floor', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Buy LEDs',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.2,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Buy LEDs',
    });

    expect(out.result.task_shape).toBe('next_action');
    expect(out.result.parse_confidence).toBe(0.7);
  });

  test('demotion from llm project caps confidence below project force band', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Review notes',
        task_shape: 'project',
        suggested_next_action: null,
        parse_confidence: 0.5,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Review notes',
    });

    expect(out.result.task_shape).toBe('next_action');
    expect(out.result.parse_confidence).toBe(0.7);
  });

  test('follow_up phrase "wait for" is detected', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Wait for legal response',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.74,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'wait for legal response',
    });

    expect(out.result.task_shape).toBe('follow_up');
  });

  test('raw_title is preserved in fallback normalization even with deterministic logic', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: null,
      trace: {
        llm_used: false,
        llm_reason: 'litellm_not_configured',
        parse_status: 'skipped',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Idea: possible camera setup',
    });

    expect(out.result.normalized_title_en).toBe('Idea: possible camera setup');
  });

  test('non-empty comma segments required: "a, , c" should not force project', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'a, , c',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.72,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'a, , c',
    });

    expect(out.result.task_shape).toBe('next_action');
  });

  test('comma rule works when there are more than three meaningful segments', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'a, b, c, d',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.72,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'a, b, c, d',
    });

    expect(out.result.task_shape).toBe('project');
  });

  test('next_action override does not apply to vague note output', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Maybe someday',
        task_shape: 'vague_note',
        suggested_next_action: null,
        parse_confidence: 0.72,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Maybe someday',
    });

    expect(out.result.task_shape).toBe('vague_note');
  });

  test('follow_up rule matches "confirm with" phrasing', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Confirm with team',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.72,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'confirm with team the setup',
    });

    expect(out.result.task_shape).toBe('follow_up');
  });

  test('follow_up rule matches "write to" phrasing with uppercase input', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Write to Alexis',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.74,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'WRITE TO ALEXIS ABOUT CONTACTS',
    });

    expect(out.result.task_shape).toBe('follow_up');
  });

  test('project rule has precedence over unknown-to-next_action promotion', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Plan, execute, review',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.5,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'plan, execute, review',
    });

    expect(out.result.task_shape).toBe('project');
  });

  test('unknown fallback still uses llm normalized title when provided', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Sunset view',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.62,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'sunset',
    });

    expect(out.result.normalized_title_en).toBe('Sunset view');
    expect(out.result.task_shape).toBe('unknown');
  });

  test('project demotion does not force null suggested_next_action', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Set up cameras',
        task_shape: 'project',
        suggested_next_action: 'Call installer',
        parse_confidence: 0.85,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Set up cameras',
    });

    expect(out.result.task_shape).toBe('next_action');
    expect(out.result.suggested_next_action).toBe('Call installer');
  });

  test('deterministic project force works when llm already returns project', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Prj: taxes',
        task_shape: 'project',
        suggested_next_action: 'Collect docs',
        parse_confidence: 0.91,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Prj: taxes',
    });

    expect(out.result.task_shape).toBe('project');
    expect(out.result.parse_confidence).toBe(0.91);
  });

  test('deterministic follow_up override leaves parse_failure_reason cleared', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Check with legal',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.4,
        parse_failed: true,
        parse_failure_reason: 'some_reason',
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'check with legal',
    });

    expect(out.result.task_shape).toBe('follow_up');
    expect(out.result.parse_failed).toBe(false);
    expect(out.result.parse_failure_reason).toBe(null);
  });

  test('deterministic project override leaves parse_failure_reason cleared', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Plan, execute, close',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.4,
        parse_failed: true,
        parse_failure_reason: 'some_reason',
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'plan, execute, close',
    });

    expect(out.result.task_shape).toBe('project');
    expect(out.result.parse_failed).toBe(false);
    expect(out.result.parse_failure_reason).toBe(null);
  });

  test('deterministic next_action promotion leaves parse_failure_reason cleared', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Buy bread',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.4,
        parse_failed: true,
        parse_failure_reason: 'some_reason',
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Buy bread',
    });

    expect(out.result.task_shape).toBe('next_action');
    expect(out.result.parse_failed).toBe(false);
    expect(out.result.parse_failure_reason).toBe(null);
  });

  test('project detection by comma chain works with uppercase text', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'PREPARE, CALL, FOLLOW UP',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.72,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'PREPARE, CALL, FOLLOW UP',
    });

    expect(out.result.task_shape).toBe('project');
  });

  test('project detection by comma chain ignores extra commas if three segments exist', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'A, B, C,',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.72,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'A, B, C,',
    });

    expect(out.result.task_shape).toBe('project');
  });

  test('project detection by comma chain fails when only two non-empty segments exist', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'A, ,',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.72,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'A, ,',
    });

    expect(out.result.task_shape).toBe('next_action');
  });

  test('project override applies before follow_up for mixed comma + follow_up phrase', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Ask team, call vendor, follow up',
        task_shape: 'follow_up',
        suggested_next_action: null,
        parse_confidence: 0.8,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Ask team, call vendor, follow up',
    });

    expect(out.result.task_shape).toBe('project');
  });

  test('follow_up override applies when no project cues are present', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Call hospital to check payment',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.77,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Call hospital to check if payment was made',
    });

    expect(out.result.task_shape).toBe('follow_up');
  });

  test('unknown-to-next_action promotion leaves existing suggestion intact', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Buy milk',
        task_shape: 'unknown',
        suggested_next_action: 'Open shopping app',
        parse_confidence: 0.55,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Buy milk',
    });

    expect(out.result.task_shape).toBe('next_action');
    expect(out.result.suggested_next_action).toBe('Open shopping app');
  });

  test('demotion from project to next_action does not happen when explicit signal exists', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Prj: taxes',
        task_shape: 'project',
        suggested_next_action: null,
        parse_confidence: 0.8,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Prj: taxes',
    });

    expect(out.result.task_shape).toBe('project');
  });

  test('follow_up detection catches reminder verb', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Remind Alex',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.7,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'remind Alex about quote',
    });

    expect(out.result.task_shape).toBe('follow_up');
  });

  test('actionable detection catches "review" verb', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Review contacts',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.55,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'review contacts and opportunities',
    });

    expect(out.result.task_shape).toBe('next_action');
  });

  test('actionable detection catches Serbian verb "pogledati"', async () => {
    runTodoistLlmAgent.mockResolvedValue({
      output: {
        normalized_title_en: 'Look at tickets',
        task_shape: 'unknown',
        suggested_next_action: null,
        parse_confidence: 0.58,
      },
      trace: {
        llm_used: true,
        llm_reason: null,
        parse_status: 'parsed',
      },
    });

    const out = await runNormalizeTaskAgent({
      raw_title: 'Pogledati karte mojima',
    });

    expect(out.result.task_shape).toBe('next_action');
  });

  test('actionable detection does not trigger on empty title', async () => {
    await expect(runNormalizeTaskAgent({
      raw_title: '  ',
    })).rejects.toMatchObject({
      message: 'raw_title is required',
    });
  });
});
