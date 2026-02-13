'use strict';

const http = require('http');
const { URL } = require('url');
const pkg = require('./package.json');
const db = require('./db.js');
const { TestModeService } = require('./test-mode.js');
const { getConfig } = require('../libs/config.js');
const {
  normalizeTelegram,
  normalizeEmail,
  normalizeWebpage,
  decideEmailIntent,
} = require('./normalization.js');
const {
  enrichTier1,
  enqueueTier1Batch,
  startTier1BatchWorker,
  stopTier1BatchWorker,
} = require('./tier1-enrichment.js');
const {
  getBraintrustLogger,
  logError,
  logApiSuccess,
  logApiError,
} = require('./observability.js');

const testModeService = new TestModeService();

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function notFound(res) {
  json(res, 404, { error: 'not_found' });
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

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const method = (req.method || 'GET').toUpperCase();

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
      const body = raw ? JSON.parse(raw) : {};
      const normalized = await normalizeTelegram({
        text: body.text,
        source: body.source,
      });
      return json(res, 200, normalized);
    } catch (err) {
      logError(err, req);
      return json(res, 400, { error: 'bad_request', message: err.message });
    }
  }

  if (method === 'POST' && url.pathname === '/normalize/email/intent') {
    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const intent = decideEmailIntent(body.textPlain);
      return json(res, 200, { content_type: intent.content_type });
    } catch (err) {
      logError(err, req);
      return json(res, 400, { error: 'bad_request', message: err.message });
    }
  }

  if (method === 'POST' && url.pathname === '/normalize/email') {
    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const normalized = await normalizeEmail({
        raw_text: body.raw_text,
        from: body.from,
        subject: body.subject,
        source: body.source,
      });
      return json(res, 200, normalized);
    } catch (err) {
      logError(err, req);
      return json(res, 400, { error: 'bad_request', message: err.message });
    }
  }

  if (method === 'POST' && url.pathname === '/normalize/webpage') {
    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const normalized = await normalizeWebpage({
        text: body.text,
        extracted_text: body.extracted_text,
        clean_text: body.clean_text,
        capture_text: body.capture_text,
        content_type: body.content_type,
        url: body.url,
        url_canonical: body.url_canonical,
        excerpt: body.excerpt,
      });
      return json(res, 200, normalized);
    } catch (err) {
      logError(err, req);
      return json(res, 400, { error: 'bad_request', message: err.message });
    }
  }

  if (method === 'POST' && url.pathname === '/enrich/t1') {
    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const result = await enrichTier1({
        title: body.title ?? null,
        author: body.author ?? null,
        clean_text: body.clean_text ?? null,
      });
      return json(res, 200, result);
    } catch (err) {
      logError(err, req);
      return json(res, 400, { error: 'bad_request', message: err.message });
    }
  }

  if (method === 'POST' && url.pathname === '/enrich/t1/batch') {
    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const result = await enqueueTier1Batch(body.items || [], {
        metadata: body.metadata || undefined,
        completion_window: body.completion_window || '24h',
      });
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
      const body = raw ? JSON.parse(raw) : {};
      meta.input = body;
      let result;

      if (url.pathname === '/db/insert') {
        result = await db.insert(body);
      } else if (url.pathname === '/db/update') {
        result = await db.update(body);
      } else if (url.pathname === '/db/read/continue') {
        result = await db.readContinue(body);
      } else if (url.pathname === '/db/read/find') {
        result = await db.readFind(body);
      } else if (url.pathname === '/db/read/last') {
        result = await db.readLast(body);
      } else if (url.pathname === '/db/read/pull') {
        result = await db.readPull(body);
      } else if (url.pathname === '/db/test-mode/toggle') {
        const state = await testModeService.toggle();
        result = { rows: [{ is_test_mode: state }], rowCount: 1 };
      } else {
        return notFound(res);
      }

      const payload = (result && result.rows) ? result.rows : [];
      logApiSuccess(meta, { rowCount: result.rowCount }, { duration_ms: Date.now() - start });
      return json(res, 200, payload);
    } catch (err) {
      logApiError(meta, err, { duration_ms: Date.now() - start });
      logError(err, req);
      return json(res, 400, { error: 'bad_request', message: err.message });
    }
  }

  return notFound(res);
}

function createServer() {
  return http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      logError(err, req);
      json(res, 500, { error: 'internal_error', message: err.message });
    });
  });
}

function start() {
  const port = Number(process.env.PORT || 8080);
  // Hard-fail startup if Braintrust can't initialize.
  getBraintrustLogger();
  startTier1BatchWorker();
  const server = createServer();
  server.listen(port, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`server listening on :${port}`);
  });
  const shutdown = () => {
    stopTier1BatchWorker();
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
