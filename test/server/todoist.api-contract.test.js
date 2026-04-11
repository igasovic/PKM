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

describe('todoist API contract', () => {
  let server = null;
  let port = null;
  let envBackup;
  let listenDenied = false;
  let todoistRepoMock;

  beforeEach(() => {
    jest.resetModules();
    listenDenied = false;
    envBackup = { ...process.env };
    process.env.PKM_ADMIN_SECRET = 'test-admin-secret';

    todoistRepoMock = {
      syncTodoistSurface: jest.fn(async () => ({
        run_id: 'run-sync-1',
        synced_count: 2,
        inserted_count: 1,
        updated_count: 1,
        closed_count: 0,
        parse_trigger_count: 1,
        parse_failed_count: 0,
        review_needs_count: 0,
        accepted_preserved_count: 0,
        overridden_preserved_count: 0,
        tasks: [{ todoist_task_id: 't1', review_status: 'no_review_needed', parse_triggered: true }],
      })),
      getReviewQueue: jest.fn(async () => ({
        view: 'needs_review',
        limit: 25,
        offset: 0,
        rows: [
          {
            todoist_task_id: 't2',
            raw_title: 'follow up with vendor',
            review_status: 'needs_review',
          },
        ],
        selected: {
          id: 22,
          todoist_task_id: 't2',
          review_status: 'needs_review',
        },
        events: [{ event_type: 'parse_updated' }],
      })),
      acceptReview: jest.fn(async () => ({
        id: 22,
        todoist_task_id: 't2',
        review_status: 'accepted',
      })),
      overrideReview: jest.fn(async () => ({
        id: 22,
        todoist_task_id: 't2',
        normalized_title_en: 'Follow up with vendor',
        task_shape: 'follow_up',
        suggested_next_action: 'Send reminder email',
        review_status: 'overridden',
      })),
      reparseReview: jest.fn(async () => ({
        id: 22,
        todoist_task_id: 't2',
        review_status: 'needs_review',
        events: [{ event_type: 'parse_updated' }],
      })),
      buildDailyBriefSurface: jest.fn(async () => ({
        brief_kind: 'daily_focus',
        generated_at: '2026-04-11T10:00:00.000Z',
        top_3: [{ todoist_task_id: 't1' }],
        overdue_now: [],
        waiting_nudges: [],
        waiting_groups: [],
        quick_win: [],
        summary: { candidate_count: 1, overdue_count: 0, waiting_count: 0 },
        telegram_message: 'Todoist Daily Focus',
      })),
      buildWaitingBriefSurface: jest.fn(async () => ({
        brief_kind: 'waiting_radar',
        generated_at: '2026-04-11T10:00:00.000Z',
        nudges: [{ todoist_task_id: 't1' }],
        groups: [],
        summary: { candidate_count: 1, max_waiting_days: 5 },
        telegram_message: 'Todoist Waiting Radar',
      })),
      buildWeeklyBriefSurface: jest.fn(async () => ({
        brief_kind: 'weekly_pruning',
        generated_at: '2026-04-11T10:00:00.000Z',
        suggestions: [{ todoist_task_id: 't1', recommendation_type: 'defer' }],
        summary: { candidate_count: 1, needs_review_count: 0, waiting_count: 0 },
        telegram_message: 'Todoist Weekly Pruning',
      })),
    };

    jest.doMock('../../src/server/repositories/todoist-repository.js', () => todoistRepoMock);
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

  test('POST /todoist/sync forwards payload and returns sync summary', async () => {
    await startServer();
    if (listenDenied) return;

    const res = await request(port, 'POST', '/todoist/sync', JSON.stringify({
      run_id: 'run-sync-1',
      tasks: [{ id: 't1', content: 'Do thing' }],
    }), {
      'Content-Type': 'application/json',
    });

    expect(res.status).toBe(200);
    expect(todoistRepoMock.syncTodoistSurface).toHaveBeenCalledWith(expect.objectContaining({ run_id: 'run-sync-1' }));
    expect(JSON.parse(res.body)).toEqual(expect.objectContaining({
      synced_count: 2,
      parse_trigger_count: 1,
    }));
  });

  test('GET /todoist/review forwards query options', async () => {
    await startServer();
    if (listenDenied) return;

    const res = await request(port, 'GET', '/todoist/review?view=needs_review&limit=25&offset=0&todoist_task_id=t2&events_limit=50');

    expect(res.status).toBe(200);
    expect(todoistRepoMock.getReviewQueue).toHaveBeenCalledWith({
      view: 'needs_review',
      limit: 25,
      offset: 0,
      todoist_task_id: 't2',
      events_limit: 50,
    });
    expect(JSON.parse(res.body)).toEqual(expect.objectContaining({
      rows: expect.any(Array),
      selected: expect.any(Object),
      events: expect.any(Array),
    }));
  });

  test('POST /todoist/review/accept returns 404 when target is missing', async () => {
    todoistRepoMock.acceptReview.mockResolvedValueOnce(null);
    await startServer();
    if (listenDenied) return;

    const res = await request(port, 'POST', '/todoist/review/accept', JSON.stringify({ todoist_task_id: 'missing' }), {
      'Content-Type': 'application/json',
    });

    expect(res.status).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'not_found', message: 'todoist task not found' });
  });

  test('POST /todoist/review/override forwards manual parsed fields', async () => {
    await startServer();
    if (listenDenied) return;

    const body = {
      todoist_task_id: 't2',
      normalized_title_en: 'Follow up with vendor',
      task_shape: 'follow_up',
      suggested_next_action: 'Send reminder email',
    };

    const res = await request(port, 'POST', '/todoist/review/override', JSON.stringify(body), {
      'Content-Type': 'application/json',
    });

    expect(res.status).toBe(200);
    expect(todoistRepoMock.overrideReview).toHaveBeenCalledWith(expect.objectContaining(body));
    expect(JSON.parse(res.body)).toEqual(expect.objectContaining({ review_status: 'overridden' }));
  });

  test('POST /todoist/review/reparse returns task payload plus events', async () => {
    await startServer();
    if (listenDenied) return;

    const res = await request(port, 'POST', '/todoist/review/reparse', JSON.stringify({ todoist_task_id: 't2' }), {
      'Content-Type': 'application/json',
    });

    expect(res.status).toBe(200);
    expect(todoistRepoMock.reparseReview).toHaveBeenCalledWith(expect.objectContaining({ todoist_task_id: 't2' }));
    expect(JSON.parse(res.body)).toEqual(expect.objectContaining({
      review_status: 'needs_review',
      events: expect.any(Array),
    }));
  });

  test('brief endpoints return telegram-ready payloads', async () => {
    await startServer();
    if (listenDenied) return;

    const daily = await request(port, 'POST', '/todoist/brief/daily', JSON.stringify({ run_id: 'r1' }), {
      'Content-Type': 'application/json',
    });
    const waiting = await request(port, 'POST', '/todoist/brief/waiting', JSON.stringify({ run_id: 'r2' }), {
      'Content-Type': 'application/json',
    });
    const weekly = await request(port, 'POST', '/todoist/brief/weekly', JSON.stringify({ run_id: 'r3' }), {
      'Content-Type': 'application/json',
    });

    expect(daily.status).toBe(200);
    expect(waiting.status).toBe(200);
    expect(weekly.status).toBe(200);

    expect(JSON.parse(daily.body)).toEqual(expect.objectContaining({ brief_kind: 'daily_focus', telegram_message: expect.any(String) }));
    expect(JSON.parse(waiting.body)).toEqual(expect.objectContaining({ brief_kind: 'waiting_radar', telegram_message: expect.any(String) }));
    expect(JSON.parse(weekly.body)).toEqual(expect.objectContaining({ brief_kind: 'weekly_pruning', telegram_message: expect.any(String) }));
  });
});
