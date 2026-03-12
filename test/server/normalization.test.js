'use strict';

const {
  normalizeTelegram,
  normalizeEmail,
  normalizeWebpage,
  normalizeNotion,
} = require('../../src/server/normalization.js');
const { deriveContentHashFromCleanText } = require('../../src/libs/content-hash.js');

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
    expect(out.content_hash).toBeNull();
    expect(out.__idempotency_source.system).toBe('telegram');
    expect(out.idempotency_policy_key).toBeUndefined();
    expect(out.retrieval_excerpt).toBeUndefined();
  });

  test('telegram think payload emits hash from parsed clean text', async () => {
    const out = await normalizeTelegram({
      text: '{"title":"T","topic":"X"}\nhello world',
      source: { chat_id: '1', message_id: '2' },
    });

    expect(out.content_type).toBe('note');
    expect(out.clean_text).toBe('hello world');
    expect(out.content_hash).toBe(deriveContentHashFromCleanText('hello world'));
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
    expect(out.content_hash).toBe(deriveContentHashFromCleanText(out.clean_text));
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
    expect(out.content_hash).toBe(deriveContentHashFromCleanText(out.clean_text));
    expect(out.url_canonical).toBe('https://example.com/post');
    expect(out.retrieval_excerpt).toBeUndefined();
    expect(out.idempotency_policy_key).toBeUndefined();
  });

  test('notion normalization defaults content_type to note and post-processes capture_text', async () => {
    const out = await normalizeNotion({
      notion: { page_id: 'pg_123', database_id: 'db_1', page_url: 'https://www.notion.so/page' },
      updated_at: '2026-02-24T10:00:00.000Z',
      title: 'Notion idea',
      capture_text: '## Section\n\nParagraph body\n\n> 💡 Callout line',
      blocks: [
        {
          id: 'b1',
          type: 'heading_2',
          heading_2: { rich_text: [{ plain_text: 'Section' }] },
        },
        {
          id: 'b2',
          type: 'paragraph',
          paragraph: { rich_text: [{ plain_text: 'Paragraph body' }] },
        },
        {
          id: 'b3',
          type: 'callout',
          callout: {
            icon: { type: 'emoji', emoji: '💡' },
            rich_text: [{ plain_text: 'Callout line' }],
          },
        },
        {
          id: 'b4',
          type: 'toggle',
          toggle: { rich_text: [{ plain_text: 'Toggle title' }] },
        },
        {
          id: 'b5',
          type: 'table_of_contents',
          table_of_contents: {},
        },
        {
          id: 'b6',
          type: 'child_page',
          child_page: { title: 'Nested Page' },
        },
        {
          id: 'b7',
          type: 'column_list',
          has_children: true,
          children: [
            {
              id: 'b7c1',
              type: 'column',
              has_children: true,
              children: [
                {
                  id: 'b7c1p',
                  type: 'paragraph',
                  paragraph: { rich_text: [{ plain_text: 'Column paragraph' }] },
                },
              ],
            },
          ],
        },
        {
          id: 'b8',
          type: 'table',
          has_children: true,
          table: { has_column_header: true },
          children: [
            {
              id: 'r1',
              type: 'table_row',
              table_row: {
                cells: [
                  [{ plain_text: 'H1' }],
                  [{ plain_text: 'H2' }],
                ],
              },
            },
            {
              id: 'r2',
              type: 'table_row',
              table_row: {
                cells: [
                  [{ plain_text: 'A1' }],
                  [{ plain_text: 'A2' }],
                ],
              },
            },
          ],
        },
      ],
      source: {},
    });

    expect(out.source).toBe('notion');
    expect(out.content_type).toBe('note');
    expect(out.title).toBe('Notion idea');
    expect(out.clean_text).toContain('## Section');
    expect(out.clean_text).toContain('Paragraph body');
    expect(out.clean_text).toContain('> 💡 Callout line');
    expect(out.content_hash).toBe(deriveContentHashFromCleanText(out.clean_text));
    expect(out.external_ref.notion.page_id).toBe('pg_123');
    expect(out.__idempotency_source.system).toBe('notion');
  });

  test('webpage normalization sets null hash when cleaned text is empty', async () => {
    const out = await normalizeWebpage({
      text: '   \n\t',
      url: 'https://example.com/post',
      content_type: 'newsletter',
    });

    expect(out.clean_text).toBe('');
    expect(out.content_hash).toBeNull();
    expect(out.retrieval_update_skipped).toBe(true);
  });

  test('notion normalization requires capture_text (parsing is handled upstream)', async () => {
    await expect(normalizeNotion({
      notion: { page_id: 'pg_unsupported', database_id: 'db_1' },
      updated_at: '2026-02-24T10:00:00.000Z',
      content_type: 'note',
      title: 'Unsupported',
      blocks: [
        {
          id: 'x1',
          type: 'unsupported_widget',
          unsupported_widget: {},
        },
      ],
      source: {},
    })).rejects.toThrow('capture_text is required');
  });

  test('notion normalization rejects invalid content_type', async () => {
    await expect(normalizeNotion({
      notion: { page_id: 'pg_bad', database_id: 'db_1' },
      updated_at: '2026-02-24T10:00:00.000Z',
      content_type: 'thread',
      title: 'Invalid',
      capture_text: 'hello',
      source: {},
    })).rejects.toThrow('invalid content_type');
  });
});
