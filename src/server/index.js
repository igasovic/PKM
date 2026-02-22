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
} = require('./ingestion-pipeline.js');
const {
  enrichTier1,
  enqueueTier1Batch,
  getTier1BatchStatusList,
  getTier1BatchStatus,
  startTier1BatchWorker,
  stopTier1BatchWorker,
} = require('./tier1-enrichment.js');
const { importEmailMbox } = require('./email-importer.js');
const {
  getBraintrustLogger,
  logError,
  logApiSuccess,
  logApiError,
} = require('./observability.js');
const { getLogger } = require('./logger/index.js');
const {
  withRequestContext,
  setRunIdFromBody,
  getRunContext,
  setContextPatch,
} = require('./logger/context.js');

const testModeService = new TestModeService();

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

function parseBoolParam(value, fallback = false) {
  if (value === null || value === undefined || value === '') return fallback;
  const v = String(value).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
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

  if (method === 'GET' && url.pathname === '/status/t1/batch') {
    try {
      const limit = Number(url.searchParams.get('limit') || 50);
      const schema = url.searchParams.get('schema') || undefined;
      const include_terminal = parseBoolParam(url.searchParams.get('include_terminal'), false);
      const result = await getTier1BatchStatusList({
        limit,
        schema,
        include_terminal,
      });
      return json(res, 200, result);
    } catch (err) {
      logError(err, req);
      return json(res, 400, { error: 'bad_request', message: err.message });
    }
  }

  const batchStatusMatch = (method === 'GET')
    ? url.pathname.match(/^\/status\/t1\/batch\/([^/]+)$/)
    : null;
  if (batchStatusMatch) {
    try {
      const batch_id = decodeURIComponent(batchStatusMatch[1]);
      const schema = url.searchParams.get('schema') || undefined;
      const include_items = parseBoolParam(url.searchParams.get('include_items'), false);
      const items_limit = Number(url.searchParams.get('items_limit') || 200);
      const result = await getTier1BatchStatus(batch_id, {
        schema,
        include_items,
        items_limit,
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
      logError(err, req);
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
  const server = createServer();
  server.listen(port, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`server listening on :${port}`);
  });
  const shutdown = () => {
    stopTier1BatchWorker();
    clearInterval(pruneTimer);
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
