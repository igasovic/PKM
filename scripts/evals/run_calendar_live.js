#!/usr/bin/env node
'use strict';

const {
  parseArgs,
  utcStamp,
  toInt,
} = require('./lib/io.js');
const { loadNormalizeFixtures } = require('./lib/fixtures.js');
const {
  postCalendarNormalize,
  getDebugRun,
} = require('./lib/live-api.js');
const { scoreNormalizeResults } = require('./lib/scoring.js');
const { buildCalendarMarkdown, writeEvalReport } = require('./lib/reporting.js');

function requireSecret(args) {
  const secret = String(args['admin-secret'] || process.env.PKM_ADMIN_SECRET || '').trim();
  if (!secret) {
    throw new Error('Missing admin secret. Set --admin-secret or PKM_ADMIN_SECRET.');
  }
  return secret;
}

async function checkObservability({ backendUrl, adminSecret, runId, timeoutMs }) {
  try {
    const out = await getDebugRun({
      backendUrl,
      adminSecret,
      runId,
      limit: 50,
      timeoutMs,
    });
    return Array.isArray(out.rows) && out.rows.length > 0;
  } catch (_err) {
    return false;
  }
}

function assertFixtureTargets(rows) {
  if (rows.length < 40) {
    throw new Error(`Normalization eval corpus too small: expected at least 40, found ${rows.length}.`);
  }
  const counts = rows.reduce((acc, row) => {
    const bucket = row.bucket || 'unknown';
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {});
  if ((counts.clean || 0) < 20) {
    throw new Error(`Normalization clean bucket too small: expected >=20, found ${counts.clean || 0}.`);
  }
  if ((counts.clarification || 0) < 10) {
    throw new Error(`Normalization clarification bucket too small: expected >=10, found ${counts.clarification || 0}.`);
  }
  if ((counts.rejection_edge || 0) < 10) {
    throw new Error(`Normalization rejection/edge bucket too small: expected >=10, found ${counts.rejection_edge || 0}.`);
  }
}

function evaluateAssertions(expect, response) {
  let total = 1;
  let passed = String(response.status || '') === String(expect.status || '');
  const details = [];

  if (Array.isArray(expect.missing_fields_includes)) {
    total += 1;
    const actualMissing = Array.isArray(response.missing_fields) ? response.missing_fields : [];
    const ok = expect.missing_fields_includes.every((field) => actualMissing.includes(field));
    passed = passed && ok;
    details.push({ field: 'missing_fields_includes', ok });
  }

  if (expect.reason_code) {
    total += 1;
    const actual = String(response.reason_code || response.error?.reason_code || '');
    const ok = actual === String(expect.reason_code);
    passed = passed && ok;
    details.push({ field: 'reason_code', ok });
  }

  const event = response.normalized_event && typeof response.normalized_event === 'object'
    ? response.normalized_event
    : null;

  const checks = [
    ['category_code', event ? event.category_code : null],
    ['duration_minutes', event ? event.duration_minutes : null],
    ['subject_people_tag', event ? event.subject_people_tag : null],
  ];

  for (const [key, actualValue] of checks) {
    if (expect[key] !== undefined) {
      total += 1;
      const ok = String(actualValue) === String(expect[key]);
      passed = passed && ok;
      details.push({ field: key, ok });
    }
  }

  if (expect.padded !== undefined) {
    total += 1;
    const blockWindow = event && event.block_window && typeof event.block_window === 'object'
      ? event.block_window
      : null;
    const hasPadded = !!(blockWindow && Object.prototype.hasOwnProperty.call(blockWindow, 'padded'));
    const actual = hasPadded ? blockWindow.padded : null;
    const ok = hasPadded && Boolean(actual) === Boolean(expect.padded);
    passed = passed && ok;
    details.push({ field: 'padded', ok });
  }

  if (expect.location_prefix) {
    total += 1;
    const actual = String(event && event.location ? event.location : '');
    const ok = actual.startsWith(String(expect.location_prefix));
    passed = passed && ok;
    details.push({ field: 'location_prefix', ok });
  }

  if (expect.logical_color) {
    total += 1;
    const actual = String(event && event.color_choice ? event.color_choice.logical_color : '');
    const ok = actual === String(expect.logical_color);
    passed = passed && ok;
    details.push({ field: 'logical_color', ok });
  }

  return {
    pass: passed,
    assertions_total: total,
    assertions_passed: details.filter((row) => row.ok).length + (String(response.status || '') === String(expect.status || '') ? 1 : 0),
    assertion_details: details,
  };
}

async function run() {
  const args = parseArgs(process.argv);
  const stamp = utcStamp();
  const backendUrl = String(args['backend-url'] || process.env.EVAL_BACKEND_URL || 'http://localhost:8080').trim();
  const adminSecret = requireSecret(args);
  const telegramUserId = String(args['telegram-user-id'] || process.env.EVAL_TELEGRAM_USER_ID || '1509032341').trim();
  const timeoutMs = Number(args.timeout || process.env.EVAL_TIMEOUT_MS || 15000);
  const caseLimit = toInt(args['case-limit'], 0);
  const checkObs = args['no-observability-check'] ? false : true;

  const fixtures = loadNormalizeFixtures();
  assertFixtureTargets(fixtures);
  const selected = caseLimit > 0 ? fixtures.slice(0, caseLimit) : fixtures;

  const results = [];
  let seq = 0;

  for (const row of selected) {
    seq += 1;
    const runId = `eval.calendar.${stamp}.${row.case_id}`;
    const chatId = `eval-calendar-chat-${stamp}-${seq}`;
    const messageId = `eval-calendar-msg-${seq}`;

    const response = await postCalendarNormalize({
      backendUrl,
      adminSecret,
      runId,
      timeoutMs,
      body: {
        raw_text: row.input.raw_text,
        timezone: row.input.timezone,
        clarification_turns: row.input.clarification_turns,
        include_trace: true,
        source: {
          chat_id: chatId,
          message_id: messageId,
          user_id: telegramUserId,
        },
      },
    });

    const observabilityOk = checkObs
      ? await checkObservability({ backendUrl, adminSecret, runId, timeoutMs })
      : null;

    const assertionResult = evaluateAssertions(row.expect || {}, response);
    const trace = response.normalize_trace && typeof response.normalize_trace === 'object'
      ? response.normalize_trace
      : null;

    results.push({
      case_id: row.case_id,
      name: row.name,
      bucket: row.bucket,
      failure_tags: row.failure_tags,
      run_id: runId,
      expect: row.expect,
      expected_status: String(row.expect.status || ''),
      actual_status: String(response.status || ''),
      actual_missing_fields: Array.isArray(response.missing_fields) ? response.missing_fields : [],
      llm_confidence: trace ? trace.llm_confidence : null,
      llm_used: trace ? trace.llm_used : null,
      observability_ok: observabilityOk,
      pass: assertionResult.pass,
      assertions_total: assertionResult.assertions_total,
      assertions_passed: assertionResult.assertions_passed,
      assertion_details: assertionResult.assertion_details,
    });
  }

  const summary = scoreNormalizeResults(results);
  const report = {
    metadata: {
      surface: 'calendar_normalize',
      timestamp: stamp,
      backend_url: backendUrl,
      fixture_files: ['evals/calendar/fixtures/gold/normalize.json'],
      selected_cases: selected.length,
      targets: {
        field_extraction_gte: 0.95,
        clarification_accuracy_gte: 0.97,
        deterministic_correctness_eq: 1,
      },
      non_gating: true,
    },
    summary,
    cases: results,
  };

  const markdown = buildCalendarMarkdown(report);
  const paths = writeEvalReport('calendar', stamp, report, markdown);

  process.stdout.write(`Calendar normalize eval complete.\n`);
  process.stdout.write(`JSON: ${paths.jsonPath}\n`);
  process.stdout.write(`Markdown: ${paths.mdPath}\n`);
  process.stdout.write(`Accuracy: ${(Number(summary.accuracy || 0) * 100).toFixed(1)}% (${summary.passed}/${summary.total})\n`);
}

if (require.main === module) {
  run().catch((err) => {
    process.stderr.write(`Calendar eval runner failed: ${err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  evaluateAssertions,
};
