'use strict';

const assert = require('assert');
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

(async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    {
      const res = await request(port, 'GET', '/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body, '{"status":"ok"}');
    }

    {
      const res = await request(port, 'GET', '/version');
      assert.strictEqual(res.status, 200);
      const parsed = JSON.parse(res.body);
      assert.strictEqual(parsed.name, 'pkm-backend');
      assert.ok(parsed.version);
    }

    {
      const res = await request(
        port,
        'POST',
        '/echo',
        JSON.stringify({ ping: true }),
        { 'Content-Type': 'application/json' }
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body, '{"ok":true,"data":{"ping":true}}');
    }

    {
      const res = await request(port, 'GET', '/missing');
      assert.strictEqual(res.status, 404);
    }
  } finally {
    server.close();
  }

  // eslint-disable-next-line no-console
  console.log('server: OK');
})();
