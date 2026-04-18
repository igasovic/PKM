'use strict';

const { runWebpageIngestionPipeline } = require('../../src/server/ingestion-pipeline.js');
const { deriveContentHashFromCleanText } = require('../../src/libs/content-hash.js');

describe('ingestion-pipeline webpage', () => {
  test('orchestrates capture_text -> quality -> telegram idempotency for URL ingest', async () => {
    const out = await runWebpageIngestionPipeline({
      capture_text: 'Line 1\n\nLine 2',
      url: 'https://example.com/post?utm_source=telegram',
      source: { system: 'telegram', chat_id: '10', message_id: '20' },
      content_type: 'newsletter',
    });

    expect(out.capture_text).toBe('Line 1\n\nLine 2');
    expect(out.clean_text).toBe('Line 1\n\nLine 2');
    expect(out.content_hash).toBe(deriveContentHashFromCleanText('Line 1\n\nLine 2'));
    expect(out.url_canonical).toBe('https://example.com/post');
    expect(out.idempotency_policy_key).toBe('telegram_link_v1');
    expect(out.idempotency_key_primary).toBe('https://example.com/post');
    expect(out.retrieval_excerpt).toBeTruthy();
    expect(out.extracted_char_count).toBe('Line 1\n\nLine 2'.length);
  });

  test('uses capture_text as canonical input when text is omitted', async () => {
    const out = await runWebpageIngestionPipeline({
      capture_text: 'Only capture text input',
      url_canonical: 'https://example.com/a',
      source: { system: 'telegram', chat_id: '11', message_id: '21' },
    });

    expect(out.capture_text).toBe('Only capture text input');
    expect(out.clean_text).toBe('Only capture text input');
    expect(out.idempotency_policy_key).toBe('telegram_link_v1');
    expect(out.idempotency_key_primary).toBe('https://example.com/a');
  });
});
