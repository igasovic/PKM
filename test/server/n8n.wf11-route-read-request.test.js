'use strict';

const { requireExternalizedNode } = require('./n8n-node-loader');

const routeReadRequest = requireExternalizedNode('11-chatgpt-read-router', 'route-read-request');

async function runRoute(body) {
  const out = await routeReadRequest({ $json: { body } });
  expect(Array.isArray(out)).toBe(true);
  expect(out).toHaveLength(1);
  return out[0].json;
}

describe('wf11 route-read-request', () => {
  test('falls back to topic for continue_thread when q is missing', async () => {
    const out = await runRoute({
      intent: 'continue_thread',
      topic: 'parenting',
    });

    expect(out.read_method).toBe('continue');
    expect(out.backend_route).toBe('/db/read/continue');
    expect(out.backend_payload).toEqual({ q: 'parenting' });
    expect(out.query_text).toBe('parenting');
  });

  test('uses topic_primary fallback for last when q is missing', async () => {
    const out = await runRoute({
      method: 'last',
      topic_primary: 'sleep routine',
      days: 14,
    });

    expect(out.read_method).toBe('last');
    expect(out.backend_route).toBe('/db/read/last');
    expect(out.backend_payload).toEqual({ q: 'sleep routine', days: 14 });
    expect(out.query_text).toBe('sleep routine');
  });

  test('accepts days/limit as zero for continue and forwards zeros', async () => {
    const out = await runRoute({
      method: 'continue',
      q: 'ai',
      days: 0,
      limit: 0,
    });

    expect(out.read_method).toBe('continue');
    expect(out.backend_route).toBe('/db/read/continue');
    expect(out.backend_payload).toEqual({ q: 'ai', days: 0, limit: 0 });
    expect(out.days).toBe(0);
    expect(out.limit).toBe(0);
  });
});
