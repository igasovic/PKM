'use strict';

const { BACKEND_ROUTE_REGISTRY } = require('../../src/server/routes/backend-route-registry.js');

describe('backend route registry contract', () => {
  test('every route has required metadata and canonical formatting', () => {
    expect(Array.isArray(BACKEND_ROUTE_REGISTRY)).toBe(true);
    expect(BACKEND_ROUTE_REGISTRY.length).toBeGreaterThan(0);

    const seen = new Set();
    for (const entry of BACKEND_ROUTE_REGISTRY) {
      expect(entry).toBeTruthy();
      expect(typeof entry.method).toBe('string');
      expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).toContain(entry.method);
      expect(typeof entry.path).toBe('string');
      expect(entry.path.startsWith('/')).toBe(true);
      expect(entry.path.includes('//')).toBe(false);
      expect(entry.path.endsWith('/')).toBe(false);
      expect(typeof entry.doc).toBe('string');
      expect(entry.doc.startsWith('docs/')).toBe(true);
      expect(Array.isArray(entry.tests)).toBe(true);
      expect(entry.tests.length).toBeGreaterThan(0);
      expect(Array.isArray(entry.primary_callers)).toBe(true);
      expect(entry.primary_callers.length).toBeGreaterThan(0);
      expect(typeof entry.auth).toBe('string');
      expect(entry.auth.length).toBeGreaterThan(0);

      const key = `${entry.method} ${entry.path}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
