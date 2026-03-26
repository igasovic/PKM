'use strict';

const http = require('http');
const { URL } = require('url');
const pkg = require('./package.json');
const db = require('./db.js');
const { TestModeService } = require('./test-mode.js');
const { getConfig } = require('../libs/config.js');
const { decideEmailIntent } = require('./normalization.js');
const {
  runTelegramIngestionPipeline,
  runEmailIngestionPipeline,
  runWebpageIngestionPipeline,
  runNotionIngestionPipeline,
} = require('./ingestion-pipeline.js');
const {
  enrichTier1,
  enqueueTier1Batch,
  startTier1BatchWorker,
  stopTier1BatchWorker,
} = require('./tier1-enrichment.js');
const {
  distillTier2SingleEntrySync,
} = require('./tier2/service.js');
const {
  runTier2ControlPlanePlan,
} = require('./tier2/planner.js');
const {
  runTier2BatchWorkerCycle,
  startTier2BatchWorker,
  stopTier2BatchWorker,
} = require('./tier2-enrichment.js');
const {
  routeTelegramInput,
  normalizeCalendarRequest,
  normalizeCalendarRequestWithTrace,
} = require('./calendar-service.js');
const {
  resolveTelegramAccess,
  applyRouteAccessPolicy,
  calendarAccessMessage,
} = require('./calendar-access.js');
const {
  createBatchStatusService,
} = require('./batch-status-service.js');
const { importEmailMbox } = require('./email-importer.js');
const { processMcpRequest } = require('./mcp/protocol.js');
const {
  getBraintrustLogger,
  logError,
  logApiSuccess,
  logApiError,
} = require('./logger/braintrust.js');
const { getLogger } = require('./logger/index.js');
const {
  withRequestContext,
  setRunIdFromBody,
  getRunContext,
  setContextPatch,
} = require('./logger/context.js');

const testModeService = new TestModeService();
const batchStatusService = createBatchStatusService();

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  const ctx = getRunContext();
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  };
  if (ctx && ctx.run_id) {
    headers['X-PKM-Run-Id'] = ctx.run_id;
  }
  res.writeHead(status, {
    ...headers,
  });
  res.end(body);
}

function notFound(res) {
  json(res, 404, { error: 'not_found' });
}

function openSse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
}

