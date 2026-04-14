#!/usr/bin/env node
'use strict';

const {
  parseArgs,
  utcStamp,
} = require('./lib/io.js');
const {
  resolveRunnerOptions,
  parsePositiveCaseLimit,
  checkRunObservability,
  printEvalCompletion,
} = require('./lib/runner-common.js');
const { loadTodoistNormalizeFixtures } = require('./lib/fixtures.js');
const {
  postTodoistEvalNormalize,
} = require('./lib/live-api.js');
const { scoreTodoistNormalizeResults } = require('./lib/scoring.js');
const { buildTodoistMarkdown, writeEvalReport } = require('./lib/reporting.js');

function normalizeText(value) {
  return String(value === undefined || value === null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function assertFixtureTargets(rows) {
  const promptExamples = rows.filter((row) => row.corpus_group === 'prompt_examples');
  const evalCore = rows.filter((row) => row.corpus_group === 'eval_core');
  if (rows.length < 50) {
    throw new Error(`Todoist eval corpus too small: expected at least 50, found ${rows.length}.`);
  }
  if (promptExamples.length < 10) {
    throw new Error(`Todoist prompt_examples set too small: expected >=10, found ${promptExamples.length}.`);
  }
  if (evalCore.length < 10) {
    throw new Error(`Todoist eval_core set too small: expected >=10, found ${evalCore.length}.`);
  }

  const promptIds = new Set(promptExamples.map((row) => row.case_id));
  const overlap = evalCore.filter((row) => promptIds.has(row.case_id));
  if (overlap.length > 0) {
    throw new Error(`Todoist fixtures invalid: ${overlap.length} rows overlap between prompt_examples and eval_core.`);
  }
}

function buildPromptExamples(rows) {
  return rows.map((row) => ({
    input: {
      raw_title: String(row.input && row.input.raw_title ? row.input.raw_title : ''),
      raw_description: row.input && row.input.raw_description ? row.input.raw_description : null,
      project_key: row.input && row.input.project_key ? row.input.project_key : null,
      todoist_section_name: row.input && row.input.todoist_section_name ? row.input.todoist_section_name : null,
      lifecycle_status: row.input && row.input.lifecycle_status ? row.input.lifecycle_status : 'open',
      has_subtasks: row.input && row.input.has_subtasks === true,
      explicit_project_signal: row.input && row.input.explicit_project_signal === true,
    },
    output: {
      normalized_title_en: String(row.expect && row.expect.normalized_title_en ? row.expect.normalized_title_en : ''),
      task_shape: String(row.expect && row.expect.task_shape ? row.expect.task_shape : 'unknown'),
      suggested_next_action: row.expect && row.expect.suggested_next_action ? row.expect.suggested_next_action : null,
      parse_confidence: 0.9,
    },
  }));
}

async function run() {
  const args = parseArgs(process.argv);
  const stamp = utcStamp();
  const {
    backendUrl,
    adminSecret,
    timeoutMs,
    checkObservability: checkObs,
  } = resolveRunnerOptions(args);

  const fixtures = loadTodoistNormalizeFixtures();
  assertFixtureTargets(fixtures);
  const promptRows = fixtures.filter((row) => row.corpus_group === 'prompt_examples');
  const evalRowsAll = fixtures.filter((row) => row.corpus_group === 'eval_core');
  const caseLimit = parsePositiveCaseLimit(args);
  const evalRows = caseLimit ? evalRowsAll.slice(0, caseLimit) : evalRowsAll;
  const promptExamples = buildPromptExamples(promptRows);

  const results = [];
  let seq = 0;

  for (const row of evalRows) {
    seq += 1;
    const runId = `eval.todoist.${stamp}.${row.case_id}`;
    const response = await postTodoistEvalNormalize({
      backendUrl,
      adminSecret,
      runId,
      timeoutMs,
      body: {
        raw_title: row.input.raw_title,
        raw_description: row.input.raw_description || null,
        project_key: row.input.project_key || null,
        todoist_section_name: row.input.todoist_section_name || null,
        lifecycle_status: row.input.lifecycle_status || 'open',
        has_subtasks: row.input.has_subtasks === true,
        explicit_project_signal: row.input.explicit_project_signal === true,
        few_shot_examples: promptExamples,
      },
    });

    const observabilityOk = checkObs
      ? await checkRunObservability({ backendUrl, adminSecret, runId, timeoutMs })
      : null;

    const parsed = response && response.normalized_task && typeof response.normalized_task === 'object'
      ? response.normalized_task
      : {};
    const trace = response && response.normalize_trace && typeof response.normalize_trace === 'object'
      ? response.normalize_trace
      : {};

    const expectedShape = String(row.expect.task_shape || '').trim().toLowerCase();
    const actualShape = String(parsed.task_shape || '').trim().toLowerCase();
    const expectedTitle = String(row.expect.normalized_title_en || '');
    const actualTitle = String(parsed.normalized_title_en || '');
    const shapeMatch = expectedShape === actualShape;
    const titleMatch = normalizeText(expectedTitle) === normalizeText(actualTitle);

    results.push({
      case_id: row.case_id,
      name: row.name,
      bucket: row.bucket,
      corpus_group: row.corpus_group,
      failure_tags: row.failure_tags,
      run_id: runId,
      expected_task_shape: expectedShape,
      actual_task_shape: actualShape,
      expected_normalized_title_en: expectedTitle,
      actual_normalized_title_en: actualTitle,
      parse_confidence: Number(parsed.parse_confidence || 0),
      llm_used: !!trace.llm_used,
      llm_reason: trace.llm_reason || null,
      parse_status: trace.parse_status || null,
      shape_match: shapeMatch,
      title_match: titleMatch,
      pass: shapeMatch && titleMatch,
      observability_ok: observabilityOk,
      prompt_example_count: promptExamples.length,
      sequence: seq,
    });
  }

  const summary = scoreTodoistNormalizeResults(results);
  const report = {
    metadata: {
      surface: 'todoist_normalize',
      timestamp: stamp,
      backend_url: backendUrl,
      fixture_files: ['evals/todoist/fixtures/gold/normalize.json'],
      selected_cases: evalRows.length,
      prompt_example_count: promptExamples.length,
      targets: {
        task_shape_accuracy_gte: 0.85,
        project_overcall_rate_lte: 0.1,
        normalized_title_match_rate_gte: 0.75,
      },
      next_action_metric: 'pending_missing_labels',
      non_gating: true,
    },
    summary,
    cases: results,
  };

  const markdown = buildTodoistMarkdown(report);
  const paths = writeEvalReport('todoist', stamp, report, markdown);

  printEvalCompletion({
    message: 'Todoist normalize eval complete.',
    paths,
    metricLine: `Shape accuracy: ${(Number(summary.task_shape_accuracy || 0) * 100).toFixed(1)}%`,
  });
}

if (require.main === module) {
  run().catch((err) => {
    process.stderr.write(`Todoist eval runner failed: ${err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  run,
  buildPromptExamples,
};
