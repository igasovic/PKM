'use strict';

const buildSearchContextPack = require('../../src/n8n/nodes/11-chatgpt-read-router/build-search-context-pack__de43f4fe-84ab-43f5-b9b3-f3669e45b7ec.js');
const buildDetailContextPack = require('../../src/n8n/nodes/11-chatgpt-read-router/build-detail-context-pack__9d5c9ec9-87cd-4b76-9ba9-d1510d218740.js');

function asCtxFromRows(rows) {
  return {
    $json: rows[0],
    $input: {
      all() {
        return rows.map((json) => ({ json }));
      },
    },
  };
}

describe('wf11 context-pack builders', () => {
  test('build-search-context-pack uses all input items and reports success when hits exist', async () => {
    const rows = [
      {
        is_meta: true,
        cmd: 'continue',
        query_text: 'ai',
        days: 90,
        limit: 15,
      },
      {
        is_meta: false,
        cmd: 'continue',
        query_text: 'ai',
        entry_id: '10',
        title: 'Row 1',
      },
      {
        is_meta: false,
        cmd: 'continue',
        query_text: 'ai',
        entry_id: '8',
        title: 'Row 2',
      },
    ];

    const out = await buildSearchContextPack(asCtxFromRows(rows));
    const body = out[0].json.response_payload;

    expect(body.ok).toBe(true);
    expect(body.method).toBe('continue');
    expect(body.outcome).toBe('success');
    expect(body.no_result).toBe(false);
    expect(body.result.meta.row_count).toBe(2);
    expect(body.result.rows).toHaveLength(2);
  });

  test('build-detail-context-pack ignores meta row and reports success for pull hit', async () => {
    const rows = [
      {
        is_meta: true,
        cmd: 'pull',
        entry_id: null,
      },
      {
        is_meta: false,
        cmd: 'pull',
        entry_id: '797',
        title: 'Pulled row',
      },
    ];

    const out = await buildDetailContextPack(asCtxFromRows(rows));
    const body = out[0].json.response_payload;

    expect(body.ok).toBe(true);
    expect(body.method).toBe('pull');
    expect(body.outcome).toBe('success');
    expect(body.no_result).toBe(false);
    expect(body.result.meta.row_count).toBe(1);
    expect(body.result.rows).toHaveLength(1);
    expect(body.result.rows[0].entry_id).toBe('797');
  });

  test('build-detail-context-pack supports single-object pull payload', async () => {
    const payload = {
      entry_id: '45',
      id: 'b63b60f4-4a50-4821-a7bf-4220142fc7e7',
      title: 'Staying Sane',
      topic_primary: 'product',
    };

    const out = await buildDetailContextPack({
      $json: payload,
      $input: {
        all() {
          return [{ json: payload }];
        },
      },
    });
    const body = out[0].json.response_payload;

    expect(body.ok).toBe(true);
    expect(body.method).toBe('pull');
    expect(body.outcome).toBe('success');
    expect(body.no_result).toBe(false);
    expect(body.result.meta.row_count).toBe(1);
    expect(body.result.rows[0].entry_id).toBe('45');
  });

  test('build-search-context-pack returns failure envelope for HTTP error payload', async () => {
    const payload = {
      statusCode: 502,
      message: 'upstream unavailable',
      error: {
        code: 'backend_unavailable',
      },
    };

    const out = await buildSearchContextPack({
      $json: payload,
      $input: {
        all() {
          return [{ json: payload }];
        },
      },
    });
    const body = out[0].json;

    expect(body.http_status).toBe(502);
    expect(body.response_payload.ok).toBe(false);
    expect(body.response_payload.outcome).toBe('failure');
    expect(body.response_payload.error.code).toBe('backend_unavailable');
  });

  test('build-detail-context-pack returns failure envelope for HTTP error payload', async () => {
    const payload = {
      statusCode: 500,
      message: 'read pull failed',
      error: {
        code: 'backend_error',
      },
    };

    const out = await buildDetailContextPack({
      $json: payload,
      $input: {
        all() {
          return [{ json: payload }];
        },
      },
    });
    const body = out[0].json;

    expect(body.http_status).toBe(500);
    expect(body.response_payload.ok).toBe(false);
    expect(body.response_payload.outcome).toBe('failure');
    expect(body.response_payload.error.code).toBe('backend_error');
  });
});
