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
  const normalizeWithTraceMock = jest.fn();
  const calendarRepoMock = {
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
    normalizeWithTraceMock.mockReset();
    Object.values(calendarRepoMock).forEach((fn) => fn.mockReset());
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
      normalizeCalendarRequestWithTrace: normalizeWithTraceMock,
    }));

    jest.doMock('../../src/server/repositories/calendar-repository.js', () => ({ ...calendarRepoMock }));

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
    calendarRepoMock.upsertCalendarRequest.mockResolvedValue({
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

  test('POST /telegram/route routes continuation to calendar_create after structured checks', async () => {
    routeMock.mockReturnValue({
      route: 'pkm_capture',
      confidence: 0.62,
    });
    calendarRepoMock.getLatestOpenCalendarRequestByChat.mockResolvedValue({
      request_id: '5c8ceaa0-0f5f-4ec2-badf-3d663ae8c940',
      status: 'needs_clarification',
    });

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/telegram/route',
      JSON.stringify({
        text: 'at 3:00p tomorrow',
        actor_code: 'igor',
        source: { chat_id: '1509032341', message_id: '779' },
      }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      }
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      route: 'calendar_create',
      confidence: 0.99,
      clarification_question: null,
      request_id: '5c8ceaa0-0f5f-4ec2-badf-3d663ae8c940',
    });
    expect(calendarRepoMock.upsertCalendarRequest).not.toHaveBeenCalled();
    expect(calendarRepoMock.getLatestOpenCalendarRequestByChat).toHaveBeenCalledWith('1509032341');
  });

  test('POST /telegram/route does not override explicit pkm prefix with continuation route', async () => {
    routeMock.mockReturnValue({
      route: 'pkm_capture',
      confidence: 1,
    });
    calendarRepoMock.getLatestOpenCalendarRequestByChat.mockResolvedValue({
      request_id: '33f3e37b-f4a4-4437-a6e8-67ce7f2c227f',
      status: 'needs_clarification',
    });

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/telegram/route',
      JSON.stringify({
        text: 'pkm: private note',
        actor_code: 'igor',
        source: { chat_id: '1509032341', message_id: '780' },
      }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      }
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      route: 'pkm_capture',
      confidence: 1,
      request_id: null,
    });
    expect(calendarRepoMock.getLatestOpenCalendarRequestByChat).toHaveBeenCalledWith('1509032341');
  });

  test('POST /telegram/route reuses open request for explicit cal prefix to avoid unique-chat conflicts', async () => {
    routeMock.mockReturnValue({
      route: 'calendar_create',
      confidence: 1,
    });
    calendarRepoMock.getLatestOpenCalendarRequestByChat.mockResolvedValue({
      request_id: 'cal-open-123',
      status: 'needs_clarification',
    });

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/telegram/route',
      JSON.stringify({
        text: 'cal:tomorrow',
        actor_code: 'igor',
        source: { chat_id: '1509032341', message_id: '900' },
      }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      }
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      route: 'calendar_create',
      confidence: 1,
      request_id: 'cal-open-123',
    });
    expect(calendarRepoMock.getLatestOpenCalendarRequestByChat).toHaveBeenCalledWith('1509032341');
    expect(calendarRepoMock.upsertCalendarRequest).not.toHaveBeenCalled();
  });

  test('POST /telegram/route downgrades PKM route for calendar-only sender when allowlist is enforced', async () => {
    process.env.CALENDAR_TELEGRAM_ENFORCE_ALLOWLIST = 'true';
    process.env.CALENDAR_TELEGRAM_ALLOWED_USER_IDS = '111,222';
    process.env.CALENDAR_TELEGRAM_PKM_ALLOWED_USER_IDS = '111';
    routeMock.mockReturnValue({
      route: 'pkm_capture',
      confidence: 0.99,
    });

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/telegram/route',
      JSON.stringify({
        text: 'pkm: private note',
        actor_code: 'danijela',
        source: { chat_id: '1509032341', message_id: '778', user_id: '222' },
      }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      }
    );

    expect(res.status).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.route).toBe('ambiguous');
    expect(payload.clarification_question).toContain('calendar-only access');
  });

  test('POST /calendar/normalize uses explicit request_id for continuation and propagates run id header', async () => {
    calendarRepoMock.getCalendarRequestById.mockResolvedValue({
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
    calendarRepoMock.updateCalendarRequestById.mockResolvedValue({
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
        request_id: 'f12556d4-c454-4885-a89c-d61dc28db3fd',
        source: { chat_id: '1509032341', message_id: '999' },
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
    expect(calendarRepoMock.getLatestOpenCalendarRequestByChat).not.toHaveBeenCalled();
  });

  test('POST /calendar/normalize optionally returns normalize trace metadata', async () => {
    calendarRepoMock.upsertCalendarRequest.mockResolvedValue({
      request_id: '627ff0cd-3461-4b93-a6c8-5eb66e5f30a8',
      status: 'received',
      raw_text: 'Mila dentist tomorrow at 3:00p',
      clarification_turns: [],
    });
    normalizeWithTraceMock.mockResolvedValue({
      result: {
        status: 'ready_to_create',
        missing_fields: [],
        clarification_question: null,
        normalized_event: {
          title: 'Mila dentist',
        },
        warning_codes: [],
        message: null,
      },
      trace: {
        llm_used: false,
        llm_reason: 'litellm_not_configured',
        parse_status: 'skipped',
        status: 'ready_to_create',
      },
    });
    calendarRepoMock.updateCalendarRequestById.mockResolvedValue({
      request_id: '627ff0cd-3461-4b93-a6c8-5eb66e5f30a8',
      status: 'normalized',
    });

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/calendar/normalize',
      JSON.stringify({
        raw_text: 'Mila dentist tomorrow at 3:00p',
        actor_code: 'igor',
        include_trace: true,
        source: { chat_id: '1509032341', message_id: '901' },
      }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      }
    );

    expect(res.status).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.status).toBe('ready_to_create');
    expect(payload.normalize_trace).toEqual({
      llm_used: false,
      llm_reason: 'litellm_not_configured',
      parse_status: 'skipped',
      status: 'ready_to_create',
    });
    expect(normalizeWithTraceMock).toHaveBeenCalled();
  });

  test('POST /calendar/normalize creates a new request when request_id is omitted', async () => {
    calendarRepoMock.upsertCalendarRequest.mockResolvedValue({
      request_id: 'b11c6085-8949-45ef-8e03-11c35a1eac62',
      status: 'received',
      raw_text: 'Mila dentist tomorrow at 3:00p',
      clarification_turns: [],
    });
    normalizeMock.mockReturnValue({
      status: 'needs_clarification',
      missing_fields: ['duration'],
      clarification_question: 'How long should I schedule it for?',
      normalized_event: null,
      warning_codes: [],
      message: null,
    });
    calendarRepoMock.updateCalendarRequestById.mockResolvedValue({
      request_id: 'b11c6085-8949-45ef-8e03-11c35a1eac62',
      status: 'needs_clarification',
    });

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/calendar/normalize',
      JSON.stringify({
        raw_text: 'Mila dentist tomorrow at 3:00p',
        actor_code: 'igor',
        source: { chat_id: '1509032341', message_id: '902' },
      }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      }
    );

    expect(res.status).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.request_id).toBe('b11c6085-8949-45ef-8e03-11c35a1eac62');
    expect(payload.status).toBe('needs_clarification');
    expect(calendarRepoMock.getLatestOpenCalendarRequestByChat).not.toHaveBeenCalled();
    expect(calendarRepoMock.upsertCalendarRequest).toHaveBeenCalled();
  });

  test('POST /calendar/normalize rejects sender not in calendar allowlist', async () => {
    process.env.CALENDAR_TELEGRAM_ENFORCE_ALLOWLIST = 'true';
    process.env.CALENDAR_TELEGRAM_ALLOWED_USER_IDS = '111';
    process.env.CALENDAR_TELEGRAM_PKM_ALLOWED_USER_IDS = '111';

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/calendar/normalize',
      JSON.stringify({
        run_id: 'calendar-run-unauthorized',
        raw_text: 'Mila dentist tomorrow at 3:00p',
        source: { chat_id: '1509032341', message_id: '999', user_id: '222' },
      }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      }
    );

    expect(res.status).toBe(200);
    expect(normalizeMock).not.toHaveBeenCalled();
    expect(JSON.parse(res.body)).toEqual({
      request_id: null,
      status: 'rejected',
      missing_fields: [],
      clarification_question: null,
      normalized_event: null,
      warning_codes: ['telegram_user_not_calendar_allowed'],
      message: 'This Telegram user is not allowed to use the family calendar flow.',
      request_status: null,
    });
  });

  test('POST /calendar/normalize returns reason_code for deterministic rejected normalize result', async () => {
    calendarRepoMock.upsertCalendarRequest.mockResolvedValue({
      request_id: '5f78c523-eed7-46fa-bad6-a3fce753b95e',
      status: 'received',
      raw_text: 'all-day Mila doctor appointment tomorrow',
      clarification_turns: [],
    });
    normalizeMock.mockReturnValue({
      status: 'rejected',
      reason_code: 'all_day_not_supported',
      missing_fields: [],
      clarification_question: null,
      normalized_event: null,
      warning_codes: [],
      message: 'All-day event creation is not supported in v1. Please provide a start time and duration.',
    });
    calendarRepoMock.updateCalendarRequestById.mockResolvedValue({
      request_id: '5f78c523-eed7-46fa-bad6-a3fce753b95e',
      status: 'ignored',
    });

    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/calendar/normalize',
      JSON.stringify({
        raw_text: 'all-day Mila doctor appointment tomorrow',
        actor_code: 'igor',
        source: { chat_id: '1509032341', message_id: '903' },
      }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      }
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      request_id: '5f78c523-eed7-46fa-bad6-a3fce753b95e',
      status: 'rejected',
      reason_code: 'all_day_not_supported',
      missing_fields: [],
      clarification_question: null,
      normalized_event: null,
      warning_codes: [],
      message: 'All-day event creation is not supported in v1. Please provide a start time and duration.',
      request_status: 'ignored',
    });
  });

  test('POST /calendar/normalize returns rejected payload for malformed request instead of HTTP 400', async () => {
    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/calendar/normalize',
      JSON.stringify({
        raw_text: 'Mila dentist tomorrow at 3:00p',
        actor_code: 'igor',
      }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      }
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      request_id: null,
      status: 'rejected',
      missing_fields: [],
      clarification_question: null,
      normalized_event: null,
      warning_codes: ['normalize_bad_request'],
      message: 'telegram source chat_id and message_id are required for new calendar requests',
      request_status: null,
    });
  });

  test('POST /calendar/finalize maps success to calendar_created', async () => {
    calendarRepoMock.finalizeCalendarRequestById.mockResolvedValue({
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
    calendarRepoMock.insertCalendarObservations.mockResolvedValue({
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
