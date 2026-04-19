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

describe('read-write API contract', () => {
  let server = null;
  let port = null;
  let envBackup;
  let listenDenied = false;
  let repoMock;

  beforeEach(() => {
    jest.resetModules();
    listenDenied = false;
    envBackup = { ...process.env };
    process.env.PKM_ADMIN_SECRET = 'test-admin-secret';

    repoMock = {
      insertPkm: jest.fn(async () => ({ rows: [{ entry_id: 1, id: 'uuid-1', action: 'inserted' }], rowCount: 1 })),
      insertPkmBatch: jest.fn(async () => ({ rows: [{ _batch_index: 0, _batch_ok: true, entry_id: 1, id: 'uuid-1', action: 'inserted', error: null }], rowCount: 1 })),
      insertPkmEnriched: jest.fn(async () => ({ rows: [{ entry_id: 1, id: 'uuid-1', action: 'inserted', gist: 'ok' }], rowCount: 1 })),
      update: jest.fn(async () => ({ rows: [{ entry_id: 1, updated: true }], rowCount: 1 })),
      deleteEntries: jest.fn(async () => ({ rows: [{ entry_id: 1, deleted: true }], rowCount: 1 })),
      moveEntries: jest.fn(async () => ({ rows: [{ entry_id: 1, moved: true }], rowCount: 1 })),
      readContinue: jest.fn(async () => ({ rows: [{ entry_id: 1 }], rowCount: 1 })),
      readFind: jest.fn(async () => ({ rows: [{ entry_id: 2, title: 'match' }], rowCount: 1 })),
      readLast: jest.fn(async () => ({ rows: [{ entry_id: 3 }], rowCount: 1 })),
      readPull: jest.fn(async () => ({ rows: [{ entry_id: 4, excerpt: 'detail' }], rowCount: 1 })),
      readSmoke: jest.fn(async () => ({ rows: [{ entry_id: 5 }], rowCount: 1 })),
      readEntities: jest.fn(async () => ({ rows: [{ is_meta: true, cmd: 'entities' }, { entry_id: 6 }], rowCount: 2 })),
    };
    jest.doMock('../../src/server/repositories/read-write-repository.js', () => repoMock);
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

  test('POST /db/insert is removed', async () => {
    await startServer();
    if (listenDenied) return;

    const payload = { input: { source: 'telegram', capture_text: 'hello' } };
    const res = await request(port, 'POST', '/db/insert', JSON.stringify(payload), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(404);
  });

  test('POST /pkm/insert returns repository rows', async () => {
    await startServer();
    if (listenDenied) return;

    const payload = {
      source: 'telegram',
      intent: 'archive',
      content_type: 'note',
      capture_text: 'hello',
      clean_text: 'hello',
      idempotency_policy_key: 'telegram_thought_v1',
      idempotency_key_primary: 'tg:1:1',
    };
    const res = await request(port, 'POST', '/pkm/insert', JSON.stringify(payload), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(200);
    expect(repoMock.insertPkm).toHaveBeenCalledWith(payload);
    expect(JSON.parse(res.body)).toEqual([{ entry_id: 1, id: 'uuid-1', action: 'inserted' }]);
  });

  test('POST /pkm/insert/batch returns repository rows', async () => {
    await startServer();
    if (listenDenied) return;

    const payload = {
      continue_on_error: true,
      items: [{
        source: 'telegram',
        intent: 'archive',
        content_type: 'note',
        capture_text: 'hello',
        clean_text: 'hello',
        idempotency_policy_key: 'telegram_thought_v1',
        idempotency_key_primary: 'tg:1:1',
      }],
    };
    const res = await request(port, 'POST', '/pkm/insert/batch', JSON.stringify(payload), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(200);
    expect(repoMock.insertPkmBatch).toHaveBeenCalledWith(payload);
    expect(JSON.parse(res.body)).toEqual([{ _batch_index: 0, _batch_ok: true, entry_id: 1, id: 'uuid-1', action: 'inserted', error: null }]);
  });

  test('POST /pkm/insert/enriched returns repository rows', async () => {
    await startServer();
    if (listenDenied) return;

    const payload = {
      source: 'chatgpt',
      intent: 'thought',
      content_type: 'note',
      capture_text: 'hello',
      clean_text: 'hello',
      idempotency_policy_key: 'chatgpt_session_note_v1',
      idempotency_key_primary: 'chatgpt:session-1',
      gist: 'gist',
    };
    const res = await request(port, 'POST', '/pkm/insert/enriched', JSON.stringify(payload), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(200);
    expect(repoMock.insertPkmEnriched).toHaveBeenCalledWith(payload);
    expect(JSON.parse(res.body)).toEqual([{ entry_id: 1, id: 'uuid-1', action: 'inserted', gist: 'ok' }]);
  });

  test('POST /db/update returns repository rows', async () => {
    await startServer();
    if (listenDenied) return;

    const payload = { where: { entry_id: 1 }, set: { title: 'new' } };
    const res = await request(port, 'POST', '/db/update', JSON.stringify(payload), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(200);
    expect(repoMock.update).toHaveBeenCalledWith(payload);
    expect(JSON.parse(res.body)).toEqual([{ entry_id: 1, updated: true }]);
  });

  test('POST /db/move requires admin secret and forwards payload', async () => {
    await startServer();
    if (listenDenied) return;

    const payload = { entry_ids: [1], target_schema: 'pkm_test' };
    const forbidden = await request(port, 'POST', '/db/move', JSON.stringify(payload), { 'Content-Type': 'application/json' });
    expect(forbidden.status).toBe(403);

    const ok = await request(port, 'POST', '/db/move', JSON.stringify(payload), {
      'Content-Type': 'application/json',
      'x-pkm-admin-secret': 'test-admin-secret',
    });
    expect(ok.status).toBe(200);
    expect(repoMock.moveEntries).toHaveBeenCalledWith(payload);
    expect(JSON.parse(ok.body)).toEqual([{ entry_id: 1, moved: true }]);
  });

  test('POST /db/delete requires admin secret and forwards payload', async () => {
    await startServer();
    if (listenDenied) return;

    const payload = { entry_ids: [1] };
    const forbidden = await request(port, 'POST', '/db/delete', JSON.stringify(payload), { 'Content-Type': 'application/json' });
    expect(forbidden.status).toBe(403);

    const ok = await request(port, 'POST', '/db/delete', JSON.stringify(payload), {
      'Content-Type': 'application/json',
      'x-pkm-admin-secret': 'test-admin-secret',
    });
    expect(ok.status).toBe(200);
    expect(repoMock.deleteEntries).toHaveBeenCalledWith(payload);
    expect(JSON.parse(ok.body)).toEqual([{ entry_id: 1, deleted: true }]);
  });

  test('POST /db/read/find forwards query payload', async () => {
    await startServer();
    if (listenDenied) return;

    const payload = { q: 'match me', limit: 5 };
    const res = await request(port, 'POST', '/db/read/find', JSON.stringify(payload), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(200);
    expect(repoMock.readFind).toHaveBeenCalledWith(payload);
    expect(JSON.parse(res.body)).toEqual([{ entry_id: 2, title: 'match' }]);
  });

  test('POST /db/read/pull forwards pull payload', async () => {
    await startServer();
    if (listenDenied) return;

    const payload = { entry_id: 4, longN: 500 };
    const res = await request(port, 'POST', '/db/read/pull', JSON.stringify(payload), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(200);
    expect(repoMock.readPull).toHaveBeenCalledWith(payload);
    expect(JSON.parse(res.body)).toEqual([{ entry_id: 4, excerpt: 'detail' }]);
  });

  test('POST /db/read/entities forwards entity browser payload', async () => {
    await startServer();
    if (listenDenied) return;

    const payload = {
      page: 1,
      page_size: 25,
      filters: {
        content_type: 'newsletter',
        status: 'pending',
      },
    };
    const res = await request(port, 'POST', '/db/read/entities', JSON.stringify(payload), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(200);
    expect(repoMock.readEntities).toHaveBeenCalledWith(payload);
    expect(JSON.parse(res.body)).toEqual([{ is_meta: true, cmd: 'entities' }, { entry_id: 6 }]);
  });

  test('POST /db/test-mode/toggle returns next test mode state', async () => {
    await startServer();
    if (listenDenied) return;

    const res = await request(port, 'POST', '/db/test-mode/toggle', JSON.stringify({}), {
      'Content-Type': 'application/json',
    });

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual([{ is_test_mode: true }]);
  });
});
