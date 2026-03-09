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

  test('POST /distill/run returns X-PKM-Run-Id from body run_id', async () => {
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
      JSON.stringify({ run_id: 'run-tier2-123', dry_run: false }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      },
    );

    expect(res.status).toBe(200);
    expect(res.headers['x-pkm-run-id']).toBe('run-tier2-123');
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

  test('GET /status/batch/:batch_id passes detail query fields for stage=t2', async () => {
    const captured = [];
    jest.doMock('../../src/server/batch-status-service.js', () => ({
      createBatchStatusService: () => ({
        getBatchStatusList: async () => ({ summary: {}, jobs: [] }),
        getBatchStatus: async (input) => {
          captured.push(input);
          return {
            schema: 'pkm',
            batch_id: input.batch_id,
            status: 'completed',
            is_terminal: true,
            counts: {
              total_items: 1,
              processed: 1,
              ok: 1,
              parse_error: 0,
              error: 0,
              pending: 0,
            },
          };
        },
      }),
    }));

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'GET',
      '/status/batch/t2_abc123?stage=t2&include_items=true&items_limit=15&schema=pkm_test',
    );

    expect(res.status).toBe(200);
    expect(captured).toEqual([
      {
        stage: 't2',
        batch_id: 't2_abc123',
        schema: 'pkm_test',
        include_items: 'true',
        items_limit: '15',
      },
    ]);
  });

  test('GET /status/batch/:batch_id returns not_found when missing', async () => {
    jest.doMock('../../src/server/batch-status-service.js', () => ({
      createBatchStatusService: () => ({
        getBatchStatusList: async () => ({ summary: {}, jobs: [] }),
        getBatchStatus: async () => null,
      }),
    }));

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'GET',
      '/status/batch/does_not_exist?stage=t2',
    );

    expect(res.status).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'not_found' });
  });

  test('POST /distill/run applies boolean-like string options end-to-end', async () => {
    const plannerInputs = [];
    const distillCalls = [];

    jest.doMock('../../src/server/tier2/planner.js', () => ({
      runTier2ControlPlanePlan: async (input) => {
        plannerInputs.push(input);
        return {
          target_schema: 'pkm',
          candidate_count: 2,
          decision_counts: { proceed: 1, skipped: 1, not_eligible: 0 },
          persisted_eligibility: { updated: 0, groups: [] },
          selected_count: 1,
          selected: [{ id: 'a', entry_id: 701 }],
        };
      },
    }));

    jest.doMock('../../src/server/tier2/service.js', () => ({
      distillTier2SingleEntrySync: async (entryId) => {
        distillCalls.push(entryId);
        return { entry_id: entryId, status: 'completed' };
      },
    }));

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/distill/run',
      JSON.stringify({
        dry_run: 'false',
        persist_eligibility: 'false',
        max_sync_items: 1,
      }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      },
    );

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.mode).toBe('run');
    expect(parsed.processed_count).toBe(1);
    expect(parsed.completed_count).toBe(1);
    expect(parsed.failed_count).toBe(0);
    expect(typeof parsed.batch_id).toBe('string');
    expect(parsed.batch_id).toMatch(/^t2_/);
    expect(distillCalls).toEqual([701]);
    expect(plannerInputs).toEqual([
      {
        candidate_limit: undefined,
        persist_eligibility: false,
        include_details: false,
        target_schema: 'pkm',
      },
    ]);
  });

  test('POST /distill/run forwards explicit execution_mode=sync', async () => {
    const distillCalls = [];
    jest.doMock('../../src/server/tier2/planner.js', () => ({
      runTier2ControlPlanePlan: async () => ({
        target_schema: 'pkm',
        candidate_count: 1,
        decision_counts: { proceed: 1, skipped: 0, not_eligible: 0 },
        persisted_eligibility: { updated: 0, groups: [] },
        selected_count: 1,
        selected: [{ id: 'a', entry_id: 991 }],
      }),
    }));

    jest.doMock('../../src/server/tier2/service.js', () => ({
      distillTier2SingleEntrySync: async (entryId, options) => {
        distillCalls.push({ entryId, options });
        return { entry_id: entryId, status: 'completed' };
      },
    }));

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/distill/run',
      JSON.stringify({
        execution_mode: 'sync',
        max_sync_items: 1,
      }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      },
    );

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.execution_mode).toBe('sync');
    expect(distillCalls).toEqual([
      {
        entryId: 991,
        options: expect.objectContaining({
          retry_count: 0,
          execution_mode: 'sync',
        }),
      },
    ]);
  });

  test('POST /distill/run returns normalized payload when planner errors', async () => {
    jest.doMock('../../src/server/tier2/planner.js', () => ({
      runTier2ControlPlanePlan: async () => {
        throw new Error('planner unavailable');
      },
    }));

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/distill/run',
      JSON.stringify({ dry_run: false, max_sync_items: 3 }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      },
    );

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.mode).toBe('run');
    expect(parsed.error).toContain('planner unavailable');
    expect(parsed.failed_count).toBe(1);
    expect(typeof parsed.batch_id).toBe('string');
    expect(parsed.batch_id).toMatch(/^t2_/);

    const statusRes = await request(
      port,
      'GET',
      `/status/batch/${parsed.batch_id}?stage=t2`,
    );
    expect(statusRes.status).toBe(200);
    const statusBody = JSON.parse(statusRes.body);
    expect(statusBody.status).toBe('failed');
    expect(statusBody.metadata.error).toContain('planner unavailable');
  });

  test('POST /distill/run passes preserved_current_artifact in failed results', async () => {
    jest.doMock('../../src/server/tier2/planner.js', () => ({
      runTier2ControlPlanePlan: async () => ({
        target_schema: 'pkm',
        candidate_count: 1,
        decision_counts: { proceed: 1, skipped: 0, not_eligible: 0 },
        persisted_eligibility: { updated: 0, groups: [] },
        selected_count: 1,
        selected: [{ id: 'a', entry_id: 706 }],
      }),
    }));

    jest.doMock('../../src/server/tier2/service.js', () => ({
      distillTier2SingleEntrySync: async (entryId) => ({
        entry_id: Number(entryId),
        status: 'failed',
        error_code: 'generation_error',
        message: 'litellm timeout',
        preserved_current_artifact: true,
      }),
    }));

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/distill/run',
      JSON.stringify({ dry_run: false, max_sync_items: 1 }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      },
    );

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.mode).toBe('run');
    expect(parsed.failed_count).toBe(1);
    expect(parsed.preserved_current_count).toBe(1);
    expect(parsed.results).toEqual([
      {
        entry_id: 706,
        status: 'failed',
        error_code: 'generation_error',
        message: 'litellm timeout',
        preserved_current_artifact: true,
      },
    ]);
  });

  test('POST /distill/plan requires admin secret', async () => {
    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/distill/plan',
      JSON.stringify({ candidate_limit: 25 }),
      { 'Content-Type': 'application/json' },
    );

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'forbidden', message: 'forbidden' });
  });

  test('POST /distill/plan forwards request payload to planner', async () => {
    const plannerInputs = [];
    jest.doMock('../../src/server/tier2/planner.js', () => ({
      runTier2ControlPlanePlan: async (input) => {
        plannerInputs.push(input);
        return {
          target_schema: 'active',
          candidate_count: 0,
          decision_counts: { proceed: 0, skipped: 0, not_eligible: 0 },
          persisted_eligibility: { updated: 0, groups: [] },
          selected_count: 0,
          selected: [],
        };
      },
    }));

    await startServerWithMocks();
    if (listenDenied) return;

    const payload = {
      candidate_limit: 25,
      persist_eligibility: 'false',
      include_details: 'true',
    };
    const res = await request(
      port,
      'POST',
      '/distill/plan',
      JSON.stringify(payload),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      },
    );

    expect(res.status).toBe(200);
    expect(plannerInputs).toEqual([payload]);
    const parsed = JSON.parse(res.body);
    expect(parsed.selected_count).toBe(0);
  });

  test('POST /distill/sync returns failure message payload from service', async () => {
    jest.doMock('../../src/server/tier2/service.js', () => ({
      distillTier2SingleEntrySync: async (entryId) => ({
        entry_id: Number(entryId),
        status: 'failed',
        summary: null,
        excerpt: null,
        why_it_matters: null,
        stance: null,
        error_code: 'generation_error',
        message: 'LiteLLM chat completion error: invalid model',
      }),
    }));

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/distill/sync',
      JSON.stringify({ entry_id: 797 }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      },
    );

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed).toEqual({
      entry_id: 797,
      status: 'failed',
      summary: null,
      excerpt: null,
      why_it_matters: null,
      stance: null,
      error_code: 'generation_error',
      message: 'LiteLLM chat completion error: invalid model',
    });
  });

  test('POST /distill/sync returns completed payload with why_it_matters and excerpt', async () => {
    jest.doMock('../../src/server/tier2/service.js', () => ({
      distillTier2SingleEntrySync: async (entryId) => ({
        entry_id: Number(entryId),
        status: 'completed',
        summary: 'Distilled summary.',
        excerpt: 'Grounded excerpt.',
        why_it_matters: 'Important for future retrieval.',
        stance: 'analytical',
      }),
    }));

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/distill/sync',
      JSON.stringify({ entry_id: 794 }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      },
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      entry_id: 794,
      status: 'completed',
      summary: 'Distilled summary.',
      excerpt: 'Grounded excerpt.',
      why_it_matters: 'Important for future retrieval.',
      stance: 'analytical',
    });
  });

  test('POST /distill/sync returns currentness_mismatch payload', async () => {
    jest.doMock('../../src/server/tier2/service.js', () => ({
      distillTier2SingleEntrySync: async (entryId) => ({
        entry_id: Number(entryId),
        status: 'failed',
        summary: null,
        excerpt: null,
        why_it_matters: null,
        stance: null,
        error_code: 'currentness_mismatch',
        message: 'entry content changed during distillation; no write was applied',
      }),
    }));

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/distill/sync',
      JSON.stringify({ entry_id: 798 }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      },
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      entry_id: 798,
      status: 'failed',
      summary: null,
      excerpt: null,
      why_it_matters: null,
      stance: null,
      error_code: 'currentness_mismatch',
      message: 'entry content changed during distillation; no write was applied',
    });
  });

  test('POST /distill/sync returns preserved_current_artifact flag', async () => {
    jest.doMock('../../src/server/tier2/service.js', () => ({
      distillTier2SingleEntrySync: async (entryId) => ({
        entry_id: Number(entryId),
        status: 'failed',
        summary: null,
        excerpt: null,
        why_it_matters: null,
        stance: null,
        error_code: 'generation_error',
        message: 'litellm timeout',
        preserved_current_artifact: true,
      }),
    }));

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/distill/sync',
      JSON.stringify({ entry_id: 799 }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      },
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      entry_id: 799,
      status: 'failed',
      summary: null,
      excerpt: null,
      why_it_matters: null,
      stance: null,
      error_code: 'generation_error',
      message: 'litellm timeout',
      preserved_current_artifact: true,
    });
  });

  test('POST /distill/sync requires admin secret', async () => {
    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/distill/sync',
      JSON.stringify({ entry_id: 123 }),
      { 'Content-Type': 'application/json' },
    );

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'forbidden', message: 'forbidden' });
  });

  test('POST /distill/sync validates entry_id before service work', async () => {
    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/distill/sync',
      JSON.stringify({ entry_id: 'abc' }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      },
    );

    expect(res.status).toBe(400);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toBe('bad_request');
    expect(parsed.message).toContain('entry_id must be a positive integer');
  });

  test('POST /distill/sync maps service 404 to not_found', async () => {
    jest.doMock('../../src/server/tier2/service.js', () => ({
      distillTier2SingleEntrySync: async () => {
        const err = new Error('entry_id not found: 999999');
        err.statusCode = 404;
        throw err;
      },
    }));

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/distill/sync',
      JSON.stringify({ entry_id: 999999 }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      },
    );

    expect(res.status).toBe(404);
    expect(JSON.parse(res.body)).toEqual({
      error: 'not_found',
      message: 'entry_id not found: 999999',
    });
  });
});
