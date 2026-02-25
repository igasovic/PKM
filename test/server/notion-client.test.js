'use strict';

const { NotionClient } = require('../../src/server/notion-client.js');

function makeJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

describe('notion-client', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('builds notion object from page + blocks using mocked Notion API', async () => {
    const pageId = '3114c61a-2844-805c-9597-cb2b8534eb3d';
    const calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(String(url));
      const asString = String(url);
      if (asString.includes(`/pages/${encodeURIComponent(pageId)}`)) {
        return makeJsonResponse({
          id: pageId,
          url: `https://www.notion.so/${pageId.replace(/-/g, '')}`,
          parent: { type: 'database_id', database_id: '1a01372f-11ad-4ae7-a8eb-f5769af98b58' },
          properties: {
            Name: {
              id: 'title',
              type: 'title',
              title: [{ plain_text: 'Smoke Page Title' }],
            },
          },
        });
      }
      if (asString.includes(`/blocks/${encodeURIComponent(pageId)}/children`)) {
        return makeJsonResponse({
          results: [
            {
              id: 'b_h2',
              type: 'heading_2',
              has_children: false,
              heading_2: { rich_text: [{ plain_text: 'Section A' }] },
            },
            {
              id: 'b_p',
              type: 'paragraph',
              has_children: false,
              paragraph: { rich_text: [{ plain_text: 'Paragraph from notion.' }] },
            },
            {
              id: 'b_callout',
              type: 'callout',
              has_children: false,
              callout: {
                icon: { type: 'emoji', emoji: '💡' },
                rich_text: [{ plain_text: 'Callout from notion.' }],
              },
            },
          ],
          has_more: false,
          next_cursor: null,
        });
      }
      throw new Error(`unexpected fetch url in test: ${asString}`);
    });

    const client = new NotionClient({ token: 'secret_test' });
    const out = await client.buildNotionObject({
      page_id: pageId,
      updated_at: '2026-02-24T10:00:00.000Z',
      content_type: 'note',
    });

    expect(out.notion.page_id).toBe(pageId);
    expect(out.notion.database_id).toBe('1a01372f-11ad-4ae7-a8eb-f5769af98b58');
    expect(out.title).toBe('Smoke Page Title');
    expect(out.capture_text).toContain('## Section A');
    expect(out.capture_text).toContain('Paragraph from notion.');
    expect(out.capture_text).toContain('> 💡 Callout from notion.');
    expect(out.collect.blocks_fetched_total).toBe(3);
    expect(out.collect.blocks_skipped_unsupported).toBe(0);
    expect(calls.some((x) => x.includes('/pages/'))).toBe(true);
    expect(calls.some((x) => x.includes('/children?page_size=100'))).toBe(true);
  });

  test('records unsupported blocks but still returns capture text', async () => {
    const pageId = '3114c61a-2844-805c-9597-cb2b8534eb3d';
    global.fetch = jest.fn(async (url) => {
      const asString = String(url);
      if (asString.includes('/pages/')) {
        return makeJsonResponse({
          id: pageId,
          url: `https://www.notion.so/${pageId.replace(/-/g, '')}`,
          properties: {
            Name: { type: 'title', title: [{ plain_text: 'Title' }] },
          },
        });
      }
      if (asString.includes('/children?page_size=100')) {
        return makeJsonResponse({
          results: [
            { id: 'b1', type: 'table', has_children: false, table: {} },
            { id: 'b2', type: 'paragraph', has_children: false, paragraph: { rich_text: [{ plain_text: 'ok' }] } },
          ],
          has_more: false,
          next_cursor: null,
        });
      }
      throw new Error(`unexpected fetch url in test: ${asString}`);
    });

    const client = new NotionClient({ token: 'secret_test' });
    const out = await client.buildNotionObject({
      page_id: pageId,
      updated_at: '2026-02-24T10:00:00.000Z',
      title: 'fallback title',
      content_type: 'note',
    });

    expect(out.capture_text).toContain('ok');
    expect(out.collect.blocks_skipped_unsupported).toBe(1);
    expect(out.collect.errors[0].block_type).toBe('table');
  });

  test('smoke: can fetch real Notion page when enabled', async () => {
    if (process.env.RUN_NOTION_SMOKE !== '1') {
      return;
    }
    const pageId = process.env.NOTION_SMOKE_PAGE_ID || '3114c61a-2844-805c-9597-cb2b8534eb3d';
    const token = process.env.NOTION_API_TOKEN;
    if (!token) {
      throw new Error('RUN_NOTION_SMOKE=1 requires NOTION_API_TOKEN');
    }

    const client = new NotionClient({ token });
    const out = await client.buildNotionObject({
      page_id: pageId,
      updated_at: new Date().toISOString(),
      title: 'smoke',
      content_type: 'note',
    });

    expect(out.notion.page_id).toBeTruthy();
    expect(out.capture_text.length).toBeGreaterThan(0);
    expect(out.collect.blocks_fetched_total).toBeGreaterThan(0);
  }, 60000);
});
