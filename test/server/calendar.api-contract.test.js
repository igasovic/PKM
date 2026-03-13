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

describe('calendar API contract', () => {
  let server = null;
  let port = null;
  let envBackup;
  let listenDenied = false;

  const routeMock = jest.fn();
  const normalizeMock = jest.fn();
  const dbMock = {
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
    envBackup = { ...process.env };
    process.env.PKM_ADMIN_SECRET = 'test-admin-secret';
    routeMock.mockReset();
    normalizeMock.mockReset();
    Object.values(dbMock).forEach((fn) => fn.mockReset());
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
    jest.doMock('../../src/server/calendar-service.js', () => ({
      routeTelegramInput: routeMock,
      normalizeCalendarRequest: normalizeMock,
    }));

    jest.doMock('../../src/server/db.js', () => ({
      ...dbMock,
      insert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      move: jest.fn(),
      readContinue: jest.fn(),
      readFind: jest.fn(),
      readLast: jest.fn(),
      readPull: jest.fn(),
      getRecentPipelineRuns: jest.fn(),
      getPipelineRun: jest.fn(),
      getLastPipelineRun: jest.fn(),
      getTestMode: jest.fn(),
      toggleTestModeState: jest.fn(),
      prunePipelineEvents: jest.fn(),
      markTier2StaleInProd: jest.fn(),
    }));

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

  test('POST /telegram/route requires admin secret', async () => {
    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/telegram/route',
      JSON.stringify({ text: 'Mila dentist tomorrow 3pm' }),
      { 'Content-Type': 'application/json' }
    );
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'forbidden', message: 'forbidden' });
  });

  test('POST /telegram/route returns route + request_id', async () => {
    routeMock.mockReturnValue({
      route: 'calendar_create',
      confidence: 0.93,
    });
    dbMock.upsertCalendarRequest.mockResolvedValue({
      request_id: '9f678f95-8f9f-4f31-8e53-b97f1d9fafe4',
    });

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/telegram/route',
      JSON.stringify({
        text: 'Mila dentist tomorrow 3pm',
        actor_code: 'igor',
        source: { chat_id: '1509032341', message_id: '777' },
      }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      }
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      route: 'calendar_create',
      confidence: 0.93,
      request_id: '9f678f95-8f9f-4f31-8e53-b97f1d9fafe4',
    });
  });

  test('POST /calendar/normalize uses latest-open request and propagates run id header', async () => {
    dbMock.getCalendarRequestById.mockResolvedValue(null);
    dbMock.getLatestOpenCalendarRequestByChat.mockResolvedValue({
      request_id: 'f12556d4-c454-4885-a89c-d61dc28db3fd',
      status: 'needs_clarification',
      raw_text: 'Mila dentist',
      clarification_turns: [],
    });
    normalizeMock.mockReturnValue({
      status: 'needs_clarification',
      missing_fields: ['start_time'],
      clarification_question: 'I still need the start time.',
      normalized_event: null,
      warning_codes: [],
      message: null,
    });
    dbMock.updateCalendarRequestById.mockResolvedValue({
      request_id: 'f12556d4-c454-4885-a89c-d61dc28db3fd',
      status: 'needs_clarification',
    });

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/calendar/normalize',
      JSON.stringify({
        run_id: 'calendar-run-123',
        raw_text: 'tomorrow 3pm',
        source: { chat_id: '1509032341' },
      }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      }
    );

    expect(res.status).toBe(200);
    expect(res.headers['x-pkm-run-id']).toBe('calendar-run-123');
    expect(JSON.parse(res.body)).toEqual({
      request_id: 'f12556d4-c454-4885-a89c-d61dc28db3fd',
      status: 'needs_clarification',
      missing_fields: ['start_time'],
      clarification_question: 'I still need the start time.',
      normalized_event: null,
      warning_codes: [],
      message: null,
      request_status: 'needs_clarification',
    });
  });

  test('POST /calendar/finalize maps success to calendar_created', async () => {
    dbMock.finalizeCalendarRequestById.mockResolvedValue({
      request_id: '3243fcdd-e81c-4c94-aa79-d8d8f99bb9dd',
      status: 'calendar_created',
      google_calendar_id: 'family@group.calendar.google.com',
      google_event_id: 'abc123',
    });

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/calendar/finalize',
      JSON.stringify({
        request_id: '3243fcdd-e81c-4c94-aa79-d8d8f99bb9dd',
        success: true,
        google_calendar_id: 'family@group.calendar.google.com',
        google_event_id: 'abc123',
      }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      }
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      request_id: '3243fcdd-e81c-4c94-aa79-d8d8f99bb9dd',
      status: 'calendar_created',
      google_calendar_id: 'family@group.calendar.google.com',
      google_event_id: 'abc123',
      finalize_action: 'updated',
    });
  });

  test('POST /calendar/observe inserts observation rows', async () => {
    dbMock.insertCalendarObservations.mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          observation_id: '8f31011e-df9a-4ddf-b597-21eb14502b86',
          run_id: 'run-1',
          google_calendar_id: 'family@group.calendar.google.com',
          google_event_id: 'evt-1',
          observation_kind: 'daily_report_seen',
          source_type: 'external_unknown',
          was_reported: true,
          created_at: '2026-03-12T12:00:00.000Z',
        },
      ],
    });

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/calendar/observe',
      JSON.stringify({
        run_id: 'run-1',
        items: [{
          google_calendar_id: 'family@group.calendar.google.com',
          google_event_id: 'evt-1',
          observation_kind: 'daily_report_seen',
          source_type: 'external_unknown',
          event_snapshot: { title: 'External event' },
          was_reported: true,
        }],
      }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      }
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      inserted: 1,
      rows: [
        {
          observation_id: '8f31011e-df9a-4ddf-b597-21eb14502b86',
          run_id: 'run-1',
          google_calendar_id: 'family@group.calendar.google.com',
          google_event_id: 'evt-1',
          observation_kind: 'daily_report_seen',
          source_type: 'external_unknown',
          was_reported: true,
          created_at: '2026-03-12T12:00:00.000Z',
        },
      ],
    });
  });
});
