'use strict';

const todoistRepository = require('../repositories/todoist-repository.js');
const {
  requireAdminSecret,
  readBody,
  parseJsonBody,
  bindRunIdFromBody,
  asText,
  json,
  sendError,
} = require('../app/http-utils.js');
const {
  logApiSuccess,
  logApiError,
} = require('../logger/braintrust.js');

function parsePositiveInt(value, fallback, max = 500) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.trunc(n));
}

async function readPostBody(req) {
  const raw = await readBody(req);
  const body = parseJsonBody(raw);
  bindRunIdFromBody(body);
  return body;
}

async function handleTodoistRoutes(ctx) {
  const {
    req,
    res,
    url,
    method,
    logger,
  } = ctx;

  if (method === 'POST' && url.pathname === '/todoist/sync') {
    const start = Date.now();
    const meta = { op: 'api_todoist_sync', method, path: url.pathname };

    try {
      const body = await readPostBody(req);
      const out = await logger.step(
        'api.todoist.sync',
        async () => todoistRepository.syncTodoistSurface(body),
        {
          input: {
            task_count: Array.isArray(body.tasks) ? body.tasks.length : 0,
            run_id: asText(body.run_id) || null,
          },
          output: (result) => ({
            synced_count: Number(result && result.synced_count ? result.synced_count : 0),
            parse_trigger_count: Number(result && result.parse_trigger_count ? result.parse_trigger_count : 0),
            closed_count: Number(result && result.closed_count ? result.closed_count : 0),
          }),
          meta: { route: url.pathname },
        }
      );

      logApiSuccess(meta, {
        synced_count: out.synced_count,
        parse_trigger_count: out.parse_trigger_count,
        closed_count: out.closed_count,
      }, {
        duration_ms: Date.now() - start,
      });
      json(res, 200, out);
    } catch (err) {
      logApiError(meta, err, { duration_ms: Date.now() - start });
      sendError(res, err, { includeField: false });
    }

    return true;
  }

  if (method === 'GET' && url.pathname === '/todoist/review') {
    const start = Date.now();
    const meta = { op: 'api_todoist_review_get', method, path: url.pathname };

    try {
      const body = {
        view: asText(url.searchParams.get('view')) || 'needs_review',
        limit: parsePositiveInt(url.searchParams.get('limit'), 50, 200),
        offset: parsePositiveInt(url.searchParams.get('offset'), 0, 100000),
        todoist_task_id: asText(url.searchParams.get('todoist_task_id')) || null,
        events_limit: parsePositiveInt(url.searchParams.get('events_limit'), 100, 500),
      };

      const out = await logger.step(
        'api.todoist.review.get',
        async () => todoistRepository.getReviewQueue(body),
        {
          input: body,
          output: (result) => ({
            rows: Array.isArray(result && result.rows) ? result.rows.length : 0,
            selected: !!(result && result.selected),
            events: Array.isArray(result && result.events) ? result.events.length : 0,
          }),
          meta: { route: url.pathname },
        }
      );

      logApiSuccess(meta, {
        rows: Array.isArray(out.rows) ? out.rows.length : 0,
        selected: !!out.selected,
      }, {
        duration_ms: Date.now() - start,
      });
      json(res, 200, out);
    } catch (err) {
      logApiError(meta, err, { duration_ms: Date.now() - start });
      sendError(res, err, { includeField: false });
    }

    return true;
  }

  if (method === 'POST' && url.pathname === '/todoist/review/accept') {
    const start = Date.now();
    const meta = { op: 'api_todoist_review_accept', method, path: url.pathname };

    try {
      const body = await readPostBody(req);
      const out = await logger.step(
        'api.todoist.review.accept',
        async () => todoistRepository.acceptReview(body),
        {
          input: { todoist_task_id: asText(body.todoist_task_id) || null },
          output: (result) => ({
            found: !!result,
            review_status: result && result.review_status ? result.review_status : null,
          }),
          meta: { route: url.pathname },
        }
      );

      logApiSuccess(meta, {
        found: !!out,
        review_status: out && out.review_status ? out.review_status : null,
      }, {
        duration_ms: Date.now() - start,
      });

      if (!out) {
        json(res, 404, { error: 'not_found', message: 'todoist task not found' });
      } else {
        json(res, 200, out);
      }
    } catch (err) {
      logApiError(meta, err, { duration_ms: Date.now() - start });
      sendError(res, err, { includeField: false });
    }

    return true;
  }

  if (method === 'POST' && url.pathname === '/todoist/review/override') {
    const start = Date.now();
    const meta = { op: 'api_todoist_review_override', method, path: url.pathname };

    try {
      const body = await readPostBody(req);
      const out = await logger.step(
        'api.todoist.review.override',
        async () => todoistRepository.overrideReview(body),
        {
          input: {
            todoist_task_id: asText(body.todoist_task_id) || null,
            has_next_action: !!asText(body.suggested_next_action),
          },
          output: (result) => ({
            found: !!result,
            review_status: result && result.review_status ? result.review_status : null,
          }),
          meta: { route: url.pathname },
        }
      );

      logApiSuccess(meta, {
        found: !!out,
        review_status: out && out.review_status ? out.review_status : null,
      }, {
        duration_ms: Date.now() - start,
      });

      if (!out) {
        json(res, 404, { error: 'not_found', message: 'todoist task not found' });
      } else {
        json(res, 200, out);
      }
    } catch (err) {
      logApiError(meta, err, { duration_ms: Date.now() - start });
      sendError(res, err, { includeField: false });
    }

    return true;
  }

  if (method === 'POST' && url.pathname === '/todoist/review/reparse') {
    const start = Date.now();
    const meta = { op: 'api_todoist_review_reparse', method, path: url.pathname };

    try {
      const body = await readPostBody(req);
      const out = await logger.step(
        'api.todoist.review.reparse',
        async () => todoistRepository.reparseReview(body),
        {
          input: { todoist_task_id: asText(body.todoist_task_id) || null },
          output: (result) => ({
            found: !!result,
            review_status: result && result.review_status ? result.review_status : null,
            events: Array.isArray(result && result.events) ? result.events.length : 0,
          }),
          meta: { route: url.pathname },
        }
      );

      logApiSuccess(meta, {
        found: !!out,
        review_status: out && out.review_status ? out.review_status : null,
      }, {
        duration_ms: Date.now() - start,
      });

      if (!out) {
        json(res, 404, { error: 'not_found', message: 'todoist task not found' });
      } else {
        json(res, 200, out);
      }
    } catch (err) {
      logApiError(meta, err, { duration_ms: Date.now() - start });
      sendError(res, err, { includeField: false });
    }

    return true;
  }

  if (method === 'POST' && url.pathname === '/todoist/brief/daily') {
    const start = Date.now();
    const meta = { op: 'api_todoist_brief_daily', method, path: url.pathname };

    try {
      const body = await readPostBody(req);
      const out = await logger.step(
        'api.todoist.brief.daily',
        async () => todoistRepository.buildDailyBriefSurface(body),
        {
          input: {
            run_id: asText(body.run_id) || null,
            has_chat_id: !!asText(body.telegram_chat_id),
          },
          output: (result) => ({
            top_3: Array.isArray(result && result.top_3) ? result.top_3.length : 0,
            waiting_nudges: Array.isArray(result && result.waiting_nudges) ? result.waiting_nudges.length : 0,
          }),
          meta: { route: url.pathname },
        }
      );

      logApiSuccess(meta, {
        top_3: Array.isArray(out.top_3) ? out.top_3.length : 0,
        waiting_nudges: Array.isArray(out.waiting_nudges) ? out.waiting_nudges.length : 0,
      }, {
        duration_ms: Date.now() - start,
      });
      json(res, 200, out);
    } catch (err) {
      logApiError(meta, err, { duration_ms: Date.now() - start });
      sendError(res, err, { includeField: false });
    }

    return true;
  }

  if (method === 'POST' && url.pathname === '/todoist/brief/waiting') {
    const start = Date.now();
    const meta = { op: 'api_todoist_brief_waiting', method, path: url.pathname };

    try {
      const body = await readPostBody(req);
      const out = await logger.step(
        'api.todoist.brief.waiting',
        async () => todoistRepository.buildWaitingBriefSurface(body),
        {
          input: {
            run_id: asText(body.run_id) || null,
            has_chat_id: !!asText(body.telegram_chat_id),
          },
          output: (result) => ({
            nudges: Array.isArray(result && result.nudges) ? result.nudges.length : 0,
          }),
          meta: { route: url.pathname },
        }
      );

      logApiSuccess(meta, {
        nudges: Array.isArray(out.nudges) ? out.nudges.length : 0,
      }, {
        duration_ms: Date.now() - start,
      });
      json(res, 200, out);
    } catch (err) {
      logApiError(meta, err, { duration_ms: Date.now() - start });
      sendError(res, err, { includeField: false });
    }

    return true;
  }

  if (method === 'POST' && url.pathname === '/todoist/brief/weekly') {
    const start = Date.now();
    const meta = { op: 'api_todoist_brief_weekly', method, path: url.pathname };

    try {
      const body = await readPostBody(req);
      const out = await logger.step(
        'api.todoist.brief.weekly',
        async () => todoistRepository.buildWeeklyBriefSurface(body),
        {
          input: {
            run_id: asText(body.run_id) || null,
            has_chat_id: !!asText(body.telegram_chat_id),
          },
          output: (result) => ({
            suggestions: Array.isArray(result && result.suggestions) ? result.suggestions.length : 0,
          }),
          meta: { route: url.pathname },
        }
      );

      logApiSuccess(meta, {
        suggestions: Array.isArray(out.suggestions) ? out.suggestions.length : 0,
      }, {
        duration_ms: Date.now() - start,
      });
      json(res, 200, out);
    } catch (err) {
      logApiError(meta, err, { duration_ms: Date.now() - start });
      sendError(res, err, { includeField: false });
    }

    return true;
  }

  if (method === 'POST' && url.pathname === '/todoist/eval/normalize') {
    const start = Date.now();
    const meta = { op: 'api_todoist_eval_normalize', method, path: url.pathname };

    try {
      requireAdminSecret(req);
      const body = await readPostBody(req);
      const out = await logger.step(
        'api.todoist.eval.normalize',
        async () => todoistRepository.evaluateTodoistNormalization(body),
        {
          input: {
            has_title: !!asText(body.raw_title),
            project_key: asText(body.project_key) || null,
            has_examples: Array.isArray(body.few_shot_examples) && body.few_shot_examples.length > 0,
          },
          output: (result) => ({
            status: asText(result && result.status) || null,
            task_shape: asText(result && result.normalized_task && result.normalized_task.task_shape) || null,
            parse_confidence: Number(result && result.normalized_task && result.normalized_task.parse_confidence),
          }),
          meta: { route: url.pathname },
        }
      );

      logApiSuccess(meta, {
        status: asText(out && out.status) || null,
        task_shape: asText(out && out.normalized_task && out.normalized_task.task_shape) || null,
      }, {
        duration_ms: Date.now() - start,
      });
      json(res, 200, out);
    } catch (err) {
      logApiError(meta, err, { duration_ms: Date.now() - start });
      sendError(res, err, { includeField: false });
    }

    return true;
  }

  return false;
}

module.exports = {
  handleTodoistRoutes,
};
