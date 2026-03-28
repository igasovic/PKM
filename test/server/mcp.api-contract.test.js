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

describe('chatgpt action API contract', () => {
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

  async function startServerWithMocks(dbOverrides) {
    const baseDbMock = {
      readLast: async () => ({ rows: [] }),
      readFind: async () => ({ rows: [] }),
      readContinue: async () => ({ rows: [] }),
      readPull: async () => ({ rows: [] }),
      readWorkingMemory: async () => ({ rows: [] }),
      insert: async () => ({ rows: [], rowCount: 0 }),
    };
    const dbMock = { ...baseDbMock, ...(dbOverrides || {}) };
    jest.doMock('../../src/server/db.js', () => dbMock);

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
        return { dbMock };
      }
      throw err;
    }
    return { dbMock };
  }

  test('POST /mcp returns legacy disabled response', async () => {
    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/mcp',
      JSON.stringify({ action: 'tools/list' }),
      {
        'Content-Type': 'application/json',
      },
    );

    expect(res.status).toBe(410);
    expect(JSON.parse(res.body)).toEqual({
      error: 'legacy_disabled',
      message: '/mcp is legacy and disabled for ChatGPT integration; use GPT actions routed through n8n webhooks',
    });
  });

  test('POST /chatgpt/read is removed', async () => {
    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/chatgpt/read',
      JSON.stringify({ topic: 'parenting' }),
      { 'Content-Type': 'application/json' },
    );

    expect(res.status).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'not_found' });
  });

  test('POST /chatgpt/working_memory requires admin secret', async () => {
    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/chatgpt/working_memory',
      JSON.stringify({ topic: 'parenting' }),
      { 'Content-Type': 'application/json' },
    );

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toEqual({
      error: 'forbidden',
      message: 'forbidden',
    });
  });

  test('POST /chatgpt/working_memory returns no_result on topic miss', async () => {
    const readWorkingMemory = jest.fn(async () => ({ rows: [] }));
    await startServerWithMocks({ readWorkingMemory });
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/chatgpt/working_memory',
      JSON.stringify({
        topic: 'Parenting overload',
      }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      },
    );

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.action).toBe('chatgpt_read');
    expect(parsed.method).toBe('pull_working_memory');
    expect(parsed.outcome).toBe('no_result');
    expect(parsed.result.meta.method).toBe('pull_working_memory');
    expect(parsed.result.meta.found).toBe(false);
    expect(parsed.result.row).toBeNull();
    expect(readWorkingMemory).toHaveBeenCalledWith({ topic_key: 'parenting-overload' });
  });

  test('POST /chatgpt/working_memory treats found=false synthetic row as no_result', async () => {
    const readWorkingMemory = jest.fn(async () => ({
      rows: [{
        found: false,
        entry_id: null,
        title: '',
        topic_primary: '',
        capture_text: '',
        clean_text: '',
      }],
    }));
    await startServerWithMocks({ readWorkingMemory });
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/chatgpt/working_memory',
      JSON.stringify({
        topic: 'Parenting overload',
      }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      },
    );

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.action).toBe('chatgpt_read');
    expect(parsed.method).toBe('pull_working_memory');
    expect(parsed.outcome).toBe('no_result');
    expect(parsed.result.meta.found).toBe(false);
    expect(parsed.result.row).toEqual(expect.objectContaining({ found: false }));
    expect(readWorkingMemory).toHaveBeenCalledWith({ topic_key: 'parenting-overload' });
  });

  test('POST /chatgpt/working_memory validates required topic', async () => {
    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/chatgpt/working_memory',
      JSON.stringify({}),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      },
    );

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'bad_request',
      message: 'topic is required for pull_working_memory',
      error_code: 'missing_topic',
      field: 'topic',
    });
  });

  test('POST /chatgpt/wrap-commit validates required session_id', async () => {
    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/chatgpt/wrap-commit',
      JSON.stringify({
        resolved_topic_primary: 'parenting',
      }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      },
    );

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'bad_request',
      message: 'session_id is required',
      error_code: 'missing_session_id',
      field: 'session_id',
    });
  });

  test('POST /chatgpt/wrap-commit writes session note and working memory in one call', async () => {
    const insertCalls = [];
    const insert = jest.fn(async (payload) => {
      insertCalls.push(payload);
      const input = payload && payload.input ? payload.input : {};
      if (input.content_type === 'note') {
        return {
          rowCount: 1,
          rows: [{
            entry_id: 101,
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            created_at: '2026-03-24T01:00:00.000Z',
            source: 'chatgpt',
            intent: 'thought',
            content_type: 'note',
            title: input.title,
            topic_primary: input.topic_primary,
            topic_secondary: input.topic_secondary,
            topic_secondary_confidence: input.topic_secondary_confidence,
            action: 'inserted',
          }],
        };
      }
      return {
        rowCount: 1,
        rows: [{
          entry_id: 102,
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          created_at: '2026-03-24T01:00:00.000Z',
          source: 'chatgpt',
          intent: 'thought',
          content_type: 'working_memory',
          title: input.title,
          topic_primary: input.topic_primary,
          topic_secondary: input.topic_secondary,
          topic_secondary_confidence: input.topic_secondary_confidence,
          action: 'updated',
        }],
      };
    });
    await startServerWithMocks({ insert });
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/chatgpt/wrap-commit',
      JSON.stringify({
        session_id: 'sess-123',
        resolved_topic_primary: 'parenting',
        resolved_topic_secondary: 'overload management',
        topic_secondary_confidence: 0.92,
        chat_title: 'Parenting reset',
        session_summary: 'We aligned on evening routines and limits.',
        context_used: ['Entry 90'],
        key_insights: ['Consistency beats intensity.'],
        decisions: ['Use one bedtime sequence.'],
        tensions: ['Travel disrupts schedule.'],
        open_questions: ['How strict should weekends be?'],
        next_steps: ['Try for 2 weeks'],
        working_memory_updates: ['Evening routine is anchor habit.'],
        why_it_matters: ['Reduces decision fatigue.'],
        gist: 'Parenting routine reset plan.',
        source_entry_refs: [90, 85],
      }),
      {
        'Content-Type': 'application/json',
        'x-pkm-admin-secret': 'test-admin-secret',
      },
    );

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.action).toBe('chatgpt_wrap_commit');
    expect(parsed.outcome).toBe('success');
    expect(parsed.result.session_note.action).toBe('inserted');
    expect(parsed.result.working_memory.action).toBe('updated');
    expect(parsed.result.session_note.idempotency_key_primary).toBe('chatgpt:sess-123');
    expect(parsed.result.working_memory.idempotency_key_primary).toBe('wm:parenting');

    expect(insert).toHaveBeenCalledTimes(2);
    expect(insertCalls[0].input.content_type).toBe('note');
    expect(insertCalls[0].input.idempotency_policy_key).toBe('chatgpt_session_note_v1');
    expect(insertCalls[0].input.enrichment_status).toBe('completed');
    expect(insertCalls[0].input.distill_status).toBe('completed');
    expect(insertCalls[1].input.content_type).toBe('working_memory');
    expect(insertCalls[1].input.idempotency_policy_key).toBe('chatgpt_working_memory_v1');
    expect(insertCalls[1].input.enrichment_status).toBe('completed');
    expect(insertCalls[1].input.distill_status).toBe('completed');
  });
});
