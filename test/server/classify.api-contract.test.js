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

describe('classify and ingest API contract', () => {
  let server = null;
  let port = null;
  let envBackup;
  let listenDenied = false;

  const telegramNormalizeMock = jest.fn();
  const emailNormalizeMock = jest.fn();
  const webpageNormalizeMock = jest.fn();
  const notionNormalizeMock = jest.fn();
  const classifyMock = jest.fn();
  const classifyPkmMock = jest.fn();
  const classifyUpdateMock = jest.fn();
  const classifyUpdateBatchMock = jest.fn();
  const classifyBatchMock = jest.fn();
  const classifyRunMock = jest.fn();
  const classifyBatchStatusListMock = jest.fn();
  const classifyBatchStatusMock = jest.fn();
  const emailIntentMock = jest.fn();
  const mboxImportMock = jest.fn();
  const telegramUrlBatchIngestMock = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    listenDenied = false;
    envBackup = { ...process.env };
    telegramNormalizeMock.mockReset();
    emailNormalizeMock.mockReset();
    webpageNormalizeMock.mockReset();
    notionNormalizeMock.mockReset();
    classifyMock.mockReset();
    classifyPkmMock.mockReset();
    classifyUpdateMock.mockReset();
    classifyUpdateBatchMock.mockReset();
    classifyBatchMock.mockReset();
    classifyRunMock.mockReset();
    classifyBatchStatusListMock.mockReset();
    classifyBatchStatusMock.mockReset();
    emailIntentMock.mockReset();
    mboxImportMock.mockReset();
    telegramUrlBatchIngestMock.mockReset();
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
    jest.doMock('../../src/server/ingestion-pipeline.js', () => ({
      runTelegramIngestionPipeline: telegramNormalizeMock,
      runEmailIngestionPipeline: emailNormalizeMock,
      runWebpageIngestionPipeline: webpageNormalizeMock,
      runNotionIngestionPipeline: notionNormalizeMock,
    }));
    jest.doMock('../../src/server/normalization.js', () => ({
      decideEmailIntent: emailIntentMock,
    }));
    jest.doMock('../../src/server/tier1-enrichment.js', () => ({
      enrichTier1: classifyMock,
      classifyPkmEntry: classifyPkmMock,
      enrichTier1AndPersist: classifyUpdateMock,
      enrichTier1AndPersistBatch: classifyUpdateBatchMock,
      enqueueTier1Batch: classifyBatchMock,
      runTier1ClassifyRun: classifyRunMock,
      getTier1BatchStatusList: classifyBatchStatusListMock,
      getTier1BatchStatus: classifyBatchStatusMock,
      startTier1BatchWorker: () => {},
      stopTier1BatchWorker: () => {},
    }));
    jest.doMock('../../src/server/email-importer.js', () => ({
      importEmailMbox: mboxImportMock,
    }));
    jest.doMock('../../src/server/telegram-url-batch-ingest.js', () => ({
      ingestTelegramUrlBatch: telegramUrlBatchIngestMock,
    }));
    jest.doMock('../../src/server/tier2-enrichment.js', () => ({
      getTier2BatchStatusList: async () => ({ summary: {}, jobs: [] }),
      getTier2BatchStatus: async () => null,
      startTier2BatchWorker: () => {},
      stopTier2BatchWorker: () => {},
      runTier2BatchWorkerCycle: jest.fn(),
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

  test('POST /normalize/telegram forwards text and source to ingestion pipeline', async () => {
    telegramNormalizeMock.mockResolvedValue({ source: 'telegram', clean_text: 'hello' });
    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/normalize/telegram',
      JSON.stringify({ text: 'hello', source: { chat_id: '1', message_id: '2' } }),
      { 'Content-Type': 'application/json' },
    );

    expect(res.status).toBe(200);
    expect(telegramNormalizeMock).toHaveBeenCalledWith({
      text: 'hello',
      source: { chat_id: '1', message_id: '2' },
    });
    expect(JSON.parse(res.body)).toEqual({ source: 'telegram', clean_text: 'hello' });
  });

  test('POST /normalize/email/intent returns content_type from email intent helper', async () => {
    emailIntentMock.mockResolvedValue({ content_type: 'newsletter' });
    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/normalize/email/intent',
      JSON.stringify({ textPlain: 'hello world' }),
      { 'Content-Type': 'application/json' },
    );

    expect(res.status).toBe(200);
    expect(emailIntentMock).toHaveBeenCalledWith('hello world');
    expect(JSON.parse(res.body)).toEqual({ content_type: 'newsletter' });
  });

  test('POST /ingest/telegram/url-batch forwards payload to telegram url batch ingest service', async () => {
    telegramUrlBatchIngestMock.mockResolvedValue({
      mode: 'url_list',
      url_count: 2,
      inserted_count: 2,
      updated_count: 0,
      skipped_count: 0,
      failed_count: 0,
      results: [],
    });
    await startServerWithMocks();
    if (listenDenied) return;

    const body = {
      text: 'https://a.com, https://b.com',
      source: { chat_id: '1', message_id: '2', user_id: '3' },
      continue_on_error: true,
      smoke_mode: true,
      test_run_id: 'smoke-1',
    };
    const res = await request(port, 'POST', '/ingest/telegram/url-batch', JSON.stringify(body), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(200);
    expect(telegramUrlBatchIngestMock).toHaveBeenCalledWith(body);
    expect(JSON.parse(res.body)).toEqual({
      mode: 'url_list',
      url_count: 2,
      inserted_count: 2,
      updated_count: 0,
      skipped_count: 0,
      failed_count: 0,
      results: [],
    });
  });

  test('POST /normalize/email forwards canonical email fields', async () => {
    emailNormalizeMock.mockResolvedValue({ source: 'email', content_type: 'newsletter' });
    await startServerWithMocks();
    if (listenDenied) return;

    const body = {
      raw_text: 'raw',
      from: 'sender@example.com',
      subject: 'subject',
      date: '2026-03-30T10:00:00Z',
      message_id: '<m@x>',
      source: { message_id: '<m@x>' },
    };
    const res = await request(port, 'POST', '/normalize/email', JSON.stringify(body), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(200);
    expect(emailNormalizeMock).toHaveBeenCalledWith(body);
    expect(JSON.parse(res.body)).toEqual({ source: 'email', content_type: 'newsletter' });
  });

  test('POST /normalize/webpage forwards normalization payload', async () => {
    webpageNormalizeMock.mockResolvedValue({ clean_text: 'clean', quality_score: 0.8 });
    await startServerWithMocks();
    if (listenDenied) return;

    const body = {
      capture_text: 'raw text',
      url: 'https://example.com',
      excerpt: 'preview',
      source: { system: 'telegram', chat_id: '1', message_id: '2' },
    };
    const res = await request(port, 'POST', '/normalize/webpage', JSON.stringify(body), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(200);
    expect(webpageNormalizeMock).toHaveBeenCalledWith({
      text: undefined,
      extracted_text: undefined,
      clean_text: undefined,
      capture_text: 'raw text',
      content_type: undefined,
      url: 'https://example.com',
      url_canonical: undefined,
      excerpt: 'preview',
      source: { system: 'telegram', chat_id: '1', message_id: '2' },
    });
    expect(JSON.parse(res.body)).toEqual({ clean_text: 'clean', quality_score: 0.8 });
  });

  test('POST /normalize/notion forwards page payload', async () => {
    notionNormalizeMock.mockResolvedValue({ source: 'notion', title: 'Title' });
    await startServerWithMocks();
    if (listenDenied) return;

    const body = {
      id: 'page-1',
      updated_at: '2026-03-30T10:00:00Z',
      title: 'Title',
      url: 'https://notion.so/x',
      capture_text: 'body',
    };
    const res = await request(port, 'POST', '/normalize/notion', JSON.stringify(body), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(200);
    expect(notionNormalizeMock).toHaveBeenCalledWith({
      id: 'page-1',
      updated_at: '2026-03-30T10:00:00Z',
      created_at: undefined,
      content_type: undefined,
      title: 'Title',
      url: 'https://notion.so/x',
      capture_text: 'body',
    });
    expect(JSON.parse(res.body)).toEqual({ source: 'notion', title: 'Title' });
  });

  test('POST /enrich/t1 forwards classify payload', async () => {
    classifyMock.mockResolvedValue({ topic_primary: 'engineering' });
    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'POST',
      '/enrich/t1',
      JSON.stringify({ title: 'A', author: 'B', clean_text: 'C' }),
      { 'Content-Type': 'application/json' },
    );

    expect(res.status).toBe(200);
    expect(classifyMock).toHaveBeenCalledWith({ title: 'A', author: 'B', clean_text: 'C' });
    expect(JSON.parse(res.body)).toEqual({ topic_primary: 'engineering' });
  });

  test('POST /enrich/t1/batch forwards items and options', async () => {
    classifyBatchMock.mockResolvedValue({ batch_id: 'batch-1' });
    await startServerWithMocks();
    if (listenDenied) return;

    const body = {
      items: [{ clean_text: 'one' }],
      metadata: { source: 'n8n' },
      completion_window: '12h',
    };
    const res = await request(port, 'POST', '/enrich/t1/batch', JSON.stringify(body), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(200);
    expect(classifyBatchMock).toHaveBeenCalledWith([{ clean_text: 'one' }], {
      metadata: { source: 'n8n' },
      completion_window: '12h',
    });
    expect(JSON.parse(res.body)).toEqual({ batch_id: 'batch-1' });
  });

  test('POST /enrich/t1/run forwards classify run payload', async () => {
    classifyRunMock.mockResolvedValue({
      mode: 'dry_run',
      execution_mode: 'sync',
      candidate_count: 7,
      runnable_count: 6,
      will_process_count: 6,
    });
    await startServerWithMocks();
    if (listenDenied) return;

    const body = {
      execution_mode: 'sync',
      dry_run: true,
      limit: 10,
    };
    const res = await request(port, 'POST', '/enrich/t1/run', JSON.stringify(body), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(200);
    expect(classifyRunMock).toHaveBeenCalledWith(body);
    expect(JSON.parse(res.body)).toEqual({
      mode: 'dry_run',
      execution_mode: 'sync',
      candidate_count: 7,
      runnable_count: 6,
      will_process_count: 6,
    });
  });

  test('POST /enrich/t1/run rejects empty payload', async () => {
    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(port, 'POST', '/enrich/t1/run', JSON.stringify({}), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(400);
    expect(classifyRunMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toBe('bad_request');
    expect(String(parsed.message || '')).toContain('requires at least one parameter');
  });

  test('POST /pkm/classify/batch forwards classify run payload', async () => {
    classifyRunMock.mockResolvedValue({
      mode: 'dry_run',
      execution_mode: 'sync',
      candidate_count: 7,
      runnable_count: 6,
      will_process_count: 6,
    });
    await startServerWithMocks();
    if (listenDenied) return;

    const body = {
      execution_mode: 'sync',
      dry_run: true,
      limit: 10,
    };
    const res = await request(port, 'POST', '/pkm/classify/batch', JSON.stringify(body), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(200);
    expect(classifyRunMock).toHaveBeenCalledWith(body);
    expect(JSON.parse(res.body)).toEqual({
      mode: 'dry_run',
      execution_mode: 'sync',
      candidate_count: 7,
      runnable_count: 6,
      will_process_count: 6,
    });
  });

  test('POST /pkm/classify/batch rejects empty payload', async () => {
    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(port, 'POST', '/pkm/classify/batch', JSON.stringify({}), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(400);
    expect(classifyRunMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toBe('bad_request');
    expect(String(parsed.message || '')).toContain('requires at least one parameter');
  });

  test('POST /enrich/t1/update forwards explicit classify update payload', async () => {
    classifyUpdateMock.mockResolvedValue({
      schema: 'pkm',
      row: { entry_id: 42, topic_primary: 'parenting', topic_is_active: true, action: 'updated' },
      topic_link: { linked: true, topic_key: 'parenting' },
    });
    await startServerWithMocks();
    if (listenDenied) return;

    const body = {
      entry_id: 42,
      title: 'A',
      author: 'B',
      clean_text: 'C',
    };
    const res = await request(port, 'POST', '/enrich/t1/update', JSON.stringify(body), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(200);
    expect(classifyUpdateMock).toHaveBeenCalledWith(body);
    expect(JSON.parse(res.body)).toEqual({
      schema: 'pkm',
      row: { entry_id: 42, topic_primary: 'parenting', topic_is_active: true, action: 'updated' },
      topic_link: { linked: true, topic_key: 'parenting' },
    });
  });

  test('POST /pkm/classify forwards classify update payload and returns enriched row shape', async () => {
    classifyPkmMock.mockResolvedValue({
      entry_id: 42,
      id: '00000000-0000-0000-0000-000000000042',
      created_at: '2026-04-19T10:00:00.000Z',
      source: 'email',
      intent: 'archive',
      content_type: 'newsletter',
      url_canonical: null,
      title: 'A',
      author: 'B',
      clean_text: 'C',
      clean_word_count: 1,
      boilerplate_heavy: false,
      low_signal: false,
      quality_score: 0.7,
      topic_primary: 'parenting',
      topic_primary_confidence: 0.8,
      topic_secondary: 'bedtime',
      topic_secondary_confidence: 0.6,
      gist: 'one sentence',
      distill_summary: null,
      distill_excerpt: null,
      distill_version: null,
      distill_created_from_hash: null,
      distill_why_it_matters: null,
      distill_stance: null,
      distill_status: null,
      distill_metadata: null,
      topic_is_active: true,
    });
    await startServerWithMocks();
    if (listenDenied) return;

    const body = {
      entry_id: 42,
      title: 'A',
      author: 'B',
      clean_text: 'C',
    };
    const res = await request(port, 'POST', '/pkm/classify', JSON.stringify(body), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(200);
    expect(classifyPkmMock).toHaveBeenCalledWith({
      entry_id: 42,
      title: 'A',
      author: 'B',
      clean_text: 'C',
      schema: null,
    });
    expect(JSON.parse(res.body)).toEqual([{
      entry_id: 42,
      id: '00000000-0000-0000-0000-000000000042',
      created_at: '2026-04-19T10:00:00.000Z',
      source: 'email',
      intent: 'archive',
      content_type: 'newsletter',
      url_canonical: null,
      title: 'A',
      author: 'B',
      clean_text: 'C',
      clean_word_count: 1,
      boilerplate_heavy: false,
      low_signal: false,
      quality_score: 0.7,
      topic_primary: 'parenting',
      topic_primary_confidence: 0.8,
      topic_secondary: 'bedtime',
      topic_secondary_confidence: 0.6,
      gist: 'one sentence',
      distill_summary: null,
      distill_excerpt: null,
      distill_version: null,
      distill_created_from_hash: null,
      distill_why_it_matters: null,
      distill_stance: null,
      distill_status: null,
      distill_metadata: null,
      topic_is_active: true,
    }]);
  });

  test('POST /enrich/t1/update-batch forwards explicit classify batch update payload', async () => {
    classifyUpdateBatchMock.mockResolvedValue({
      rowCount: 1,
      rows: [{ _batch_index: 0, _batch_ok: true, entry_id: 12, topic_is_active: true }],
    });
    await startServerWithMocks();
    if (listenDenied) return;

    const body = {
      items: [{ entry_id: 12, clean_text: 'one' }],
      continue_on_error: true,
    };
    const res = await request(port, 'POST', '/enrich/t1/update-batch', JSON.stringify(body), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(200);
    expect(classifyUpdateBatchMock).toHaveBeenCalledWith(body);
    expect(JSON.parse(res.body)).toEqual({
      rowCount: 1,
      rows: [{ _batch_index: 0, _batch_ok: true, entry_id: 12, topic_is_active: true }],
    });
  });

  test('POST /import/email/mbox forwards backlog import payload', async () => {
    mboxImportMock.mockResolvedValue({ imported: 3, skipped: 1 });
    await startServerWithMocks();
    if (listenDenied) return;

    const body = {
      path: '/tmp/import.mbox',
      batch_size: 25,
      insert_chunk_size: 10,
      max_emails: 100,
      metadata: { initiated_by: 'test' },
    };
    const res = await request(port, 'POST', '/import/email/mbox', JSON.stringify(body), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(200);
    expect(mboxImportMock).toHaveBeenCalledWith({
      mbox_path: '/tmp/import.mbox',
      batch_size: 25,
      insert_chunk_size: 10,
      completion_window: undefined,
      max_emails: 100,
      metadata: { initiated_by: 'test' },
    });
    expect(JSON.parse(res.body)).toEqual({ imported: 3, skipped: 1 });
  });

  test('GET /status/t1/batch forwards legacy classify batch status list params', async () => {
    classifyBatchStatusListMock.mockResolvedValue({ summary: { stage: 't1' }, jobs: [] });
    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'GET',
      '/status/t1/batch?limit=2&include_terminal=false&schema=pkm_test',
    );

    expect(res.status).toBe(200);
    expect(classifyBatchStatusListMock).toHaveBeenCalledWith({
      stage: 't1',
      limit: 2,
      schema: 'pkm_test',
      include_terminal: 'false',
    });
    expect(JSON.parse(res.body)).toEqual({ summary: { stage: 't1' }, jobs: [] });
  });

  test('GET /status/t1/batch/:batch_id forwards legacy classify batch detail params', async () => {
    classifyBatchStatusMock.mockResolvedValue({ batch_id: 't1-batch-1', status: 'queued' });
    await startServerWithMocks();
    if (listenDenied) return;

    const res = await request(
      port,
      'GET',
      '/status/t1/batch/t1-batch-1?include_items=true&items_limit=10&schema=pkm_test',
    );

    expect(res.status).toBe(200);
    expect(classifyBatchStatusMock).toHaveBeenCalledWith({
      stage: 't1',
      batch_id: 't1-batch-1',
      schema: 'pkm_test',
      include_items: 'true',
      items_limit: '10',
    });
    expect(JSON.parse(res.body)).toEqual({ batch_id: 't1-batch-1', status: 'queued' });
  });
});
