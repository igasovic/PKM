'use strict';

const http = require('http');
const { createServer } = require('../src/server/index.js');

function request(port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body: text });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('server smoke', () => {
  let server;
  let port = null;
  let listenDenied = false;

  beforeAll(async () => {
    server = createServer();
    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => reject(err);
        server.once('error', onError);
        server.listen(0, '127.0.0.1', () => {
          server.off('error', onError);
          resolve();
        });
      });
      port = server.address().port;
    } catch (err) {
      if (err && (err.code === 'EPERM' || err.code === 'EACCES')) {
        listenDenied = true;
        return;
      }
      throw err;
    }
  });

  afterAll(async () => {
    if (!server || !server.listening) return;
    await new Promise((resolve) => server.close(resolve));
  });

  test('GET /health', async () => {
    if (listenDenied) return;
    const res = await request(port, 'GET', '/health');
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"status":"ok"}');
  });

  test('GET /version', async () => {
    if (listenDenied) return;
    const res = await request(port, 'GET', '/version');
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.name).toBe('pkm-backend');
    expect(parsed.version).toBeTruthy();
  });

  test('POST /echo', async () => {
    if (listenDenied) return;
    const res = await request(
      port,
      'POST',
      '/echo',
      JSON.stringify({ ping: true }),
      { 'Content-Type': 'application/json' }
    );
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"ok":true,"data":{"ping":true}}');
  });

  test('GET /missing', async () => {
    if (listenDenied) return;
    const res = await request(port, 'GET', '/missing');
    expect(res.status).toBe(404);
  });
});
