'use strict';

const {
  distillTier2SingleEntrySync,
} = require('../tier2/service.js');
const {
  runTier2ControlPlanePlan,
} = require('../tier2/planner.js');
const {
  runTier2BatchWorkerCycle,
} = require('../tier2-enrichment.js');
const {
  requireAdminSecret,
  readBody,
  parseJsonBody,
  bindRunIdFromBody,
  json,
  sendError,
} = require('../app/http-utils.js');
const { logError } = require('../logger/braintrust.js');

async function handleDistillRoutes(ctx) {
  const {
    req,
    res,
    url,
    method,
    logger,
  } = ctx;

  if (method === 'POST' && url.pathname === '/distill/sync') {
    try {
      requireAdminSecret(req);
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const result = await logger.step(
        'api.distill.sync',
        async () => distillTier2SingleEntrySync(body.entry_id),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      json(res, 200, result);
    } catch (err) {
      logError(err, req);
      sendError(res, err);
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/distill/plan') {
    try {
      requireAdminSecret(req);
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const result = await logger.step(
        'api.distill.plan',
        async () => runTier2ControlPlanePlan({
          candidate_limit: body.candidate_limit,
          persist_eligibility: body.persist_eligibility,
          include_details: body.include_details,
        }),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      json(res, 200, result);
    } catch (err) {
      logError(err, req);
      sendError(res, err);
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/distill/run') {
    try {
      requireAdminSecret(req);
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const result = await logger.step(
        'api.distill.run',
        async () => runTier2BatchWorkerCycle({
          execution_mode: body.execution_mode || body.mode,
          candidate_limit: body.candidate_limit,
          max_sync_items: body.max_sync_items,
          persist_eligibility: body.persist_eligibility,
          dry_run: body.dry_run,
        }),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      json(res, 200, result);
    } catch (err) {
      logError(err, req);
      sendError(res, err);
    }
    return true;
  }

  return false;
}

module.exports = {
  handleDistillRoutes,
};
