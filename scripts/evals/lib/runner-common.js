'use strict';

const { toInt } = require('./io.js');
const { getDebugRun } = require('./live-api.js');

function requireAdminSecret(args) {
  const secret = String(args['admin-secret'] || process.env.PKM_ADMIN_SECRET || '').trim();
  if (!secret) {
    throw new Error('Missing admin secret. Set --admin-secret or PKM_ADMIN_SECRET.');
  }
  return secret;
}

function parsePositiveCaseLimit(args) {
  const n = toInt(args['case-limit'], null);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function resolveRunnerOptions(args, options = {}) {
  const includeTelegramUserId = options.includeTelegramUserId === true;
  const backendUrl = String(args['backend-url'] || process.env.EVAL_BACKEND_URL || 'http://localhost:8080').trim();
  const adminSecret = requireAdminSecret(args);
  const timeoutMs = Number(args.timeout || process.env.EVAL_TIMEOUT_MS || 15000);
  const checkObservability = args['no-observability-check'] ? false : true;

  const out = {
    backendUrl,
    adminSecret,
    timeoutMs,
    checkObservability,
  };

  if (includeTelegramUserId) {
    out.telegramUserId = String(args['telegram-user-id'] || process.env.EVAL_TELEGRAM_USER_ID || '1509032341').trim();
  }

  return out;
}

async function checkRunObservability({ backendUrl, adminSecret, runId, timeoutMs, limit = 50 }) {
  try {
    const out = await getDebugRun({
      backendUrl,
      adminSecret,
      runId,
      limit,
      timeoutMs,
    });
    return Array.isArray(out.rows) && out.rows.length > 0;
  } catch (_err) {
    return false;
  }
}

function printEvalCompletion({ message, paths, metricLine }) {
  process.stdout.write(`${message}\n`);
  process.stdout.write(`JSON: ${paths.jsonPath}\n`);
  process.stdout.write(`Markdown: ${paths.mdPath}\n`);
  if (metricLine) {
    process.stdout.write(`${metricLine}\n`);
  }
}

module.exports = {
  requireAdminSecret,
  parsePositiveCaseLimit,
  resolveRunnerOptions,
  checkRunObservability,
  printEvalCompletion,
};
