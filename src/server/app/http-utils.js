'use strict';

const {
  setRunIdFromBody,
  getRunContext,
} = require('../logger/context.js');
const { getAdminSecret } = require('../runtime-env.js');

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
  const expected = getAdminSecret();
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

function failurePackResponseRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    failure_id: row.failure_id || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    run_id: row.run_id || null,
    execution_id: row.execution_id || null,
    workflow_id: row.workflow_id || null,
    workflow_name: row.workflow_name || null,
    mode: row.mode || null,
    failed_at: row.failed_at || null,
    node_name: row.node_name || null,
    node_type: row.node_type || null,
    error_name: row.error_name || null,
    error_message: row.error_message || null,
    status: row.status || null,
    has_sidecars: !!row.has_sidecars,
    sidecar_root: row.sidecar_root || null,
    pack: row.pack || null,
  };
}

function failurePackSummaryRow(row) {
  const base = failurePackResponseRow(row) || {};
  delete base.pack;
  return base;
}

function getStatusCode(err, fallback = 400) {
  const statusCode = Number(err && err.statusCode);
  return Number.isFinite(statusCode) && statusCode >= 400 && statusCode < 600
    ? statusCode
    : fallback;
}

function defaultErrorCode(status) {
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'internal_error';
  return 'bad_request';
}

function sendError(res, err, opts = {}) {
  const status = getStatusCode(err, opts.defaultStatus || 400);
  const error = opts.errorCode || defaultErrorCode(status);
  const payload = { error, message: err.message };
  if (opts.includeErrorCodeField !== false && err && err.code) payload.error_code = err.code;
  if (opts.includeField !== false && err && err.field) payload.field = err.field;
  return json(res, status, payload);
}

module.exports = {
  json,
  notFound,
  readAdminSecret,
  requireAdminSecret,
  readBody,
  parseJsonBody,
  bindRunIdFromBody,
  asText,
  lower,
  isStructuredTelegramRouteInput,
  failurePackResponseRow,
  failurePackSummaryRow,
  getStatusCode,
  defaultErrorCode,
  sendError,
};
