'use strict';

const {
  buildBatchRequests,
  mapBatchLineToResult,
  mergeResultRows,
  parseJsonl,
} = require('../../src/server/tier2/domain.js');

describe('tier2 batch domain helpers', () => {
  test('buildBatchRequests builds direct and chunked-fallback prompt modes', () => {
    const requests = buildBatchRequests([
      {
        id: '11111111-1111-4111-8111-111111111111',
        entry_id: 101,
        clean_text: 'Alpha beta gamma',
        content_hash: 'hash-a',
        title: 'A',
        author: 'Author A',
        content_type: 'newsletter',
        route: 'direct',
        chunking_strategy: 'direct',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        entry_id: 102,
        clean_text: 'Long newsletter body',
        content_hash: 'hash-b',
        title: 'B',
        author: 'Author B',
        content_type: 'newsletter',
        route: 'chunked',
        chunking_strategy: 'structure_paragraph_window_v1',
        retry_count: 2,
      },
    ]);

    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(expect.objectContaining({
      custom_id: 'entry_101',
      request_type: 'batch_direct_generation',
      prompt_mode: 'direct',
      route: 'direct',
      retry_count: 0,
    }));
    expect(requests[1]).toEqual(expect.objectContaining({
      custom_id: 'entry_102',
      request_type: 'batch_direct_generation',
      prompt_mode: 'chunked_fallback_direct',
      route: 'chunked',
      retry_count: 2,
    }));
    expect(typeof requests[0].prompt).toBe('string');
    expect(requests[0].prompt.length).toBeGreaterThan(10);
  });

  test('mapBatchLineToResult maps provider success/parse_error/error shapes', () => {
    const ok = mapBatchLineToResult({
      custom_id: 'entry_11',
      response: {
        status_code: 200,
        body: {
          choices: [{ message: { content: '{"distill_summary":"s","distill_excerpt":null,"distill_why_it_matters":"w","distill_stance":"descriptive"}' } }],
        },
      },
    });
    expect(ok).toEqual(expect.objectContaining({
      custom_id: 'entry_11',
      status: 'ok',
      parsed: expect.objectContaining({ distill_summary: 's' }),
    }));

    const parseErr = mapBatchLineToResult({
      custom_id: 'entry_12',
      response: {
        status_code: 200,
        body: {
          choices: [{ message: { content: '{not-json' } }],
        },
      },
    });
    expect(parseErr).toEqual(expect.objectContaining({
      custom_id: 'entry_12',
      status: 'parse_error',
      error: expect.objectContaining({ code: 'parse_error' }),
    }));

    const failed = mapBatchLineToResult({
      custom_id: 'entry_13',
      response: {
        status_code: 429,
        body: {
          error: {
            code: 'rate_limit',
            message: 'rate limited',
          },
        },
      },
    });
    expect(failed).toEqual(expect.objectContaining({
      custom_id: 'entry_13',
      status: 'error',
      error: expect.objectContaining({ code: 'rate_limit' }),
    }));
  });

  test('mergeResultRows prefers higher-quality status for duplicate ids', () => {
    const merged = mergeResultRows([
      { custom_id: 'entry_1', status: 'error' },
      { custom_id: 'entry_1', status: 'parse_error' },
      { custom_id: 'entry_1', status: 'ok' },
      { custom_id: 'entry_2', status: 'error' },
    ]);

    expect(merged).toEqual([
      { custom_id: 'entry_1', status: 'ok' },
      { custom_id: 'entry_2', status: 'error' },
    ]);
  });

  test('parseJsonl tolerates malformed lines', () => {
    const rows = parseJsonl('{"a":1}\nnot-json\n{"b":2}\n');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ a: 1 });
    expect(rows[1]).toEqual(expect.objectContaining({ parse_error: true }));
    expect(rows[2]).toEqual({ b: 2 });
  });
});