function writeSseEvent(res, eventName, payload) {
  const body = JSON.stringify(payload === undefined ? {} : payload);
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${body}\n\n`);
}

function readAdminSecret(req) {
  const fromHeader = req.headers['x-pkm-admin-secret'] || req.headers['x-admin-secret'];
  if (typeof fromHeader === 'string' && fromHeader.trim()) {
    return fromHeader.trim();
  }
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m && m[1] && m[1].trim()) return m[1].trim();
  }
  return '';
}

function requireAdminSecret(req) {
  const expected = String(process.env.PKM_ADMIN_SECRET || '').trim();
  if (!expected) {
    const err = new Error('admin secret is not configured');
    err.statusCode = 500;
    throw err;
  }
  const provided = readAdminSecret(req);
  if (!provided || provided !== expected) {
    const err = new Error('forbidden');
    err.statusCode = 403;
    throw err;
  }
}

async function readBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseJsonBody(raw) {
  return raw ? JSON.parse(raw) : {};
}

function bindRunIdFromBody(body) {
  if (!body || typeof body !== 'object') return;
  setRunIdFromBody(body.run_id);
}

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function lower(value) {
  return asText(value).toLowerCase();
}

function isStructuredTelegramRouteInput(rawText, prefixes) {
  const s = lower(rawText);
  if (!s) return false;
  if (s.startsWith('/')) return true;

  const p = prefixes && typeof prefixes === 'object' ? prefixes : {};
  const calendarPrefix = lower(p.calendar || 'cal:') || 'cal:';
  const pkmPrefix = lower(p.pkm || 'pkm:') || 'pkm:';
  return s.startsWith(calendarPrefix) || s.startsWith(pkmPrefix);
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const method = (req.method || 'GET').toUpperCase();
  setContextPatch({ route: url.pathname, method, pipeline: 'http_api' });
  const logger = getLogger().child({
    service: 'pkm-server',
    pipeline: 'http_api',
    meta: { route: url.pathname, method },
  });

  if (method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { status: 'ok' });
  }

  if (method === 'GET' && url.pathname === '/ready') {
    return json(res, 200, { status: 'ready' });
  }

  if (method === 'GET' && url.pathname === '/version') {
    return json(res, 200, { name: pkg.name, version: pkg.version });
  }

  if (method === 'GET' && url.pathname === '/config') {
    const config = getConfig();
    return json(res, 200, config);
  }

  if (method === 'POST' && url.pathname === '/mcp') {
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      const accept = String(req.headers.accept || '').toLowerCase();
      const transport = String((body && body.transport) || '').toLowerCase();
      const wantsSse = accept.includes('text/event-stream') || transport === 'sse';
      const methodName = body && typeof body.method === 'string'
        ? body.method
        : (body && typeof body.action === 'string' ? body.action : (body && body.tool ? 'tools/call' : null));
      const callName = body && typeof body.tool === 'string'
        ? body.tool
        : (body && body.params && typeof body.params === 'object' ? body.params.name : null);
      const args = body && body.params && typeof body.params === 'object'
        ? (body.params.arguments || {})
        : (body && body.input && typeof body.input === 'object' ? body.input : {});
      const runIdHint = (body && body.run_id) || (args && args.run_id) || null;
      if (runIdHint) {
        setRunIdFromBody(runIdHint);
      } else if (body && Object.prototype.hasOwnProperty.call(body, 'id')) {
        setRunIdFromBody(`mcp-${String(body.id).slice(0, 48)}`);
      }

      const result = await logger.step(
        'api.mcp',
        async () => processMcpRequest(body, {
          request_id: body && Object.prototype.hasOwnProperty.call(body, 'id')
            ? String(body.id)
            : null,
          run_id: runIdHint || null,
          logger: logger.child({ pipeline: 'mcp' }),
        }),
        {
          input: {
            method: methodName,
            tool: callName,
            has_args: !!(args && typeof args === 'object' && Object.keys(args).length),
          },
          output: (out) => ({
            has_error: !!(out && out.error),
            type: out && out.result && out.result.type ? out.result.type : (out && out.type ? out.type : null),
          }),
          meta: { route: url.pathname },
        }
      );
      if (wantsSse) {
        openSse(res);
        writeSseEvent(res, 'meta', {
          route: '/mcp',
          method: methodName,
        });
        writeSseEvent(res, 'result', result);
        writeSseEvent(res, 'done', { ok: true });
        return res.end();
      }
      return json(res, 200, result);
    } catch (err) {
      logError(err, req);
      const accept = String(req.headers.accept || '').toLowerCase();
      const wantsSse = accept.includes('text/event-stream');
      const statusCode = Number(err && err.statusCode);
      const status = Number.isFinite(statusCode) && statusCode >= 400 && statusCode < 600 ? statusCode : 400;
      const errorCode = status === 403
        ? 'forbidden'
        : status === 404
          ? 'not_found'
          : status >= 500
            ? 'internal_error'
            : 'bad_request';
      const payload = { error: errorCode, message: err.message };
      if (err && err.code) payload.error_code = err.code;
      if (err && err.field) payload.field = err.field;
      if (wantsSse) {
        openSse(res);
        writeSseEvent(res, 'error', payload);
        writeSseEvent(res, 'done', { ok: false });
        return res.end();
      }
      return json(res, status, payload);
    }
  }

  if (method === 'POST' && url.pathname === '/normalize/telegram') {
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const normalized = await logger.step(
        'api.normalize.telegram',
        async () => runTelegramIngestionPipeline({
          text: body.text,
          source: body.source,
        }),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      return json(res, 200, normalized);
    } catch (err) {
      logError(err, req);
      return json(res, 400, { error: 'bad_request', message: err.message });
    }
  }

  if (method === 'POST' && url.pathname === '/normalize/email/intent') {
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const intent = await logger.step(
        'api.normalize.email.intent',
        async () => decideEmailIntent(body.textPlain),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      return json(res, 200, { content_type: intent.content_type });
    } catch (err) {
      logError(err, req);
      return json(res, 400, { error: 'bad_request', message: err.message });
    }
  }

  if (method === 'POST' && url.pathname === '/normalize/email') {
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const normalized = await logger.step(
        'api.normalize.email',
        async () => runEmailIngestionPipeline({
          raw_text: body.raw_text,
          from: body.from,
          subject: body.subject,
          date: body.date,
          message_id: body.message_id,
          source: body.source,
        }),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      return json(res, 200, normalized);
    } catch (err) {
      logError(err, req);
      return json(res, 400, { error: 'bad_request', message: err.message });
    }
  }

  if (method === 'POST' && url.pathname === '/normalize/webpage') {
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const normalized = await logger.step(
        'api.normalize.webpage',
        async () => runWebpageIngestionPipeline({
          text: body.text,
          extracted_text: body.extracted_text,
          clean_text: body.clean_text,
          capture_text: body.capture_text,
          content_type: body.content_type,
          url: body.url,
          url_canonical: body.url_canonical,
          excerpt: body.excerpt,
        }),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      return json(res, 200, normalized);
    } catch (err) {
      logError(err, req);
      return json(res, 400, { error: 'bad_request', message: err.message });
    }
  }

  if (method === 'POST' && url.pathname === '/normalize/notion') {
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const normalized = await logger.step(
        'api.normalize.notion',
        async () => runNotionIngestionPipeline({
          id: body.id || body.page_id || null,
          updated_at: body.updated_at,
          created_at: body.created_at,
          content_type: body.content_type,
          title: body.title,
          url: body.url,
          capture_text: body.capture_text,
        }),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      return json(res, 200, normalized);
    } catch (err) {
      logError(err, req);
      return json(res, 400, { error: 'bad_request', message: err.message });
    }
  }

  if (method === 'POST' && url.pathname === '/enrich/t1') {
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const result = await logger.step(
        'api.enrich.t1',
        async () => enrichTier1({
          title: body.title ?? null,
          author: body.author ?? null,
          clean_text: body.clean_text ?? null,
        }),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      return json(res, 200, result);
    } catch (err) {
      logError(err, req);
      return json(res, 400, { error: 'bad_request', message: err.message });
    }
  }

  if (method === 'POST' && url.pathname === '/telegram/route') {
    try {
      requireAdminSecret(req);
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const source = body && body.source && typeof body.source === 'object' ? body.source : {};
      const actorCode = asText(body.actor_code || body.actor).toLowerCase() || 'unknown';
      const chatId = asText(source.chat_id || body.telegram_chat_id);
      const messageId = asText(source.message_id || body.telegram_message_id);
      const rawText = asText(body.text || body.raw_text || body.message_text);
      const config = getConfig();
      const prefixes = config && config.calendar && config.calendar.prefixes
        ? config.calendar.prefixes
        : { calendar: 'cal:', pkm: 'pkm:' };
      const structuredInput = isStructuredTelegramRouteInput(rawText, prefixes);

      const routeResult = await logger.step(
        'api.telegram.route',
        async () => routeTelegramInput(body),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );

      let continuationRequest = null;
      if (!structuredInput && chatId) {
        continuationRequest = await db.getLatestOpenCalendarRequestByChat(chatId);
      }
      const continuationRoute = continuationRequest
        ? {
          route: 'calendar_create',
          confidence: 0.99,
          clarification_question: null,
        }
        : null;

      const access = resolveTelegramAccess({
        telegram_user_id: source.user_id || body.telegram_user_id,
      });
      const effectiveRoute = applyRouteAccessPolicy(continuationRoute || routeResult, access);

      let requestRow = null;
      if (continuationRequest) {
        requestRow = continuationRequest;
      } else if (chatId && messageId && ['calendar_create', 'calendar_query', 'ambiguous'].includes(effectiveRoute.route)) {
        requestRow = await db.upsertCalendarRequest({
          run_id: body.run_id || (getRunContext() && getRunContext().run_id) || `tg-route-${Date.now()}`,
          actor_code: actorCode,
          telegram_chat_id: chatId,
          telegram_message_id: messageId,
          route_intent: effectiveRoute.route,
          route_confidence: effectiveRoute.confidence,
          status: 'routed',
          raw_text: rawText,
          idempotency_key_primary: `tgcal:${chatId}:${messageId}`,
          idempotency_key_secondary: null,
        });
      }

      return json(res, 200, {
        ...effectiveRoute,
        request_id: requestRow ? requestRow.request_id : null,
      });
    } catch (err) {
      logError(err, req);
      const statusCode = Number(err && err.statusCode);
      const status = Number.isFinite(statusCode) && statusCode >= 400 && statusCode < 600 ? statusCode : 400;
      const errorCode = status === 403 ? 'forbidden' : 'bad_request';
      return json(res, status, { error: errorCode, message: err.message });
    }
  }

  if (method === 'POST' && url.pathname === '/calendar/normalize') {
    try {
      requireAdminSecret(req);
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);

      const source = body && body.source && typeof body.source === 'object' ? body.source : {};
      const runId = String(body.run_id || (getRunContext() && getRunContext().run_id) || '').trim() || `cal-norm-${Date.now()}`;
      const actorCode = String(body.actor_code || body.actor || '').trim().toLowerCase() || 'unknown';
      const incomingText = String(body.raw_text || body.text || '').trim();
      const chatId = String(source.chat_id || body.telegram_chat_id || '').trim();
      const messageId = String(source.message_id || body.telegram_message_id || '').trim();
      const includeTrace = body && body.include_trace === true;
      const access = resolveTelegramAccess({
        telegram_user_id: source.user_id || body.telegram_user_id,
      });

      if (!access.calendar_allowed) {
        return json(res, 200, {
          request_id: null,
          status: 'rejected',
          missing_fields: [],
          clarification_question: null,
          normalized_event: null,
          warning_codes: [access.reason_code || 'telegram_user_not_calendar_allowed'],
          message: calendarAccessMessage(access),
          request_status: null,
        });
      }

      let request = null;
      if (body.request_id) {
        request = await db.getCalendarRequestById(body.request_id);
        if (!request) {
          const err = new Error('request not found');
          err.statusCode = 404;
          throw err;
        }
      }

      if (!request) {
        if (!chatId || !messageId) {
          throw new Error('telegram source chat_id and message_id are required for new calendar requests');
        }
        if (!incomingText) {
          throw new Error('raw_text is required');
        }
        request = await db.upsertCalendarRequest({
          run_id: runId,
          actor_code: actorCode,
          telegram_chat_id: chatId,
          telegram_message_id: messageId,
          route_intent: 'calendar_create',
          route_confidence: Number.isFinite(Number(body.route_confidence)) ? Number(body.route_confidence) : null,
          status: 'received',
          raw_text: incomingText,
          clarification_turns: [],
          idempotency_key_primary: `tgcal:${chatId}:${messageId}`,
          idempotency_key_secondary: null,
        });
      }

      const baseText = request.raw_text || incomingText;
      let clarificationTurns = Array.isArray(request.clarification_turns) ? request.clarification_turns : [];
      if (request.status === 'needs_clarification' && incomingText) {
        clarificationTurns = clarificationTurns.concat([{
          question_text: String(body.question_text || '').trim() || null,
          answer_text: incomingText,
          timestamp: new Date().toISOString(),
          actor: actorCode,
          missing_fields_before: Array.isArray(body.missing_fields_before) ? body.missing_fields_before : null,
          missing_fields_after: null,
        }]);
      }

      const normalizeRun = await logger.step(
        'api.calendar.normalize',
        async () => {
          const payload = {
            raw_text: baseText,
            clarification_turns: clarificationTurns,
            timezone: body.timezone,
          };
          if (!includeTrace) {
            const result = await normalizeCalendarRequest(payload);
            return { result, trace: null };
          }
          return normalizeCalendarRequestWithTrace(payload);
        },
        {
          input: {
            request_id: request.request_id,
            has_turns: clarificationTurns.length > 0,
            actor_code: actorCode,
          },
          output: (out) => ({
            status: out && out.result ? out.result.status : null,
            missing_fields: out && out.result ? out.result.missing_fields : null,
            has_event: !!(out && out.result && out.result.normalized_event),
          }),
          meta: { route: url.pathname },
        }
      );
      const normalized = normalizeRun && normalizeRun.result ? normalizeRun.result : null;
      const normalizeTrace = normalizeRun && normalizeRun.trace ? normalizeRun.trace : null;
      if (!normalized) throw new Error('normalize returned empty result');

      let requestUpdate = null;
      if (normalized.status === 'needs_clarification') {
        requestUpdate = await db.updateCalendarRequestById(request.request_id, {
          run_id: runId,
          status: 'needs_clarification',
          clarification_turns: clarificationTurns,
          warning_codes: normalized.warning_codes || null,
          normalized_event: null,
        });
      } else if (normalized.status === 'ready_to_create') {
        requestUpdate = await db.updateCalendarRequestById(request.request_id, {
          run_id: runId,
          status: 'normalized',
          clarification_turns: clarificationTurns,
          normalized_event: normalized.normalized_event,
          warning_codes: normalized.warning_codes || null,
          error: null,
        });
      } else {
        requestUpdate = await db.updateCalendarRequestById(request.request_id, {
          run_id: runId,
          status: 'ignored',
          clarification_turns: clarificationTurns,
          warning_codes: normalized.warning_codes || null,
          error: {
            reason_code: normalized.reason_code || 'rejected',
            message: normalized.message || null,
          },
        });
      }

      return json(res, 200, {
        request_id: request.request_id,
        status: normalized.status,
        missing_fields: normalized.missing_fields || [],
        clarification_question: normalized.clarification_question || null,
        normalized_event: normalized.normalized_event || null,
        warning_codes: normalized.warning_codes || [],
        message: normalized.message || null,
        request_status: requestUpdate ? requestUpdate.status : request.status,
        normalize_trace: includeTrace ? normalizeTrace : undefined,
      });
    } catch (err) {
      logError(err, req);
      const statusCode = Number(err && err.statusCode);
      const status = Number.isFinite(statusCode) && statusCode >= 400 && statusCode < 600 ? statusCode : 400;
      const errorCode = status === 403
        ? 'forbidden'
        : status === 404
          ? 'not_found'
          : 'bad_request';
      return json(res, status, { error: errorCode, message: err.message });
    }
  }

  if (method === 'POST' && url.pathname === '/calendar/finalize') {
    try {
      requireAdminSecret(req);
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);

      const requestId = body.request_id;
      if (!requestId) throw new Error('request_id is required');
      const status = String(
        body.status
        || body.final_status
        || (body.success === true ? 'calendar_created' : (body.success === false ? 'calendar_failed' : ''))
      ).trim();
      if (!status) throw new Error('status is required');

      const updated = await logger.step(
        'api.calendar.finalize',
        async () => db.finalizeCalendarRequestById(requestId, {
          status,
          run_id: body.run_id,
          google_calendar_id: body.google_calendar_id,
          google_event_id: body.google_event_id,
          warning_codes: body.warning_codes,
          error: body.error,
        }),
        {
          input: {
            request_id: requestId,
            status,
            google_event_id: body.google_event_id || null,
          },
          output: (out) => ({
            status: out && out.status,
            request_id: out && out.request_id,
            finalize_action: out && out.finalize_action ? out.finalize_action : 'updated',
          }),
          meta: { route: url.pathname },
        }
      );

      if (!updated) return json(res, 404, { error: 'not_found', message: 'request not found' });
      return json(res, 200, {
        request_id: updated.request_id,
        status: updated.status,
        google_calendar_id: updated.google_calendar_id || null,
        google_event_id: updated.google_event_id || null,
        finalize_action: updated.finalize_action || 'updated',
      });
    } catch (err) {
      logError(err, req);
      const statusCode = Number(err && err.statusCode);
      const status = Number.isFinite(statusCode) && statusCode >= 400 && statusCode < 600 ? statusCode : 400;
      const errorCode = status === 403
        ? 'forbidden'
        : status === 404
          ? 'not_found'
          : 'bad_request';
      return json(res, status, { error: errorCode, message: err.message });
    }
  }

  if (method === 'POST' && url.pathname === '/calendar/observe') {
    try {
      requireAdminSecret(req);
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const runId = String(body.run_id || (getRunContext() && getRunContext().run_id) || '').trim();
      const items = Array.isArray(body.items)
        ? body.items
        : (Array.isArray(body.observations) ? body.observations : [body]);
      const payloadItems = items.map((item) => ({
        ...(item && typeof item === 'object' ? item : {}),
        run_id: (item && item.run_id) ? item.run_id : runId,
      }));
      const result = await logger.step(
        'api.calendar.observe',
        async () => db.insertCalendarObservations({ items: payloadItems }),
        {
          input: { count: payloadItems.length },
          output: (out) => ({ inserted: Number(out && out.rowCount ? out.rowCount : 0) }),
          meta: { route: url.pathname },
        }
      );
      return json(res, 200, {
        inserted: Number(result && result.rowCount ? result.rowCount : 0),
        rows: result && Array.isArray(result.rows) ? result.rows : [],
      });
    } catch (err) {
      logError(err, req);
      const statusCode = Number(err && err.statusCode);
      const status = Number.isFinite(statusCode) && statusCode >= 400 && statusCode < 600 ? statusCode : 400;
      const errorCode = status === 403 ? 'forbidden' : 'bad_request';
      return json(res, status, { error: errorCode, message: err.message });
    }
  }

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
      return json(res, 200, result);
    } catch (err) {
      logError(err, req);
      const statusCode = Number(err && err.statusCode);
      const status = Number.isFinite(statusCode) && statusCode >= 400 && statusCode < 600 ? statusCode : 400;
      const errorCode = status === 403
        ? 'forbidden'
        : status === 404
          ? 'not_found'
          : 'bad_request';
      return json(res, status, { error: errorCode, message: err.message });
    }
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
      return json(res, 200, result);
    } catch (err) {
      logError(err, req);
      const statusCode = Number(err && err.statusCode);
      const status = Number.isFinite(statusCode) && statusCode >= 400 && statusCode < 600 ? statusCode : 400;
      const errorCode = status === 403
        ? 'forbidden'
        : status === 404
          ? 'not_found'
          : 'bad_request';
      return json(res, status, { error: errorCode, message: err.message });
    }
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
      return json(res, 200, result);
    } catch (err) {
      logError(err, req);
      const statusCode = Number(err && err.statusCode);
      const status = Number.isFinite(statusCode) && statusCode >= 400 && statusCode < 600 ? statusCode : 400;
      const errorCode = status === 403
        ? 'forbidden'
        : status === 404
          ? 'not_found'
          : 'bad_request';
      return json(res, status, { error: errorCode, message: err.message });
    }
  }

  if (method === 'POST' && url.pathname === '/enrich/t1/batch') {
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const result = await logger.step(
        'api.enrich.t1.batch',
        async () => enqueueTier1Batch(body.items || [], {
          metadata: body.metadata || undefined,
          completion_window: body.completion_window || '24h',
        }),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      return json(res, 200, result);
    } catch (err) {
      logError(err, req);
      return json(res, 400, { error: 'bad_request', message: err.message });
    }
  }

  const isLegacyT1BatchStatusList = method === 'GET' && url.pathname === '/status/t1/batch';
  const isGenericBatchStatusList = method === 'GET' && url.pathname === '/status/batch';
  if (isLegacyT1BatchStatusList || isGenericBatchStatusList) {
    try {
      const stage = isLegacyT1BatchStatusList ? 't1' : (url.searchParams.get('stage') || 't1');
      const limit = Number(url.searchParams.get('limit') || 50);
      const result = await batchStatusService.getBatchStatusList({
        stage,
        limit,
        schema: url.searchParams.get('schema') || undefined,
        include_terminal: url.searchParams.get('include_terminal'),
      });
      return json(res, 200, result);
    } catch (err) {
      logError(err, req);
      return json(res, 400, { error: 'bad_request', message: err.message });
    }
  }

  const batchStatusMatch = (method === 'GET')
    ? (url.pathname.match(/^\/status\/batch\/([^/]+)$/)
      || url.pathname.match(/^\/status\/t1\/batch\/([^/]+)$/))
    : null;
  if (batchStatusMatch) {
    try {
      const isLegacyRoute = /^\/status\/t1\/batch\//.test(url.pathname);
      const stage = isLegacyRoute ? 't1' : (url.searchParams.get('stage') || 't1');
      const batch_id = decodeURIComponent(batchStatusMatch[1]);
      const result = await batchStatusService.getBatchStatus({
        stage,
        batch_id,
        schema: url.searchParams.get('schema') || undefined,
        include_items: url.searchParams.get('include_items'),
        items_limit: url.searchParams.get('items_limit'),
      });
      if (!result) return notFound(res);
      return json(res, 200, result);
    } catch (err) {
      logError(err, req);
      return json(res, 400, { error: 'bad_request', message: err.message });
    }
  }

  if (method === 'POST' && url.pathname === '/import/email/mbox') {
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const result = await logger.step(
        'api.import.email.mbox',
        async () => importEmailMbox({
          mbox_path: body.mbox_path || body.path,
          batch_size: body.batch_size,
          insert_chunk_size: body.insert_chunk_size,
          completion_window: body.completion_window,
          max_emails: body.max_emails,
          metadata: body.metadata || undefined,
        }),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      return json(res, 200, result);
    } catch (err) {
      logError(err, req);
      return json(res, 400, { error: 'bad_request', message: err.message });
    }
  }

  if (method === 'GET' && url.pathname === '/debug/run/last') {
    try {
      requireAdminSecret(req);
      const limit = Number(url.searchParams.get('limit') || 5000);
      const ctx = getRunContext() || {};
      const exclude_run_id = ctx.run_id || null;
      const result = await logger.step(
        'api.debug.run.last',
        async () => db.getLastPipelineRun({ limit, exclude_run_id }),
        {
          input: { limit, exclude_run_id },
          output: (out) => ({ run_id: out.run_id, rows: out.rows }),
          meta: { route: url.pathname },
        }
      );
      return json(res, 200, result);
    } catch (err) {
      logError(err, req);
      return json(res, 400, { error: 'bad_request', message: err.message });
    }
  }

  if (method === 'GET' && url.pathname === '/debug/runs') {
    try {
      requireAdminSecret(req);
      const limit = Number(url.searchParams.get('limit') || 50);
      const before_ts = url.searchParams.get('before_ts') || url.searchParams.get('before') || null;
      const has_error = url.searchParams.get('has_error');
      const result = await logger.step(
        'api.debug.runs',
        async () => db.getRecentPipelineRuns({ limit, before_ts, has_error }),
        {
          input: { limit, before_ts, has_error },
          output: (out) => ({ count: Array.isArray(out.rows) ? out.rows.length : 0 }),
          meta: { route: url.pathname },
        }
      );
      return json(res, 200, result);
    } catch (err) {
      logError(err, req);
      return json(res, 400, { error: 'bad_request', message: err.message });
    }
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
        async () => db.getPipelineRun(run_id, { limit }),
        { input: { run_id, limit }, output: (out) => ({ run_id: out.run_id, rows: out.rows }), meta: { route: url.pathname } }
      );
      return json(res, 200, result);
    } catch (err) {
      logError(err, req);
      return json(res, 400, { error: 'bad_request', message: err.message });
    }
  }

  if (method === 'GET' && url.pathname === '/db/test-mode') {
    const state = await testModeService.getState();
    return json(res, 200, [{ is_test_mode: state }]);
  }

  if (method === 'POST' && url.pathname === '/echo') {
    try {
      const raw = await readBody(req);
      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        const parsed = raw ? JSON.parse(raw) : null;
        bindRunIdFromBody(parsed);
        return json(res, 200, { ok: true, data: parsed });
      }
      return json(res, 200, { ok: true, data: raw });
    } catch (err) {
      logError(err, req);
      return json(res, 400, { error: 'bad_request', message: err.message });
    }
  }

  if (method === 'POST' && url.pathname.startsWith('/db/')) {
    const start = Date.now();
    const meta = {
      op: `api${url.pathname.replace(/\//g, '_')}`,
      method,
      path: url.pathname,
    };
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      meta.input = body;
      let result;

      if (url.pathname === '/db/delete' || url.pathname === '/db/move') {
        requireAdminSecret(req);
      }

      result = await logger.step(
        `api${url.pathname.replace(/\//g, '_')}`,
        async () => {
          if (url.pathname === '/db/insert') return db.insert(body);
          if (url.pathname === '/db/update') return db.update(body);
          if (url.pathname === '/db/delete') return db.delete(body);
          if (url.pathname === '/db/move') return db.move(body);
          if (url.pathname === '/db/read/continue') return db.readContinue(body);
          if (url.pathname === '/db/read/find') return db.readFind(body);
          if (url.pathname === '/db/read/last') return db.readLast(body);
          if (url.pathname === '/db/read/pull') return db.readPull(body);
          if (url.pathname === '/db/read/smoke') return db.readSmoke(body);
          if (url.pathname === '/db/test-mode/toggle') {
            const state = await testModeService.toggle();
            return { rows: [{ is_test_mode: state }], rowCount: 1 };
          }
          return null;
        },
        { input: body, output: (out) => ({ rowCount: out && out.rowCount ? out.rowCount : 0 }) }
      );
      if (result === null) return notFound(res);

      const payload = (result && result.rows) ? result.rows : [];
      logApiSuccess(meta, { rowCount: result.rowCount }, { duration_ms: Date.now() - start });
      return json(res, 200, payload);
    } catch (err) {
      logApiError(meta, err, { duration_ms: Date.now() - start });
      const statusCode = Number(err && err.statusCode);
      const status = Number.isFinite(statusCode) && statusCode >= 400 && statusCode < 600 ? statusCode : 400;
      const errorCode = status === 403
        ? 'forbidden'
        : status >= 500
          ? 'internal_error'
          : 'bad_request';
      return json(res, status, { error: errorCode, message: err.message });
    }
  }

  return notFound(res);
}

