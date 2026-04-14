'use strict';

const { loadTodoistNormalizeFixtures } = require('../../scripts/evals/lib/fixtures.js');
const { scoreTodoistNormalizeResults } = require('../../scripts/evals/lib/scoring.js');
const { buildTodoistMarkdown } = require('../../scripts/evals/lib/reporting.js');

function buildSyntheticFixtureRows() {
  const rows = [];
  for (let i = 1; i <= 30; i += 1) {
    rows.push({
      case_id: `T-GOLD-${i}`,
      name: `Gold ${i}`,
      bucket: 'next_action',
      corpus_group: 'gold_only',
      failure_tags: ['task_shape', 'normalized_title'],
      input: {
        raw_title: `gold ${i}`,
        raw_description: null,
        project_key: 'inbox',
        todoist_section_name: null,
        lifecycle_status: 'open',
        has_subtasks: false,
        explicit_project_signal: false,
      },
      expect: {
        task_shape: 'next_action',
        normalized_title_en: `Gold ${i}`,
        suggested_next_action: null,
      },
    });
  }
  for (let i = 1; i <= 10; i += 1) {
    rows.push({
      case_id: `T-PROMPT-${i}`,
      name: `Prompt ${i}`,
      bucket: 'next_action',
      corpus_group: 'prompt_examples',
      failure_tags: ['task_shape', 'normalized_title'],
      input: {
        raw_title: `prompt ${i}`,
        raw_description: null,
        project_key: 'inbox',
        todoist_section_name: null,
        lifecycle_status: 'open',
        has_subtasks: false,
        explicit_project_signal: false,
      },
      expect: {
        task_shape: 'next_action',
        normalized_title_en: `Prompt ${i}`,
        suggested_next_action: null,
      },
    });
  }
  for (let i = 1; i <= 10; i += 1) {
    rows.push({
      case_id: `T-EVAL-${i}`,
      name: `Eval ${i}`,
      bucket: 'next_action',
      corpus_group: 'eval_core',
      failure_tags: ['task_shape', 'normalized_title'],
      input: {
        raw_title: `eval ${i}`,
        raw_description: null,
        project_key: 'work',
        todoist_section_name: null,
        lifecycle_status: 'open',
        has_subtasks: false,
        explicit_project_signal: false,
      },
      expect: {
        task_shape: 'next_action',
        normalized_title_en: `Eval ${i}`,
        suggested_next_action: null,
      },
    });
  }
  return rows;
}

describe('todoist eval tooling', () => {
  test('fixtures meet required split and size constraints', () => {
    const rows = loadTodoistNormalizeFixtures();
    const counts = rows.reduce((acc, row) => {
      acc[row.corpus_group] = (acc[row.corpus_group] || 0) + 1;
      return acc;
    }, {});
    const promptIds = new Set(rows
      .filter((row) => row.corpus_group === 'prompt_examples')
      .map((row) => row.case_id));
    const overlap = rows.filter((row) => row.corpus_group === 'eval_core' && promptIds.has(row.case_id));

    expect(rows.length).toBeGreaterThanOrEqual(50);
    expect(counts.prompt_examples || 0).toBeGreaterThanOrEqual(10);
    expect(counts.eval_core || 0).toBeGreaterThanOrEqual(10);
    expect(overlap).toHaveLength(0);
  });

  test('scoring computes shape accuracy, title match, and project overcalls', () => {
    const summary = scoreTodoistNormalizeResults([
      {
        case_id: 'e1',
        bucket: 'next_action',
        expected_task_shape: 'next_action',
        actual_task_shape: 'next_action',
        expected_normalized_title_en: 'Do dishes',
        actual_normalized_title_en: 'Do dishes',
        parse_confidence: 0.91,
        shape_match: true,
        title_match: true,
        pass: true,
      },
      {
        case_id: 'e2',
        bucket: 'next_action',
        expected_task_shape: 'next_action',
        actual_task_shape: 'project',
        expected_normalized_title_en: 'Clean kitchen',
        actual_normalized_title_en: 'Clean kitchen',
        parse_confidence: 0.88,
        shape_match: false,
        title_match: true,
        pass: false,
      },
    ]);

    expect(summary.total).toBe(2);
    expect(summary.task_shape_accuracy).toBe(0.5);
    expect(summary.normalized_title_match_rate).toBe(1);
    expect(summary.project_overcall_rate).toBe(0.5);
    expect(summary.failure_groups.project_overcalls).toHaveLength(1);
  });

  test('markdown report includes todoist metrics and highlights', () => {
    const markdown = buildTodoistMarkdown({
      metadata: { timestamp: '20260413T010101Z', backend_url: 'http://pkm-server:8080' },
      summary: {
        total: 10,
        passed: 7,
        accuracy: 0.7,
        task_shape_accuracy: 0.8,
        normalized_title_match_rate: 0.75,
        project_overcall_rate: 0.2,
        next_action_metric: 'pending_missing_labels',
        failure_groups: {
          project_overcalls: [{ case_id: 'c1', expected_task_shape: 'next_action', actual_task_shape: 'project', run_id: 'r1' }],
          high_confidence_shape_errors: [],
          title_mismatches: [],
        },
      },
    });

    expect(markdown).toContain('Todoist Normalize Eval Report');
    expect(markdown).toContain('task shape accuracy');
    expect(markdown).toContain('project overcalls');
  });

  test('runner smoke executes eval core with mocked live api', async () => {
    jest.resetModules();
    const syntheticRows = buildSyntheticFixtureRows();
    const postTodoistEvalNormalize = jest.fn(async () => ({
      normalized_task: {
        normalized_title_en: 'Eval 1',
        task_shape: 'next_action',
        suggested_next_action: null,
        parse_confidence: 0.94,
      },
      normalize_trace: {
        llm_used: true,
        llm_reason: 'classification_required',
        parse_status: 'ok',
      },
    }));
    const getDebugRun = jest.fn(async () => ({ rows: [{ id: 1 }] }));
    const buildTodoistMarkdownMock = jest.fn(() => '# report');
    const writeEvalReport = jest.fn(() => ({ jsonPath: '/tmp/todoist.json', mdPath: '/tmp/todoist.md' }));

    jest.doMock('../../scripts/evals/lib/fixtures.js', () => ({
      loadTodoistNormalizeFixtures: () => syntheticRows,
    }));
    jest.doMock('../../scripts/evals/lib/live-api.js', () => ({
      postTodoistEvalNormalize,
      getDebugRun,
    }));
    jest.doMock('../../scripts/evals/lib/reporting.js', () => ({
      buildTodoistMarkdown: buildTodoistMarkdownMock,
      writeEvalReport,
    }));

    const originalArgv = process.argv;
    process.argv = [
      'node',
      'run_todoist_live.js',
      '--backend-url', 'http://pkm-server:8080',
      '--admin-secret', 'test-admin-secret',
      '--case-limit', '1',
    ];

    try {
      const { run } = require('../../scripts/evals/run_todoist_live.js');
      await run();
    } finally {
      process.argv = originalArgv;
      jest.dontMock('../../scripts/evals/lib/fixtures.js');
      jest.dontMock('../../scripts/evals/lib/live-api.js');
      jest.dontMock('../../scripts/evals/lib/reporting.js');
      jest.resetModules();
    }

    expect(postTodoistEvalNormalize).toHaveBeenCalledTimes(1);
    expect(postTodoistEvalNormalize.mock.calls[0][0].body.few_shot_examples).toHaveLength(10);
    expect(getDebugRun).toHaveBeenCalledTimes(1);
    expect(writeEvalReport).toHaveBeenCalledTimes(1);
  });
});
