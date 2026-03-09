'use strict';

const { createBatchWorkerRuntime } = require('../../src/server/batch-worker-runtime.js');

describe('batch worker runtime', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('returns worker_busy when cycle overlaps', async () => {
    let resolveCycle;
    const cyclePromise = new Promise((resolve) => {
      resolveCycle = resolve;
    });

    const runtime = createBatchWorkerRuntime({
      runCycle: async () => cyclePromise,
    });

    const first = runtime.runCycle({ a: 1 });
    const second = await runtime.runCycle({ a: 2 });

    expect(second).toEqual({ skipped: true, reason: 'worker_busy' });

    resolveCycle({ ok: true });
    const firstResult = await first;
    expect(firstResult).toEqual({ ok: true });
  });

  test('start triggers immediate and scheduled cycles; stop halts timer', async () => {
    jest.useFakeTimers();
    const calls = [];

    const runtime = createBatchWorkerRuntime({
      isEnabled: () => true,
      resolveIntervalMs: () => 5000,
      buildScheduledOptions: () => ({ source: 'timer' }),
      runCycle: async (opts) => {
        calls.push(opts);
        return { ok: true };
      },
    });

    runtime.start();
    await Promise.resolve();
    expect(calls).toEqual([{ source: 'timer' }]);

    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(calls).toEqual([{ source: 'timer' }, { source: 'timer' }]);

    runtime.stop();
    jest.advanceTimersByTime(15000);
    await Promise.resolve();
    expect(calls).toEqual([{ source: 'timer' }, { source: 'timer' }]);
  });

  test('does not start when disabled', async () => {
    jest.useFakeTimers();
    let called = 0;

    const runtime = createBatchWorkerRuntime({
      isEnabled: () => false,
      runCycle: async () => {
        called += 1;
        return { ok: true };
      },
    });

    runtime.start();
    jest.advanceTimersByTime(60000);
    await Promise.resolve();

    expect(called).toBe(0);
    expect(runtime.isRunning()).toBe(false);
  });

  test('runCycle catches errors and calls onError', async () => {
    const errors = [];
    const runtime = createBatchWorkerRuntime({
      runCycle: async () => {
        throw new Error('boom');
      },
      onError: (err) => {
        errors.push(err.message);
      },
    });

    const out = await runtime.runCycle({});
    expect(out).toEqual({ error: 'boom' });
    expect(errors).toEqual(['boom']);
  });
});
