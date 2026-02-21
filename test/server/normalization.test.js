'use strict';

const {
  normalizeTelegram,
  normalizeEmail,
  normalizeWebpage,
} = require('../../src/server/normalization.js');

describe('normalization', () => {
  test('telegram normalizes link payload without quality/idempotency fields', async () => {
    const out = await normalizeTelegram({
      text: 'Check this https://example.com/path?utm_source=x#frag',
      source: { chat_id: '1', message_id: '2' },
    });

    expect(out.source).toBe('telegram');
    expect(out.content_type).toBe('newsletter');
    expect(out.url).toBe('https://example.com/path?utm_source=x#frag');
    expect(out.url_canonical).toBe('https://example.com/path');
    expect(out.__idempotency_source.system).toBe('telegram');
    expect(out.idempotency_policy_key).toBeUndefined();
    expect(out.retrieval_excerpt).toBeUndefined();
  });

  test('email returns normalized payload and internal idempotency source', async () => {
    const out = await normalizeEmail({
      raw_text: 'Hello there from newsletter body',
      from: 'Sender <sender@example.com>',
      subject: 'Fwd: Weekly Update',
      date: 'Tue, 17 Feb 2026 14:00:43 +0000',
      message_id: '<abc@x>',
      source: {},
    });

    expect(out.source).toBe('email');
    expect(out.capture_text).toContain('Hello there');
    expect(out.__idempotency_source.system).toBe('email');
    expect(out.__idempotency_source.from_addr).toBe('Sender <sender@example.com>');
    expect(out.__idempotency_source.subject).toBe('Weekly Update');
    expect(out.__idempotency_source.date).toBe('Tue, 17 Feb 2026 14:00:43 +0000');
    expect(out.idempotency_policy_key).toBeUndefined();
    expect(out.retrieval_excerpt).toBeUndefined();
  });

  test('webpage normalization returns cleaned text and canonical url only', async () => {
    const out = await normalizeWebpage({
      text: 'Line 1\n\nLine 2',
      url: 'https://example.com/post?utm_medium=email',
      content_type: 'newsletter',
    });

    expect(out.clean_text).toBe('Line 1\n\nLine 2');
    expect(out.url_canonical).toBe('https://example.com/post');
    expect(out.retrieval_excerpt).toBeUndefined();
    expect(out.idempotency_policy_key).toBeUndefined();
  });
});
