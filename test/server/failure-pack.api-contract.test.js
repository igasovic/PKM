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

describe('failure-pack API contract', () => {
  let server = null;
  let port = null;
  let envBackup;
  let listenDenied = false;
  let debugRepoMock;

  beforeEach(() => {
    jest.resetModules();
    listenDenied = false;
    envBackup = { ...process.env };
    process.env.PKM_ADMIN_SECRET = 'test-admin-secret';

    debugRepoMock = {
      upsertFailurePack: jest.fn(async () => ({
        failure_id: '11111111-1111-4111-8111-111111111111',
        run_id: 'run-abc',
        status: 'captured',
        upsert_action: 'inserted',
      })),
      getFailurePackById: jest.fn(async () => ({
        failure_id: '11111111-1111-4111-8111-111111111111',
        run_id: 'run-abc',
        workflow_name: 'WF 99 Error Handling',
        node_name: 'Normalize article',
        error_message: 'Request failed with status 500',
        failed_at: '2026-03-28T20:00:00.000Z',
        mode: 'production',
        status: 'captured',
        created_at: '2026-03-28T20:00:00.000Z',
        updated_at: '2026-03-28T20:00:01.000Z',
        execution_id: '123',
        workflow_id: '99',
        node_type: 'n8n-nodes-base.httpRequest',
        error_name: 'AxiosError',
        has_sidecars: true,
        sidecar_root: 'debug/failures/2026/03/28/run-abc/pack-sidecars',
        pack: { schema_version: 'failure-pack.v1', run_id: 'run-abc' },
      })),
      getFailurePackByRunId: jest.fn(async () => ({
        failure_id: '11111111-1111-4111-8111-111111111111',
        run_id: 'run-abc',
        workflow_name: 'WF 99 Error Handling',
        node_name: 'Normalize article',
        error_message: 'Request failed with status 500',
        failed_at: '2026-03-28T20:00:00.000Z',
        mode: 'production',
        status: 'captured',
        created_at: '2026-03-28T20:00:00.000Z',
        updated_at: '2026-03-28T20:00:01.000Z',
        execution_id: '123',
        workflow_id: '99',
        node_type: 'n8n-nodes-base.httpRequest',
        error_name: 'AxiosError',
        has_sidecars: true,
        sidecar_root: 'debug/failures/2026/03/28/run-abc/pack-sidecars',
        pack: { schema_version: 'failure-pack.v1', run_id: 'run-abc' },
      })),
      listFailurePacks: jest.fn(async () => ({
        rows: [{
          failure_id: '11111111-1111-4111-8111-111111111111',
          run_id: 'run-abc',
          workflow_name: 'WF 99 Error Handling',
          node_name: 'Normalize article',
          error_message: 'Request failed with status 500',
          failed_at: '2026-03-28T20:00:00.000Z',
          mode: 'production',
          status: 'captured',
          created_at: '2026-03-28T20:00:00.000Z',
          updated_at: '2026-03-28T20:00:01.000Z',
          execution_id: '123',
          workflow_id: '99',
          node_type: 'n8n-nodes-base.httpRequest',
          error_name: 'AxiosError',
          has_sidecars: false,
          sidecar_root: null,
        }],
        limit: 20,
        before_ts: null,
        workflow_name: 'WF',
        node_name: 'Normalize',
        mode: 'production',
      })),
      getPipelineRun: jest.fn(async () => ({ run_id: 'run-abc', rows: [{ run_id: 'run-abc', seq: 1 }] })),
      getLastPipelineRun: jest.fn(async () => ({ run_id: null, rows: [] })),
      getRecentPipelineRuns: jest.fn(async () => ({ rows: [], limit: 20, before_ts: null, has_error: null })),
      prunePipelineEvents: jest.fn(async () => ({ deleted: 0, keep_days: 30 })),
    };

    jest.doMock('../../src/server/repositories/debug-repository.js', () => debugRepoMock);
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

  test('POST /debug/failures upserts one normalized envelope', async () => {
    await startServer();
    if (listenDenied) return;

    const body = {
      schema_version: 'failure-pack.v1',
      run_id: 'run-abc',
      correlation: { workflow_name: 'WF 99 Error Handling', mode: 'production' },
      failure: { node_name: 'Normalize article', error_message: 'Request failed with status 500' },
      artifacts: [],
      payloads: {
        failing_node_input: { item_count: 0, items: [] },
        upstream_context: { basis: 'direct-parent-input', nodes: [] },
      },
    };

    const res = await request(
      port,
      'POST',
      '/debug/failures',
      JSON.stringify(body),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      },
    );

    expect(res.status).toBe(200);
    expect(debugRepoMock.upsertFailurePack).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(res.body);
    expect(parsed).toEqual({
      failure_id: '11111111-1111-4111-8111-111111111111',
      run_id: 'run-abc',
      status: 'captured',
      upsert_action: 'inserted',
    });
  });

  test('POST /debug/failures requires admin secret', async () => {
    await startServer();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/debug/failures',
      JSON.stringify({
        schema_version: 'failure-pack.v1',
        run_id: 'run-abc',
        correlation: { workflow_name: 'WF' },
        failure: { node_name: 'Node', error_message: 'x' },
      }),
      { 'Content-Type': 'application/json' },
    );

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'forbidden', message: 'forbidden' });
  });

  test('GET /debug/failures returns summary rows and filter passthrough', async () => {
    await startServer();
    if (listenDenied) return;

    const res = await request(
      port,
      'GET',
      '/debug/failures?limit=20&workflow_name=WF&node_name=Normalize&mode=production',
      null,
      { 'x-pkm-admin-secret': 'test-admin-secret' },
    );

    expect(res.status).toBe(200);
    expect(debugRepoMock.listFailurePacks).toHaveBeenCalledWith({
      limit: 20,
      before_ts: null,
      workflow_name: 'WF',
      node_name: 'Normalize',
      mode: 'production',
    });
    const parsed = JSON.parse(res.body);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].pack).toBeUndefined();
  });

  test('GET /debug/failure-bundle/:run_id returns failure + run trace', async () => {
    await startServer();
    if (listenDenied) return;

    const res = await request(
      port,
      'GET',
      '/debug/failure-bundle/run-abc',
      null,
      { 'x-pkm-admin-secret': 'test-admin-secret' },
    );

    expect(res.status).toBe(200);
    expect(debugRepoMock.getFailurePackByRunId).toHaveBeenCalledWith('run-abc');
    expect(debugRepoMock.getPipelineRun).toHaveBeenCalledWith('run-abc', { limit: 5000 });
    const parsed = JSON.parse(res.body);
    expect(parsed.run_id).toBe('run-abc');
    expect(parsed.failure.failure_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(parsed.run_trace).toEqual({ run_id: 'run-abc', rows: [{ run_id: 'run-abc', seq: 1 }] });
  });
});
