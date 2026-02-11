'use strict';

const http = require('http');
const { URL } = require('url');
const pkg = require('./package.json');
const db = require('./db.js');
const { getConfig } = require('./config.js');
const {
  getBraintrustLogger,
  logError,
  logApiSuccess,
  logApiError,
} = require('./observability.js');

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
    return json(res, 200, getConfig());
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
      } else {
        return notFound(res);
      }

      const isRead = url.pathname.startsWith('/db/read/');
      const isPull = url.pathname === '/db/read/pull';
      const firstRow = (result.rows && result.rows[0]) || null;
      const payload = isRead && !isPull
        ? {
          ok: true,
          rowCount: result.rowCount,
          rows: result.rows || [],
        }
        : Object.assign({
          ok: true,
          rowCount: result.rowCount,
        }, firstRow || {});
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
  const server = createServer();
  server.listen(port, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`server listening on :${port}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = {
  createServer,
  handleRequest,
};
