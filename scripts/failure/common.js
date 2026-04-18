#!/usr/bin/env node
'use strict';

const { readFile } = require('node:fs/promises');

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function parseArgs(argv) {
  const out = { _: [] };
  const args = Array.isArray(argv) ? argv.slice(2) : [];
  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || '');
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = i + 1 < args.length ? String(args[i + 1]) : '';
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

async function readTextFile(filePath) {
  const path = asText(filePath);
  if (!path) throw new Error('missing file path');
  return readFile(path, 'utf8');
}

function getRuntimeConfig() {
  return {
    backendBase: asText(process.env.PKM_FAILURE_BACKEND_URL || process.env.PKM_BACKEND_URL || 'http://192.168.5.4:3010'),
    adminSecret: asText(process.env.PKM_ADMIN_SECRET),
    webhookBase: asText(process.env.PKM_FAILURE_WEBHOOK_BASE || 'https://n8n-hook.gasovic.com/webhook/pkm/failures'),
    webhookToken: asText(process.env.PKM_FAILURE_WEBHOOK_TOKEN),
    timeoutMs: Number.isFinite(Number(process.env.PKM_FAILURE_TIMEOUT_MS))
      ? Math.max(3000, Math.trunc(Number(process.env.PKM_FAILURE_TIMEOUT_MS)))
      : 15000,
  };
}

function joinUrl(base, suffix) {
  const root = String(base || '').replace(/\/+$/g, '');
  const tail = String(suffix || '').replace(/^\/+/, '');
  return `${root}/${tail}`;
}

function toWebhookPath(debugPath) {
  const raw = asText(debugPath);
  if (!raw.startsWith('/debug/failures')) {
    throw new Error(`unsupported failure path: ${raw}`);
  }
  return raw.replace(/^\/debug\/failures/, '') || '/';
}

async function requestJson(url, { method = 'GET', headers = {}, body = null, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });

    const text = await res.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (_err) {
        throw new Error(`invalid_json_response from ${url}`);
      }
    }

    if (!res.ok) {
      const message = (payload && typeof payload === 'object' && (payload.message || payload.error))
        ? `${payload.message || payload.error}`
        : `http_${res.status}`;
      const err = new Error(message);
      err.statusCode = res.status;
      err.payload = payload;
      throw err;
    }

    return payload;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      const timeoutError = new Error(`request_timeout_${timeoutMs}ms`);
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function callFailureApi(debugPath, opts = {}) {
  const method = asText(opts.method || 'GET').toUpperCase() || 'GET';
  const body = Object.prototype.hasOwnProperty.call(opts, 'body') ? opts.body : null;
  const cfg = getRuntimeConfig();
  const attempts = [];

  if (cfg.backendBase && cfg.adminSecret) {
    const url = joinUrl(cfg.backendBase, debugPath);
    try {
      const payload = await requestJson(url, {
        method,
        body,
        timeoutMs: cfg.timeoutMs,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-pkm-admin-secret': cfg.adminSecret,
        },
      });
      return { payload, transport: 'backend', url };
    } catch (err) {
      attempts.push({
        transport: 'backend',
        url,
        error: asText(err && err.message),
        status: Number(err && err.statusCode) || null,
      });
    }
  }

  if (cfg.webhookBase) {
    const url = joinUrl(cfg.webhookBase, toWebhookPath(debugPath));
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (cfg.webhookToken) headers['x-pkm-failure-token'] = cfg.webhookToken;

    try {
      const payload = await requestJson(url, {
        method,
        body,
        timeoutMs: cfg.timeoutMs,
        headers,
      });
      return { payload, transport: 'webhook', url };
    } catch (err) {
      attempts.push({
        transport: 'webhook',
        url,
        error: asText(err && err.message),
        status: Number(err && err.statusCode) || null,
      });
    }
  }

  const summary = attempts.map((entry) => `${entry.transport}:${entry.status || '-'}:${entry.error || 'unknown_error'}`).join(' | ');
  throw new Error(summary || 'no_transport_available (set PKM_ADMIN_SECRET or PKM_FAILURE_WEBHOOK_BASE)');
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

module.exports = {
  asText,
  parseArgs,
  readTextFile,
  getRuntimeConfig,
  callFailureApi,
  printJson,
};
