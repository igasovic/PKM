'use strict';

jest.mock('../../src/server/notion-client.js', () => ({
  getNotionClient: () => ({
    buildNotionObject: jest.fn(async () => ({
      notion: {
        page_id: '3114c61a-2844-805c-9597-cb2b8534eb3d',
        database_id: '1a01372f-11ad-4ae7-a8eb-f5769af98b58',
        page_url: 'https://www.notion.so/3114c61a2844805c9597cb2b8534eb3d',
      },
      title: 'Mock Notion Title',
      content_type: 'note',
      url: null,
      created_at: '2026-02-24T08:00:00.000Z',
      updated_at: '2026-02-24T09:00:00.000Z',
      capture_text: 'Mock capture text from notion client.',
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          has_children: false,
          paragraph: { rich_text: [{ plain_text: 'Mock capture text from notion client.' }] },
        },
      ],
      collect: {
        blocks_fetched_total: 1,
        blocks_rendered: 1,
        blocks_skipped_unsupported: 0,
        errors: [],
      },
    })),
  }),
}));

const { runNotionIngestionPipeline } = require('../../src/server/ingestion-pipeline.js');
const { deriveContentHashFromCleanText } = require('../../src/libs/content-hash.js');

describe('ingestion-pipeline notion', () => {
  test('orchestrates notion collect -> normalize -> idempotency -> quality', async () => {
    const out = await runNotionIngestionPipeline({
      id: '3114c61a-2844-805c-9597-cb2b8534eb3d',
      updated_at: '2026-02-24T09:00:00.000Z',
      content_type: 'note',
      title: 'Mock Notion Title',
    });

    expect(out.source).toBe('notion');
    expect(out.title).toBe('Mock Notion Title');
    expect(out.capture_text).toContain('Mock capture text');
    expect(out.content_hash).toBe(deriveContentHashFromCleanText(out.clean_text));
    expect(out.idempotency_policy_key).toBe('notion_note_v1');
    expect(out.idempotency_key_primary).toBe('notion:3114c61a-2844-805c-9597-cb2b8534eb3d');
    expect(out.retrieval_excerpt).toBeTruthy();
  });
});
