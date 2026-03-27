'use strict';

const routeReadRequest = require('../../src/n8n/nodes/11-chatgpt-read-router/route-read-request__4d433aea-a923-4b5e-8d34-a33c70d6d6bd.js');

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
});
