'use strict';

const { requestJson, assertOkJson } = require('./http.js');

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function buildHeaders(secret, runId) {
  return {
    'x-pkm-admin-secret': secret,
    'x-pkm-run-id': runId,
  };
}

async function postTelegramRoute({ backendUrl, adminSecret, runId, body, timeoutMs }) {
  const response = await requestJson({
    method: 'POST',
    url: `${trimTrailingSlash(backendUrl)}/telegram/route`,
    headers: buildHeaders(adminSecret, runId),
    body: { ...body, run_id: runId },
    timeoutMs,
  });
  return assertOkJson(response, 'POST /telegram/route');
}

async function postCalendarNormalize({ backendUrl, adminSecret, runId, body, timeoutMs }) {
  const response = await requestJson({
    method: 'POST',
    url: `${trimTrailingSlash(backendUrl)}/calendar/normalize`,
    headers: buildHeaders(adminSecret, runId),
    body: { ...body, run_id: runId },
    timeoutMs,
  });
  return assertOkJson(response, 'POST /calendar/normalize');
}

async function getDebugRun({ backendUrl, adminSecret, runId, limit, timeoutMs }) {
  const url = `${trimTrailingSlash(backendUrl)}/debug/run/${encodeURIComponent(runId)}?limit=${Number(limit || 200)}`;
  const response = await requestJson({
    method: 'GET',
    url,
    headers: {
      'x-pkm-admin-secret': adminSecret,
      'x-pkm-run-id': runId,
    },
    timeoutMs,
  });
  return assertOkJson(response, `GET /debug/run/${runId}`);
}

async function getFailureBundle({ backendUrl, adminSecret, runId, traceLimit, timeoutMs }) {
  const url = `${trimTrailingSlash(backendUrl)}/debug/failure-bundle/${encodeURIComponent(runId)}?trace_limit=${Number(traceLimit || 200)}`;
  const response = await requestJson({
    method: 'GET',
    url,
    headers: {
      'x-pkm-admin-secret': adminSecret,
      'x-pkm-run-id': runId,
    },
    timeoutMs,
  });
  return assertOkJson(response, `GET /debug/failure-bundle/${runId}`);
}

module.exports = {
  postTelegramRoute,
  postCalendarNormalize,
  getDebugRun,
  getFailureBundle,
};
