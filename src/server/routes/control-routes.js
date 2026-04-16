'use strict';

const pkg = require('../package.json');
const { getConfig } = require('../../libs/config.js');
const {
  runChatgptWorkingMemoryAction,
  runChatgptWrapCommitAction,
  runChatgptTopicStatePatchAction,
} = require('../chatgpt-actions.js');
const debugRepository = require('../repositories/debug-repository.js');
const {
  normalizeFailurePackEnvelope,
  summarizeForLog,
} = require('../../libs/failure-pack.js');
const {
  requireAdminSecret,
  readBody,
  parseJsonBody,
  bindRunIdFromBody,
  asText,
  json,
  notFound,
  sendError,
  failurePackResponseRow,
  failurePackSummaryRow,
} = require('../app/http-utils.js');
const { getRunContext } = require('../logger/context.js');
const { logError } = require('../logger/braintrust.js');

async function handleControlRoutes(ctx) {
  const {
    req,
    res,
    url,
    method,
    logger,
    testModeService,
  } = ctx;

  if (method === 'GET' && url.pathname === '/health') {
    json(res, 200, { status: 'ok' });
    return true;
  }

  if (method === 'GET' && url.pathname === '/ready') {
    json(res, 200, { status: 'ready' });
    return true;
  }

  if (method === 'GET' && url.pathname === '/version') {
    json(res, 200, { name: pkg.name, version: pkg.version });
    return true;
  }

  if (method === 'GET' && url.pathname === '/config') {
    json(res, 200, getConfig());
    return true;
  }

  if (
    method === 'POST'
    && (url.pathname === '/chatgpt/working_memory' || url.pathname === '/chatgpt/working_memory/')
  ) {
    try {
      requireAdminSecret(req);
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const requestId = asText(body.request_id) || null;
      const runId = asText(body.run_id) || null;
      const result = await logger.step(
        'api.chatgpt.working_memory',
        async () => runChatgptWorkingMemoryAction(body, {
          request_id: requestId,
          run_id: runId,
          logger: logger.child({ pipeline: 'chatgpt_actions' }),
        }),
        {
          input: {
            has_topic: !!asText(body.topic || body.topic_primary || body.resolved_topic_primary),
          },
          output: (out) => ({
            action: out && out.action ? out.action : null,
            method: out && out.method ? out.method : null,
            outcome: out && out.outcome ? out.outcome : null,
          }),
          meta: { route: url.pathname },
        },
      );
      json(res, 200, result);
    } catch (err) {
      logError(err, req);
      sendError(res, err);
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/chatgpt/wrap-commit') {
    try {
      requireAdminSecret(req);
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const requestId = asText(body.request_id) || null;
      const runId = asText(body.run_id) || null;
      const result = await logger.step(
        'api.chatgpt.wrap_commit',
        async () => runChatgptWrapCommitAction(body, {
          request_id: requestId,
          run_id: runId,
          logger: logger.child({ pipeline: 'chatgpt_actions' }),
        }),
        {
          input: {
            has_session_id: !!asText(body.session_id),
            topic_primary: asText(body.resolved_topic_primary) || null,
          },
          output: (out) => ({
            action: out && out.action ? out.action : null,
            outcome: out && out.outcome ? out.outcome : null,
            has_session_note: !!(out && out.result && out.result.session_note),
            has_working_memory: !!(out && out.result && out.result.working_memory),
          }),
          meta: { route: url.pathname },
        },
      );
      json(res, 200, result);
    } catch (err) {
      logError(err, req);
      sendError(res, err);
    }
    return true;
  }

  if (
    method === 'POST'
    && (url.pathname === '/chatgpt/topic-state' || url.pathname === '/chatgpt/topic-state/')
  ) {
    try {
      requireAdminSecret(req);
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const requestId = asText(body.request_id) || null;
      const runId = asText(body.run_id) || null;
      const result = await logger.step(
        'api.chatgpt.topic_state_patch',
        async () => runChatgptTopicStatePatchAction(body, {
          request_id: requestId,
          run_id: runId,
          logger: logger.child({ pipeline: 'chatgpt_actions' }),
        }),
        {
          input: {
            has_topic: !!asText(body.topic || body.topic_primary || body.resolved_topic_primary || body.topic_key),
            has_topic_patch: !!(body.topic_patch && typeof body.topic_patch === 'object'),
          },
          output: (out) => ({
            action: out && out.action ? out.action : null,
            outcome: out && out.outcome ? out.outcome : null,
          }),
          meta: { route: url.pathname },
        },
      );
      json(res, 200, result);
    } catch (err) {
      logError(err, req);
      sendError(res, err);
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/debug/failures') {
    try {
      requireAdminSecret(req);
      const raw = await readBody(req, 5 * 1024 * 1024);
      const body = parseJsonBody(raw);
      if (!body.run_id) {
        body.run_id = asText(req.headers['x-pkm-run-id']);
      }
      bindRunIdFromBody(body);
      const envelope = normalizeFailurePackEnvelope(body);
      const result = await logger.step(
        'api.debug.failures.write',
        async () => debugRepository.upsertFailurePack(envelope),
        {
          input: summarizeForLog(envelope),
          output: (out) => ({
            failure_id: out && out.failure_id ? out.failure_id : null,
            run_id: out && out.run_id ? out.run_id : null,
            status: out && out.status ? out.status : null,
            upsert_action: out && out.upsert_action ? out.upsert_action : null,
          }),
          meta: { route: url.pathname },
        }
      );
      json(res, 200, {
        failure_id: result.failure_id || null,
        run_id: result.run_id || envelope.run_id,
        status: result.status || envelope.status || 'captured',
        upsert_action: result.upsert_action || 'updated',
      });
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  const debugFailureByRunMatch = (method === 'GET')
    ? url.pathname.match(/^\/debug\/failures\/by-run\/([^/]+)$/)
    : null;
  if (debugFailureByRunMatch) {
    try {
      requireAdminSecret(req);
      const run_id = decodeURIComponent(debugFailureByRunMatch[1]);
      const row = await logger.step(
        'api.debug.failures.get_by_run',
        async () => debugRepository.getFailurePackByRunId(run_id),
        {
          input: { run_id },
          output: (out) => out ? { run_id: out.run_id, failure_id: out.failure_id } : { run_id, found: false },
          meta: { route: url.pathname },
        }
      );
      if (!row) {
        notFound(res);
      } else {
        json(res, 200, failurePackResponseRow(row));
      }
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  if (method === 'GET' && url.pathname === '/debug/failures') {
    try {
      requireAdminSecret(req);
      const limit = Number(url.searchParams.get('limit') || 20);
      const before_ts = url.searchParams.get('before_ts') || null;
      const workflow_name = url.searchParams.get('workflow_name') || null;
      const node_name = url.searchParams.get('node_name') || null;
      const mode = url.searchParams.get('mode') || null;
      const result = await logger.step(
        'api.debug.failures.list',
        async () => debugRepository.listFailurePacks({ limit, before_ts, workflow_name, node_name, mode }),
        {
          input: { limit, before_ts, workflow_name, node_name, mode },
          output: (out) => ({
            count: out && Array.isArray(out.rows) ? out.rows.length : 0,
            limit: out && out.limit ? out.limit : limit,
          }),
          meta: { route: url.pathname },
        }
      );
      json(res, 200, {
        ...result,
        rows: Array.isArray(result.rows) ? result.rows.map((row) => failurePackSummaryRow(row)) : [],
      });
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  const debugFailureByIdMatch = (method === 'GET')
    ? url.pathname.match(/^\/debug\/failures\/([^/]+)$/)
    : null;
  if (debugFailureByIdMatch) {
    try {
      requireAdminSecret(req);
      const failure_id = decodeURIComponent(debugFailureByIdMatch[1]);
      const row = await logger.step(
        'api.debug.failures.get_by_id',
        async () => debugRepository.getFailurePackById(failure_id),
        {
          input: { failure_id },
          output: (out) => out ? { failure_id: out.failure_id, run_id: out.run_id } : { failure_id, found: false },
          meta: { route: url.pathname },
        }
      );
      if (!row) {
        notFound(res);
      } else {
        json(res, 200, failurePackResponseRow(row));
      }
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  const debugFailureBundleMatch = (method === 'GET')
    ? url.pathname.match(/^\/debug\/failure-bundle\/([^/]+)$/)
    : null;
  if (debugFailureBundleMatch) {
    try {
      requireAdminSecret(req);
      const run_id = decodeURIComponent(debugFailureBundleMatch[1]);
      const traceLimit = Number(url.searchParams.get('trace_limit') || 5000);
      const failureRow = await logger.step(
        'api.debug.failure_bundle',
        async () => debugRepository.getFailurePackByRunId(run_id),
        {
          input: { run_id, trace_limit: traceLimit },
          output: (out) => out ? { found: true, run_id: out.run_id, failure_id: out.failure_id } : { found: false, run_id },
          meta: { route: url.pathname },
        }
      );
      if (!failureRow) {
        notFound(res);
      } else {
        const runTrace = await debugRepository.getPipelineRun(run_id, { limit: traceLimit });
        json(res, 200, {
          run_id,
          failure: {
            failure_id: failureRow.failure_id,
            workflow_name: failureRow.workflow_name,
            node_name: failureRow.node_name,
            error_message: failureRow.error_message,
            failed_at: failureRow.failed_at,
            mode: failureRow.mode || null,
            status: failureRow.status || null,
          },
          pack: failureRow.pack || null,
          run_trace: runTrace,
        });
      }
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  if (method === 'GET' && url.pathname === '/debug/run/last') {
    try {
      requireAdminSecret(req);
      const limit = Number(url.searchParams.get('limit') || 5000);
      const ctxRun = getRunContext() || {};
      const exclude_run_id = ctxRun.run_id || null;
      const result = await logger.step(
        'api.debug.run.last',
        async () => debugRepository.getLastPipelineRun({ limit, exclude_run_id }),
        {
          input: { limit, exclude_run_id },
          output: (out) => ({ run_id: out.run_id, rows: out.rows }),
          meta: { route: url.pathname },
        }
      );
      json(res, 200, result);
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  if (method === 'GET' && url.pathname === '/debug/runs') {
    try {
      requireAdminSecret(req);
      const limit = Number(url.searchParams.get('limit') || 50);
      const before_ts = url.searchParams.get('before_ts') || url.searchParams.get('before') || null;
      const has_error = url.searchParams.get('has_error');
      const pipeline = url.searchParams.get('pipeline') || null;
      const step = url.searchParams.get('step') || null;
      const result = await logger.step(
        'api.debug.runs',
        async () => debugRepository.getRecentPipelineRuns({
          limit,
          before_ts,
          has_error,
          pipeline,
          step,
        }),
        {
          input: { limit, before_ts, has_error, pipeline, step },
          output: (out) => ({ count: Array.isArray(out.rows) ? out.rows.length : 0 }),
          meta: { route: url.pathname },
        }
      );
      json(res, 200, result);
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  const debugRunMatch = (method === 'GET')
    ? url.pathname.match(/^\/debug\/run\/([^/]+)$/)
    : null;
  if (debugRunMatch) {
    try {
      requireAdminSecret(req);
      const run_id = decodeURIComponent(debugRunMatch[1]);
      const limit = Number(url.searchParams.get('limit') || 5000);
      const result = await logger.step(
        'api.debug.run',
        async () => debugRepository.getPipelineRun(run_id, { limit }),
        { input: { run_id, limit }, output: (out) => ({ run_id: out.run_id, rows: out.rows }), meta: { route: url.pathname } }
      );
      json(res, 200, result);
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  if (method === 'GET' && url.pathname === '/db/test-mode') {
    const state = await testModeService.getState();
    const info = testModeService.getWatchdogInfo();
    json(res, 200, [{ is_test_mode: state, test_mode_on_since: info.test_mode_on_since || null }]);
    return true;
  }

  if (method === 'POST' && url.pathname === '/echo') {
    try {
      const raw = await readBody(req);
      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        const parsed = raw ? JSON.parse(raw) : null;
        bindRunIdFromBody(parsed);
        json(res, 200, { ok: true, data: parsed });
      } else {
        json(res, 200, { ok: true, data: raw });
      }
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleControlRoutes,
};
