'use strict';

describe('telegram url batch ingest service', () => {
  const runTelegramBulkUrlIngestionPipelineMock = jest.fn();
  const insertMock = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    runTelegramBulkUrlIngestionPipelineMock.mockReset();
    insertMock.mockReset();

    jest.doMock('../../src/server/ingestion-pipeline.js', () => ({
      runTelegramBulkUrlIngestionPipeline: runTelegramBulkUrlIngestionPipelineMock,
    }));
    jest.doMock('../../src/server/repositories/read-write-repository.js', () => ({
      insert: insertMock,
    }));
  });

  test('builds summary counts from batch insert results', async () => {
    runTelegramBulkUrlIngestionPipelineMock.mockResolvedValue({
      mode: 'url_list',
      url_count: 3,
      urls: [
        { url: 'https://a.com', url_canonical: 'https://a.com' },
        { url: 'https://b.com', url_canonical: 'https://b.com' },
        { url: 'https://c.com', url_canonical: 'https://c.com' },
      ],
      items: [
        { _bulk_index: 0, url: 'https://a.com', url_canonical: 'https://a.com', intent: 'archive', content_type: 'newsletter', capture_text: 'https://a.com', clean_text: null, idempotency_policy_key: 'telegram_link_v1', idempotency_key_primary: 'https://a.com', idempotency_key_secondary: 'x' },
        { _bulk_index: 1, url: 'https://b.com', url_canonical: 'https://b.com', intent: 'archive', content_type: 'newsletter', capture_text: 'https://b.com', clean_text: null, idempotency_policy_key: 'telegram_link_v1', idempotency_key_primary: 'https://b.com', idempotency_key_secondary: 'y' },
        { _bulk_index: 2, url: 'https://c.com', url_canonical: 'https://c.com', intent: 'archive', content_type: 'newsletter', capture_text: 'https://c.com', clean_text: null, idempotency_policy_key: 'telegram_link_v1', idempotency_key_primary: 'https://c.com', idempotency_key_secondary: 'z' },
      ],
      normalize_failures: [],
    });
    insertMock.mockResolvedValue({
      rows: [
        { _batch_index: 0, _batch_ok: true, action: 'inserted', entry_id: 101, url_canonical: 'https://a.com' },
        { _batch_index: 1, _batch_ok: true, action: 'skipped', entry_id: 102, url_canonical: 'https://b.com' },
        { _batch_index: 2, _batch_ok: false, error: 'insert failed' },
      ],
      rowCount: 2,
    });

    const { ingestTelegramUrlBatch } = require('../../src/server/telegram-url-batch-ingest.js');
    const out = await ingestTelegramUrlBatch({
      text: 'https://a.com, https://b.com, https://c.com',
      source: { chat_id: '1', message_id: '2' },
      continue_on_error: true,
    });

    expect(insertMock).toHaveBeenCalled();
    expect(out.url_count).toBe(3);
    expect(out.inserted_count).toBe(1);
    expect(out.skipped_count).toBe(1);
    expect(out.failed_count).toBe(1);
    expect(out.results).toHaveLength(3);
    expect(out.results[2]).toMatchObject({
      action: 'failed',
      error: 'insert failed',
      url_canonical: 'https://c.com',
    });
  });

  test('includes normalization failures in final per-url results', async () => {
    runTelegramBulkUrlIngestionPipelineMock.mockResolvedValue({
      mode: 'url_list',
      url_count: 2,
      urls: [
        { url: 'https://bad.example', url_canonical: 'https://bad.example' },
        { url: 'https://ok.example', url_canonical: 'https://ok.example' },
      ],
      items: [
        {
          _bulk_index: 1,
          url: 'https://ok.example',
          url_canonical: 'https://ok.example',
          intent: 'archive',
          content_type: 'newsletter',
          capture_text: 'https://ok.example',
          clean_text: null,
          idempotency_policy_key: 'telegram_link_v1',
          idempotency_key_primary: 'https://ok.example',
          idempotency_key_secondary: 'ok',
        },
      ],
      normalize_failures: [
        {
          batch_index: 0,
          url: 'https://bad.example',
          url_canonical: 'https://bad.example',
          error: 'normalize failed',
        },
      ],
    });
    insertMock.mockResolvedValue({
      rows: [
        { _batch_index: 0, _batch_ok: true, action: 'inserted', entry_id: 201, id: 'uuid-201' },
      ],
      rowCount: 1,
    });

    const { ingestTelegramUrlBatch } = require('../../src/server/telegram-url-batch-ingest.js');
    const out = await ingestTelegramUrlBatch({
      text: 'https://bad.example, https://ok.example',
      source: { chat_id: '1', message_id: '2' },
      continue_on_error: true,
    });

    expect(out.inserted_count).toBe(1);
    expect(out.failed_count).toBe(1);
    expect(out.results).toEqual([
      expect.objectContaining({
        batch_index: 0,
        ok: false,
        action: 'failed',
        url_canonical: 'https://bad.example',
        error: 'normalize failed',
      }),
      expect.objectContaining({
        batch_index: 1,
        ok: true,
        action: 'inserted',
        entry_id: 201,
        id: 'uuid-201',
        url_canonical: 'https://ok.example',
      }),
    ]);
  });
});
