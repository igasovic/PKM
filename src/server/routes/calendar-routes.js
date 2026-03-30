'use strict';

const { getConfig } = require('../../libs/config.js');
const {
  routeTelegramInput,
  normalizeCalendarRequest,
  normalizeCalendarRequestWithTrace,
} = require('../calendar-service.js');
const {
  resolveTelegramAccess,
  applyRouteAccessPolicy,
  calendarAccessMessage,
} = require('../calendar-access.js');
const calendarRepository = require('../repositories/calendar-repository.js');
const {
  requireAdminSecret,
  readBody,
  parseJsonBody,
  bindRunIdFromBody,
  asText,
  isStructuredTelegramRouteInput,
  json,
  getStatusCode,
  sendError,
} = require('../app/http-utils.js');
const { getRunContext } = require('../logger/context.js');
const { logError } = require('../logger/braintrust.js');

async function handleCalendarRoutes(ctx) {
  const {
    req,
    res,
    url,
    method,
    logger,
  } = ctx;

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

      const openRequestForChat = chatId
        ? await calendarRepository.getLatestOpenCalendarRequestByChat(chatId)
        : null;
      const continuationRequest = (!structuredInput && openRequestForChat)
        ? openRequestForChat
        : null;
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
      } else if (openRequestForChat && effectiveRoute.route === 'calendar_create') {
        requestRow = openRequestForChat;
      } else if (chatId && messageId && ['calendar_create', 'calendar_query', 'ambiguous'].includes(effectiveRoute.route)) {
        requestRow = await calendarRepository.upsertCalendarRequest({
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

      json(res, 200, {
        ...effectiveRoute,
        request_id: requestRow ? requestRow.request_id : null,
      });
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/calendar/normalize') {
    let body = null;
    try {
      requireAdminSecret(req);
      const raw = await readBody(req);
      body = parseJsonBody(raw);
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
        json(res, 200, {
          request_id: null,
          status: 'rejected',
          missing_fields: [],
          clarification_question: null,
          normalized_event: null,
          warning_codes: [access.reason_code || 'telegram_user_not_calendar_allowed'],
          message: calendarAccessMessage(access),
          request_status: null,
        });
        return true;
      }

      let request = null;
      if (body.request_id) {
        request = await calendarRepository.getCalendarRequestById(body.request_id);
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
        request = await calendarRepository.upsertCalendarRequest({
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
        requestUpdate = await calendarRepository.updateCalendarRequestById(request.request_id, {
          run_id: runId,
          status: 'needs_clarification',
          clarification_turns: clarificationTurns,
          warning_codes: normalized.warning_codes || null,
          normalized_event: null,
        });
      } else if (normalized.status === 'ready_to_create') {
        requestUpdate = await calendarRepository.updateCalendarRequestById(request.request_id, {
          run_id: runId,
          status: 'normalized',
          clarification_turns: clarificationTurns,
          normalized_event: normalized.normalized_event,
          warning_codes: normalized.warning_codes || null,
          error: null,
        });
      } else {
        requestUpdate = await calendarRepository.updateCalendarRequestById(request.request_id, {
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

      json(res, 200, {
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
      const status = getStatusCode(err, 400);
      if (status === 400 || status === 404) {
        json(res, 200, {
          request_id: body && body.request_id ? String(body.request_id) : null,
          status: 'rejected',
          missing_fields: [],
          clarification_question: null,
          normalized_event: null,
          warning_codes: ['normalize_bad_request'],
          message: err && err.message ? String(err.message) : 'calendar normalize rejected',
          request_status: null,
        });
      } else {
        sendError(res, err, { includeErrorCodeField: false, includeField: false });
      }
    }
    return true;
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
        async () => calendarRepository.finalizeCalendarRequestById(requestId, {
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

      if (!updated) {
        json(res, 404, { error: 'not_found', message: 'request not found' });
      } else {
        json(res, 200, {
          request_id: updated.request_id,
          status: updated.status,
          google_calendar_id: updated.google_calendar_id || null,
          google_event_id: updated.google_event_id || null,
          finalize_action: updated.finalize_action || 'updated',
        });
      }
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
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
        async () => calendarRepository.insertCalendarObservations({ items: payloadItems }),
        {
          input: { count: payloadItems.length },
          output: (out) => ({ inserted: Number(out && out.rowCount ? out.rowCount : 0) }),
          meta: { route: url.pathname },
        }
      );
      json(res, 200, {
        inserted: Number(result && result.rowCount ? result.rowCount : 0),
        rows: result && Array.isArray(result.rows) ? result.rows : [],
      });
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleCalendarRoutes,
};
