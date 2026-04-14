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
const { loadRouterFixtures } = require('./lib/fixtures.js');
const {
  postTelegramRoute,
  postCalendarNormalize,
} = require('./lib/live-api.js');
const { scoreRouterResults } = require('./lib/scoring.js');
const { buildRouterMarkdown, writeEvalReport } = require('./lib/reporting.js');

function assertFixtureTargets(stateless, stateful) {
  const total = stateless.length + stateful.length;
  if (total < 50) {
    throw new Error(`Router eval corpus too small: expected at least 50, found ${total}.`);
  }

  const bucketCounts = stateless.reduce((acc, row) => {
    const key = row.bucket || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  if ((bucketCounts.obvious || 0) < 20) {
    throw new Error(`Router obvious bucket too small: expected >=20, found ${bucketCounts.obvious || 0}.`);
  }
  if ((bucketCounts.ambiguous || 0) < 15) {
    throw new Error(`Router ambiguous bucket too small: expected >=15, found ${bucketCounts.ambiguous || 0}.`);
  }
  if ((bucketCounts.adversarial_edge || 0) < 15) {
    throw new Error(`Router adversarial/edge bucket too small: expected >=15, found ${bucketCounts.adversarial_edge || 0}.`);
  }
  if (stateful.length < 5) {
    throw new Error(`Router stateful set too small: expected >=5, found ${stateful.length}.`);
  }
}

async function run() {
  const args = parseArgs(process.argv);
  const stamp = utcStamp();
  const {
    backendUrl,
    adminSecret,
    telegramUserId,
    timeoutMs,
    checkObservability: checkObs,
  } = resolveRunnerOptions(args, { includeTelegramUserId: true });

  const fixtures = loadRouterFixtures();
  assertFixtureTargets(fixtures.stateless, fixtures.stateful);

  const caseLimit = parsePositiveCaseLimit(args);
  const selectedStateless = caseLimit ? fixtures.stateless.slice(0, caseLimit) : fixtures.stateless;
  const selectedStateful = caseLimit ? fixtures.stateful.slice(0, Math.max(1, Math.floor(caseLimit / 4))) : fixtures.stateful;

  const results = [];
  let seq = 0;

  for (const row of selectedStateless) {
    seq += 1;
    const runId = `eval.router.${stamp}.${row.case_id}`;
    const chatId = `eval-router-chat-${stamp}-${seq}`;
    const messageId = `eval-router-msg-${seq}`;
    const started = Date.now();

    const response = await postTelegramRoute({
      backendUrl,
      adminSecret,
      runId,
      timeoutMs,
      body: {
        text: row.input.text,
        source: {
          chat_id: chatId,
          message_id: messageId,
          user_id: telegramUserId,
        },
      },
    });

    const observabilityOk = checkObs
      ? await checkRunObservability({ backendUrl, adminSecret, runId, timeoutMs })
      : null;

    const actualRoute = String(response.route || '');
    const expectedRoute = String(row.expect.route || '');
    const pass = actualRoute === expectedRoute;

    results.push({
      case_id: row.case_id,
      name: row.name,
      bucket: row.bucket,
      mode: 'stateless',
      failure_tags: row.failure_tags,
      run_id: runId,
      expected_route: expectedRoute,
      actual_route: actualRoute,
      confidence: Number(response.confidence || 0),
      request_id: response.request_id || null,
      pass,
      observability_ok: observabilityOk,
      duration_ms: Date.now() - started,
    });
  }

  for (const row of selectedStateful) {
    seq += 1;
    const baseRunId = `eval.router.${stamp}.${row.case_id}`;
    const setupRunId = `${baseRunId}.setup`;
    const runId = `${baseRunId}.route`;
    const chatId = `eval-router-stateful-chat-${stamp}-${seq}`;

    const setupResponse = await postCalendarNormalize({
      backendUrl,
      adminSecret,
      runId: setupRunId,
      timeoutMs,
      body: {
        raw_text: row.setup.raw_text,
        source: {
          chat_id: chatId,
          message_id: `setup-${seq}`,
          user_id: telegramUserId,
        },
      },
    });

    const routeResponse = await postTelegramRoute({
      backendUrl,
      adminSecret,
      runId,
      timeoutMs,
      body: {
        text: row.input.text,
        source: {
          chat_id: chatId,
          message_id: `follow-${seq}`,
          user_id: telegramUserId,
        },
      },
    });

    const observabilityOk = checkObs
      ? await checkRunObservability({ backendUrl, adminSecret, runId, timeoutMs })
      : null;

    const expectedRoute = String(row.expect.route || '');
    const actualRoute = String(routeResponse.route || '');
    const setupExpected = String(row.setup.expect_status || 'needs_clarification');
    const setupOk = String(setupResponse.status || '') === setupExpected;

    results.push({
      case_id: row.case_id,
      name: row.name,
      bucket: row.bucket,
      mode: 'stateful',
      failure_tags: row.failure_tags,
      run_id: runId,
      setup_run_id: setupRunId,
      setup_expected_status: setupExpected,
      setup_actual_status: setupResponse.status || null,
      setup_ok: setupOk,
      expected_route: expectedRoute,
      actual_route: actualRoute,
      confidence: Number(routeResponse.confidence || 0),
      request_id: routeResponse.request_id || null,
      pass: setupOk && actualRoute === expectedRoute,
      observability_ok: observabilityOk,
    });
  }

  const summary = scoreRouterResults(results);
  const report = {
    metadata: {
      surface: 'router',
      timestamp: stamp,
      backend_url: backendUrl,
      fixture_files: [
        'evals/router/fixtures/gold/stateless.json',
        'evals/router/fixtures/gold/stateful.json',
      ],
      selected_stateless: selectedStateless.length,
      selected_stateful: selectedStateful.length,
      targets: {
        accuracy_gte: 0.95,
        calendar_create_precision_gte: 0.98,
        ambiguous_recall_gte: 0.93,
      },
      non_gating: true,
    },
    summary,
    cases: results,
  };

  const markdown = buildRouterMarkdown(report);
  const paths = writeEvalReport('router', stamp, report, markdown);

  printEvalCompletion({
    message: 'Router eval complete.',
    paths,
    metricLine: `Accuracy: ${(Number(summary.accuracy || 0) * 100).toFixed(1)}% (${summary.passed}/${summary.total})`,
  });
}

run().catch((err) => {
  process.stderr.write(`Router eval runner failed: ${err.message}\n`);
  process.exitCode = 1;
});
