#!/usr/bin/env node
'use strict';

const path = require('path');
const {
  parseArgs,
  utcStamp,
  resolveRepoPath,
  writeJsonFile,
} = require('./lib/io.js');
const {
  getDebugRun,
  getFailureBundle,
} = require('./lib/live-api.js');

function requireSecret(args) {
  const secret = String(args['admin-secret'] || process.env.PKM_ADMIN_SECRET || '').trim();
  if (!secret) {
    throw new Error('Missing admin secret. Set --admin-secret or PKM_ADMIN_SECRET.');
  }
  return secret;
}

function requireRunId(args) {
  const runId = String(args['run-id'] || '').trim();
  if (!runId) throw new Error('Missing --run-id argument.');
  return runId;
}

function normalizeSurface(args) {
  const raw = String(args.surface || '').trim().toLowerCase();
  if (!raw || raw === 'normalize' || raw === 'calendar') return 'calendar';
  if (raw === 'router') return 'router';
  throw new Error('Unsupported --surface value. Use router or calendar.');
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function firstText(...candidates) {
  for (const value of candidates) {
    const str = String(value === undefined || value === null ? '' : value).trim();
    if (str) return str;
  }
  return '';
}

function findRowsForStep(rows, stepName) {
  const all = Array.isArray(rows) ? rows : [];
  return all.filter((row) => String(row.step || '') === stepName);
}

function pickRouterSeed(runTraceRows, failurePack) {
  const rows = findRowsForStep(runTraceRows, 'api.telegram.route');
  const startRow = rows.find((row) => String(row.direction || '') === 'start') || rows[0] || null;
  const endRow = [...rows].reverse().find((row) => String(row.direction || '') === 'end') || rows[rows.length - 1] || null;

  const input = asObject(startRow && startRow.input_summary);
  const nestedInput = asObject(input.input);
  const pack = asObject(failurePack);

  const text = firstText(
    input.text,
    input.raw_text,
    input.message_text,
    nestedInput.text,
    nestedInput.raw_text,
    pack.raw_text,
    pack.text,
    '__TODO_TEXT__'
  );

  return {
    input: {
      text,
    },
    observed_output: asObject(endRow && endRow.output_summary),
    harvested_from_step: 'api.telegram.route',
  };
}

function pickCalendarSeed(runTraceRows, failurePack) {
  const rows = findRowsForStep(runTraceRows, 'api.calendar.normalize');
  const startRow = rows.find((row) => String(row.direction || '') === 'start') || rows[0] || null;
  const endRow = [...rows].reverse().find((row) => String(row.direction || '') === 'end') || rows[rows.length - 1] || null;

  const input = asObject(startRow && startRow.input_summary);
  const nestedInput = asObject(input.input);
  const pack = asObject(failurePack);
  const candidateRawText = firstText(
    input.raw_text,
    nestedInput.raw_text,
    pack.raw_text,
    pack.text,
    pack?.payload?.raw_text,
    '__TODO_RAW_TEXT__'
  );

  return {
    input: {
      raw_text: candidateRawText,
    },
    observed_output: asObject(endRow && endRow.output_summary),
    harvested_from_step: 'api.calendar.normalize',
  };
}

function buildCandidate({ surface, runId, seed, stamp }) {
  if (surface === 'router') {
    return {
      case_id: `cand-router-${stamp}-${runId}`,
      name: `harvested router candidate from run ${runId}`,
      bucket: 'candidate',
      failure_tags: ['harvested', 'manual_review_required'],
      input: seed.input,
      expect: {
        route: 'TODO_ROUTE',
      },
      harvested: {
        source_run_id: runId,
        harvested_at: new Date().toISOString(),
        harvested_from_step: seed.harvested_from_step,
        observed_output: seed.observed_output,
      },
      notes: [
        'Auto-harvested from debug run trace summaries.',
        'Fill expect.route before promoting to gold.',
      ],
    };
  }

  return {
    case_id: `cand-calendar-${stamp}-${runId}`,
    name: `harvested normalize candidate from run ${runId}`,
    bucket: 'candidate',
    failure_tags: ['harvested', 'manual_review_required'],
    input: seed.input,
    expect: {
      status: 'TODO_STATUS',
    },
    harvested: {
      source_run_id: runId,
      harvested_at: new Date().toISOString(),
      harvested_from_step: seed.harvested_from_step,
      observed_output: seed.observed_output,
    },
    notes: [
      'Auto-harvested from debug run trace summaries.',
      'Fill expect.status and optional assertions before promoting to gold.',
      'If raw_text is TODO, retrieve it from calendar business logs before promotion.',
    ],
  };
}

async function fetchTrace({ backendUrl, adminSecret, runId, timeoutMs }) {
  let runTrace = null;
  let failurePack = null;

  try {
    const bundle = await getFailureBundle({
      backendUrl,
      adminSecret,
      runId,
      traceLimit: 500,
      timeoutMs,
    });
    runTrace = asObject(bundle.run_trace);
    failurePack = asObject(bundle.pack);
  } catch (_err) {
    // fall back to /debug/run only
  }

  if (!runTrace || !Array.isArray(runTrace.rows)) {
    const runOnly = await getDebugRun({
      backendUrl,
      adminSecret,
      runId,
      limit: 500,
      timeoutMs,
    });
    runTrace = runOnly;
  }

  return {
    rows: Array.isArray(runTrace.rows) ? runTrace.rows : [],
    failurePack,
  };
}

async function run() {
  const args = parseArgs(process.argv);
  const stamp = utcStamp();
  const backendUrl = String(args['backend-url'] || process.env.EVAL_BACKEND_URL || 'http://localhost:8080').trim();
  const adminSecret = requireSecret(args);
  const runId = requireRunId(args);
  const surface = normalizeSurface(args);
  const timeoutMs = Number(args.timeout || process.env.EVAL_TIMEOUT_MS || 15000);

  const { rows, failurePack } = await fetchTrace({
    backendUrl,
    adminSecret,
    runId,
    timeoutMs,
  });

  const seed = surface === 'router'
    ? pickRouterSeed(rows, failurePack)
    : pickCalendarSeed(rows, failurePack);

  const candidate = buildCandidate({
    surface,
    runId,
    seed,
    stamp,
  });

  const outDir = surface === 'router'
    ? resolveRepoPath('evals/router/fixtures/candidates')
    : resolveRepoPath('evals/calendar/fixtures/candidates');
  const fileName = `${stamp}__${runId.replace(/[^a-zA-Z0-9_.-]/g, '_')}.json`;
  const outPath = path.join(outDir, fileName);

  writeJsonFile(outPath, candidate);

  process.stdout.write(`Candidate written: ${outPath}\n`);
  process.stdout.write('Next step: manually fill expect.* and move to fixtures/gold after review.\n');
}

run().catch((err) => {
  process.stderr.write(`Harvest script failed: ${err.message}\n`);
  process.exitCode = 1;
});
