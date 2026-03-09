'use strict';

const http = require('http');

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
      res.on('data', (chunk) => chunks.push(chunk));
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

describe('tier2 API contract', () => {
  let server = null;
  let port = null;
  let envBackup;
  let listenDenied = false;

  beforeEach(() => {
    jest.resetModules();
    listenDenied = false;
    envBackup = { ...process.env };
    process.env.PKM_ADMIN_SECRET = 'test-admin-secret';
  });

  afterEach(async () => {
    if (server && server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    server = null;
    port = null;
    process.env = envBackup;
  });

  async function startServerWithMocks() {
    const { createServer } = require('../../src/server/index.js');
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
  }

  test('POST /distill/run returns normalized worker-busy payload', async () => {
    jest.doMock('../../src/server/tier2-enrichment.js', () => ({
      runTier2BatchWorkerCycle: async () => ({
        mode: 'skipped',
        target_schema: 'pkm',
        skipped: true,
        reason: 'worker_busy',
        message: 'Tier-2 batch worker is busy. Try again shortly.',
      }),
      getTier2BatchStatusList: async () => ({ summary: {}, jobs: [] }),
      getTier2BatchStatus: async () => null,
      startTier2BatchWorker: () => {},
      stopTier2BatchWorker: () => {},
    }));

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/distill/run',
      JSON.stringify({ dry_run: false }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      },
    );

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed).toEqual({
      mode: 'skipped',
      target_schema: 'pkm',
      skipped: true,
      reason: 'worker_busy',
      message: 'Tier-2 batch worker is busy. Try again shortly.',
    });
  });

  test('POST /distill/run requires admin secret', async () => {
    jest.doMock('../../src/server/tier2-enrichment.js', () => ({
      runTier2BatchWorkerCycle: async () => ({ mode: 'run' }),
      getTier2BatchStatusList: async () => ({ summary: {}, jobs: [] }),
      getTier2BatchStatus: async () => null,
      startTier2BatchWorker: () => {},
      stopTier2BatchWorker: () => {},
    }));

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/distill/run',
      JSON.stringify({ dry_run: false }),
      {
        'Content-Type': 'application/json',
      },
    );

    expect(res.status).toBe(403);
    const parsed = JSON.parse(res.body);
    expect(parsed).toEqual({ error: 'forbidden', message: 'forbidden' });
  });

  test('GET /status/batch passes stage=t2 query fields to status service', async () => {
    const captured = [];
    jest.doMock('../../src/server/batch-status-service.js', () => ({
      createBatchStatusService: () => ({
        getBatchStatusList: async (input) => {
          captured.push(input);
          return {
            summary: {
              jobs: 0,
              in_progress: 0,
              terminal: 0,
              total_items: 0,
              processed: 0,
              pending: 0,
              ok: 0,
              parse_error: 0,
              error: 0,
            },
            jobs: [],
          };
        },
        getBatchStatus: async () => null,
      }),
    }));

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'GET',
      '/status/batch?stage=t2&limit=2&include_terminal=false&schema=pkm_test',
    );

    expect(res.status).toBe(200);
    expect(captured).toEqual([
      {
        stage: 't2',
        limit: 2,
        schema: 'pkm_test',
        include_terminal: 'false',
      },
    ]);
  });
});
