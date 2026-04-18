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
        resolve({ status: res.statusCode, body: text, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('control and debug API contract', () => {
  let server = null;
  let port = null;
  let envBackup;
  let listenDenied = false;
  let debugRepositoryMock;

  beforeEach(() => {
    jest.resetModules();
    listenDenied = false;
    envBackup = { ...process.env };
    process.env.PKM_ADMIN_SECRET = 'test-admin-secret';

    debugRepositoryMock = {
      upsertFailurePack: jest.fn(),
      getFailurePackById: jest.fn(),
      getFailurePackByRunId: jest.fn(),
      getFailurePackByRootExecutionId: jest.fn(),
      listFailurePacks: jest.fn(),
      listOpenFailurePacks: jest.fn(async () => ({ rows: [], limit: 30 })),
      analyzeFailurePack: jest.fn(),
      resolveFailurePack: jest.fn(),
      getPipelineRun: jest.fn(async () => ({ run_id: 'run-1', rows: [] })),
      getLastPipelineRun: jest.fn(async () => ({ run_id: 'run-last', rows: [{ step: 'done' }] })),
      getRecentPipelineRuns: jest.fn(async () => ({ rows: [{ run_id: 'run-1' }], limit: 5 })),
      prunePipelineEvents: jest.fn(async () => ({ deleted: 0 })),
    };

    jest.doMock('../../src/server/repositories/debug-repository.js', () => debugRepositoryMock);
    jest.doMock('../../src/server/tier1-enrichment.js', () => ({
      getTier1BatchStatusList: async () => ({ summary: {}, jobs: [] }),
      getTier1BatchStatus: async () => null,
      startTier1BatchWorker: () => {},
      stopTier1BatchWorker: () => {},
      enrichTier1: jest.fn(),
      enqueueTier1Batch: jest.fn(),
    }));
    jest.doMock('../../src/server/tier2-enrichment.js', () => ({
      getTier2BatchStatusList: async () => ({ summary: {}, jobs: [] }),
      getTier2BatchStatus: async () => null,
      startTier2BatchWorker: () => {},
      stopTier2BatchWorker: () => {},
      runTier2BatchWorkerCycle: jest.fn(),
    }));
  });

  afterEach(async () => {
    if (server && server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    server = null;
    port = null;
    process.env = envBackup;
  });

  async function startServer() {
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

  test('GET health, ready, version, and config return control payloads', async () => {
    await startServer();
    if (listenDenied) return;

    const health = await request(port, 'GET', '/health');
    const ready = await request(port, 'GET', '/ready');
    const version = await request(port, 'GET', '/version');
    const config = await request(port, 'GET', '/config');

    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toEqual({ status: 'ok' });
    expect(ready.status).toBe(200);
    expect(JSON.parse(ready.body)).toEqual({ status: 'ready' });
    expect(version.status).toBe(200);
    expect(JSON.parse(version.body)).toEqual(expect.objectContaining({ name: 'pkm-backend' }));
    expect(config.status).toBe(200);
    expect(JSON.parse(config.body)).toEqual(expect.objectContaining({ db: expect.any(Object) }));
  });

  test('GET /debug/runs requires admin secret and forwards query filters', async () => {
    await startServer();
    if (listenDenied) return;

    const forbidden = await request(port, 'GET', '/debug/runs?limit=5&before=2026-03-30T00:00:00.000Z&has_error=true&pipeline=t1.enrich&step=batch.collect');
    expect(forbidden.status).toBe(403);

    const res = await request(port, 'GET', '/debug/runs?limit=5&before=2026-03-30T00:00:00.000Z&has_error=true&pipeline=t1.enrich&step=batch.collect', null, {
      'x-pkm-admin-secret': 'test-admin-secret',
    });

    expect(res.status).toBe(200);
    expect(debugRepositoryMock.getRecentPipelineRuns).toHaveBeenCalledWith({
      limit: 5,
      before_ts: '2026-03-30T00:00:00.000Z',
      has_error: 'true',
      pipeline: 't1.enrich',
      step: 'batch.collect',
    });
    expect(JSON.parse(res.body)).toEqual({ rows: [{ run_id: 'run-1' }], limit: 5 });
  });

  test('GET /debug/failures/by-run/:run_id returns normalized failure row', async () => {
    debugRepositoryMock.getFailurePackByRunId.mockResolvedValue({
      failure_id: 'f-1',
      run_id: 'run-1',
      workflow_name: 'WF99',
      node_name: 'Capture',
      error_message: 'boom',
      status: 'captured',
      has_sidecars: false,
      pack: { summary: 'x' },
    });

    await startServer();
    if (listenDenied) return;

    const res = await request(port, 'GET', '/debug/failures/by-run/run-1', null, {
      'x-pkm-admin-secret': 'test-admin-secret',
    });

    expect(res.status).toBe(200);
    expect(debugRepositoryMock.getFailurePackByRunId).toHaveBeenCalledWith('run-1');
    expect(JSON.parse(res.body)).toEqual(expect.objectContaining({
      failure_id: 'f-1',
      run_id: 'run-1',
      workflow_name: 'WF99',
      node_name: 'Capture',
      error_message: 'boom',
      has_sidecars: false,
      pack: { summary: 'x' },
    }));
  });

  test('GET /debug/run/last forwards limit and returns last trace payload', async () => {
    await startServer();
    if (listenDenied) return;

    const res = await request(port, 'GET', '/debug/run/last?limit=10', null, {
      'x-pkm-admin-secret': 'test-admin-secret',
    });

    expect(res.status).toBe(200);
    expect(debugRepositoryMock.getLastPipelineRun).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }));
    expect(JSON.parse(res.body)).toEqual({ run_id: 'run-last', rows: [{ step: 'done' }] });
  });

  test('GET /db/test-mode and POST /echo return control helpers', async () => {
    await startServer();
    if (listenDenied) return;

    const testMode = await request(port, 'GET', '/db/test-mode');
    const echo = await request(port, 'POST', '/echo', JSON.stringify({ ok: true, run_id: 'run-echo' }), {
      'Content-Type': 'application/json',
    });

    expect(testMode.status).toBe(200);
    expect(JSON.parse(testMode.body)).toEqual([{ is_test_mode: false, test_mode_on_since: null }]);
    expect(echo.status).toBe(200);
    expect(JSON.parse(echo.body)).toEqual({ ok: true, data: { ok: true, run_id: 'run-echo' } });
    expect(echo.headers['x-pkm-run-id']).toBe('run-echo');
  });
});
