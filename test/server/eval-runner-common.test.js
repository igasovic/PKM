'use strict';

jest.mock('../../scripts/evals/lib/live-api.js', () => ({
  getDebugRun: jest.fn(),
}));

const { getDebugRun } = require('../../scripts/evals/lib/live-api.js');
const {
  parsePositiveCaseLimit,
  resolveRunnerOptions,
  checkRunObservability,
} = require('../../scripts/evals/lib/runner-common.js');

describe('eval runner common helpers', () => {
  test('parsePositiveCaseLimit accepts positive values only', () => {
    expect(parsePositiveCaseLimit({ 'case-limit': '3' })).toBe(3);
    expect(parsePositiveCaseLimit({ 'case-limit': '0' })).toBeNull();
    expect(parsePositiveCaseLimit({ 'case-limit': '-5' })).toBeNull();
    expect(parsePositiveCaseLimit({})).toBeNull();
  });

  test('resolveRunnerOptions reads required secret and optional telegram user id', () => {
    const out = resolveRunnerOptions(
      {
        'backend-url': 'http://pkm-server:8080',
        'admin-secret': 'abc123',
        timeout: '12345',
      },
      { includeTelegramUserId: true }
    );

    expect(out.backendUrl).toBe('http://pkm-server:8080');
    expect(out.adminSecret).toBe('abc123');
    expect(out.timeoutMs).toBe(12345);
    expect(out.telegramUserId).toBe('1509032341');
    expect(out.checkObservability).toBe(true);
  });

  test('resolveRunnerOptions throws when admin secret is missing', () => {
    expect(() => resolveRunnerOptions({})).toThrow('Missing admin secret');
  });

  test('checkRunObservability returns true only when debug rows are present', async () => {
    getDebugRun.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await expect(checkRunObservability({
      backendUrl: 'http://pkm-server:8080',
      adminSecret: 'abc123',
      runId: 'eval.router.sample.case',
      timeoutMs: 5000,
    })).resolves.toBe(true);

    getDebugRun.mockResolvedValueOnce({ rows: [] });
    await expect(checkRunObservability({
      backendUrl: 'http://pkm-server:8080',
      adminSecret: 'abc123',
      runId: 'eval.router.sample.case',
      timeoutMs: 5000,
    })).resolves.toBe(false);
  });

  test('checkRunObservability returns false when debug lookup fails', async () => {
    getDebugRun.mockRejectedValueOnce(new Error('boom'));
    await expect(checkRunObservability({
      backendUrl: 'http://pkm-server:8080',
      adminSecret: 'abc123',
      runId: 'eval.router.sample.case',
      timeoutMs: 5000,
    })).resolves.toBe(false);
  });
});
