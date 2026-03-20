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

describe('db read smoke API contract', () => {
  let server = null;
  let port = null;
  let listenDenied = false;

  const dbMock = {
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    move: jest.fn(),
    readContinue: jest.fn(),
    readFind: jest.fn(),
    readLast: jest.fn(),
    readPull: jest.fn(),
    readSmoke: jest.fn(),
    getRecentPipelineRuns: jest.fn(),
    getPipelineRun: jest.fn(),
    getLastPipelineRun: jest.fn(),
    getTestMode: jest.fn(),
    toggleTestModeState: jest.fn(),
    prunePipelineEvents: jest.fn(),
    markTier2StaleInProd: jest.fn(),
    upsertCalendarRequest: jest.fn(),
    getCalendarRequestById: jest.fn(),
    getLatestOpenCalendarRequestByChat: jest.fn(),
    updateCalendarRequestById: jest.fn(),
    finalizeCalendarRequestById: jest.fn(),
    insertCalendarObservations: jest.fn(),
  };

  beforeEach(() => {
    jest.resetModules();
    listenDenied = false;
    Object.values(dbMock).forEach((fn) => fn.mockReset());
  });

  afterEach(async () => {
    if (server && server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    server = null;
    port = null;
  });

  async function startServerWithMocks() {
    jest.doMock('../../src/server/db.js', () => ({ ...dbMock }));
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

  test('POST /db/read/smoke forwards suite/run_id to db.readSmoke', async () => {
    dbMock.readSmoke.mockResolvedValue({
      rows: [
        { entry_id: 11, id: 'e1' },
        { entry_id: 22, id: 'e2' },
      ],
      rowCount: 2,
    });

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/db/read/smoke',
      JSON.stringify({ suite: 'T00', run_id: 'smoke_20260320_010203' }),
      { 'Content-Type': 'application/json' }
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual([
      { entry_id: 11, id: 'e1' },
      { entry_id: 22, id: 'e2' },
    ]);
    expect(dbMock.readSmoke).toHaveBeenCalledWith({
      suite: 'T00',
      run_id: 'smoke_20260320_010203',
    });
  });

  test('POST /db/read/smoke returns bad_request when suite is missing', async () => {
    dbMock.readSmoke.mockRejectedValue(new Error('read_smoke requires suite'));

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/db/read/smoke',
      JSON.stringify({ run_id: 'smoke_20260320_010203' }),
      { 'Content-Type': 'application/json' }
    );

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'bad_request',
      message: 'read_smoke requires suite',
    });
  });
});