function createServer() {
  return http.createServer((req, res) => {
    withRequestContext(req, async () => {
      await handleRequest(req, res);
    }).catch((err) => {
      logError(err, req);
      json(res, 500, { error: 'internal_error', message: err.message });
    });
  });
}

function start() {
  const port = Number(process.env.PORT || 8080);
  const logger = getLogger().child({ service: 'pkm-server', pipeline: 'maintenance' });
  // Hard-fail startup if Braintrust can't initialize.
  getBraintrustLogger();
  startTier1BatchWorker();
  startTier2BatchWorker();
  const retentionDaysRaw = Number(process.env.PKM_PIPELINE_EVENTS_RETENTION_DAYS || 30);
  const retentionDays = Number.isFinite(retentionDaysRaw) && retentionDaysRaw > 0
    ? Math.trunc(retentionDaysRaw)
    : 30;
  const pruneOnce = async () => {
    try {
      await logger.step(
        'maintenance.pipeline_events.prune',
        async () => db.prunePipelineEvents(retentionDays),
        {
          input: { retention_days: retentionDays },
          output: (out) => out,
          meta: { schedule: 'daily' },
        }
      );
    } catch (_err) {
      // prune is best-effort only
    }
  };
  pruneOnce();
  const pruneTimer = setInterval(pruneOnce, 24 * 60 * 60 * 1000);
  if (typeof pruneTimer.unref === 'function') pruneTimer.unref();

  const staleEnabled = String(process.env.T2_STALE_MARK_ENABLED || 'true').toLowerCase() !== 'false';
  const staleIntervalRaw = Number(process.env.T2_STALE_MARK_INTERVAL_MS || 24 * 60 * 60 * 1000);
  const staleIntervalMs = Number.isFinite(staleIntervalRaw) && staleIntervalRaw >= 60_000
    ? Math.trunc(staleIntervalRaw)
    : 24 * 60 * 60 * 1000;
  const runStaleMark = async () => {
    if (!staleEnabled) return;
    try {
      await logger.step(
        'maintenance.tier2.stale_mark',
        async () => db.markTier2StaleInProd(),
        { output: (out) => out, meta: { schedule: 'tier2_stale_mark' } }
      );
    } catch (_err) {
      // stale mark is best-effort only
    }
  };
  runStaleMark();
  const staleTimer = setInterval(runStaleMark, staleIntervalMs);
  if (typeof staleTimer.unref === 'function') staleTimer.unref();

  const server = createServer();
  server.listen(port, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`server listening on :${port}`);
  });
  const shutdown = () => {
    stopTier1BatchWorker();
    stopTier2BatchWorker();
    clearInterval(pruneTimer);
    clearInterval(staleTimer);
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  start();
}

module.exports = {
  createServer,
  handleRequest,
};
