'use strict';

const crypto = require('crypto');
const {
  buildIdempotencyForNormalized,
  toDateBucketYYYYMMDD,
} = require('../../src/server/idempotency.js');

function sha256(parts) {
  const value = Array.isArray(parts)
    ? parts.map((x) => String(x ?? '').trim()).join('|')
    : String(parts ?? '').trim();
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('idempotency', () => {
  test('derives newsletter keys for email system', () => {
    const out = buildIdempotencyForNormalized({
      source: {
        system: 'email',
        from_addr: 'Sender <sender@example.com>',
        subject: 'Fwd: Weekly Update',
        date: '2026-02-17T14:00:43Z',
        message_id: '<abc@x>',
      },
      normalized: { content_type: 'newsletter' },
    });

    expect(out.idempotency_policy_key).toBe('email_newsletter_v1');
    expect(out.idempotency_key_primary).toBe('<abc@x>');
    expect(out.idempotency_key_secondary).toBe(sha256(['sender@example.com', 'fwd: weekly update', '20260217']));
  });

  test('treats email-batch same as email for newsletter keys', () => {
    const out = buildIdempotencyForNormalized({
      source: {
        system: 'email-batch',
        from_addr: 'sender@example.com',
        subject: 'weekly update',
        date: 'Tue, 17 Feb 2026 14:00:43 +0000',
        message_id: null,
      },
      normalized: { content_type: 'newsletter' },
    });

    expect(out.idempotency_policy_key).toBe('email_newsletter_v1');
    expect(out.idempotency_key_primary).toBeNull();
    expect(out.idempotency_key_secondary).toBe(sha256(['sender@example.com', 'weekly update', '20260217']));
  });

  test('derives telegram thought keys', () => {
    const out = buildIdempotencyForNormalized({
      source: { system: 'telegram', chat_id: '1', message_id: '2' },
      normalized: { content_type: 'note', clean_text: 'hello world' },
    });

    expect(out.idempotency_policy_key).toBe('telegram_thought_v1');
    expect(out.idempotency_key_primary).toBe('tg:1:2');
    expect(out.idempotency_key_secondary).toBe(sha256('hello world'));
  });

  test('throws on missing newsletter subject', () => {
    expect(() => buildIdempotencyForNormalized({
      source: { system: 'email', from_addr: 'a@b.com', date: '2026-02-17' },
      normalized: { content_type: 'newsletter' },
    })).toThrow('email newsletter subject is required');
  });

  test('normalizes date bucket as YYYYMMDD', () => {
    expect(toDateBucketYYYYMMDD('Tue, 17 Feb 2026 14:00:43 +0000')).toBe('20260217');
    expect(toDateBucketYYYYMMDD('2026-02-17')).toBe('20260217');
  });
});
