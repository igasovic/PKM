'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const { randomUUID } = require('crypto');

const storage = new AsyncLocalStorage();

function normalizeRunId(value) {
  const v = String(value || '').trim();
  return v || null;
}

function readRunIdFromHeaders(headers) {
  if (!headers || typeof headers !== 'object') return null;
  const direct = headers['x-pkm-run-id'] || headers['X-PKM-Run-Id'];
  return normalizeRunId(direct);
}

function getContext() {
  return storage.getStore() || null;
}

function getRunContext() {
  const ctx = getContext();
  if (!ctx) return null;
  return {
    run_id: ctx.run_id || null,
    request_id: ctx.request_id || null,
    route: ctx.route || null,
    method: ctx.method || null,
    pipeline: ctx.pipeline || null,
  };
}

function setContextPatch(patch) {
  const ctx = storage.getStore();
  if (!ctx || !patch || typeof patch !== 'object') return;
  Object.assign(ctx, patch);
}

function setRunIdFromBody(runIdValue) {
  const ctx = storage.getStore();
  if (!ctx) return;
  if (ctx.run_id_source === 'header') return;
  const next = normalizeRunId(runIdValue);
  if (!next) return;
  ctx.run_id = next;
  ctx.run_id_source = 'body';
}

function nextSeq() {
  const ctx = storage.getStore();
  if (!ctx) return 1;
  ctx.seq = Number(ctx.seq || 0) + 1;
  return ctx.seq;
}

async function withRequestContext(req, fn) {
  const headers = (req && req.headers) || {};
  const fromHeader = readRunIdFromHeaders(headers);
  const request_id = randomUUID();
  const store = {
    run_id: fromHeader || randomUUID(),
    run_id_source: fromHeader ? 'header' : 'generated',
    request_id,
    route: req && req.url ? String(req.url) : null,
    method: req && req.method ? String(req.method).toUpperCase() : null,
    pipeline: 'http',
    seq: 0,
    started_at: Date.now(),
  };
  return storage.run(store, fn);
}

module.exports = {
  withRequestContext,
  getContext,
  getRunContext,
  setContextPatch,
  setRunIdFromBody,
  nextSeq,
  readRunIdFromHeaders,
};
