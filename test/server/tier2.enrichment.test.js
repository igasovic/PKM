'use strict';

const {
  buildTier2RunErrorResponse,
  buildTier2WorkerBusyResponse,
  createTier2BatchRunner,
  resolveTier2RetryConfig,
} = require('../../src/server/tier2-enrichment.js');

describe('tier2 enrichment batch runner', () => {
  test('buildTier2WorkerBusyResponse returns stable skipped contract', () => {
    expect(buildTier2WorkerBusyResponse()).toEqual({
      mode: 'skipped',
      target_schema: 'pkm',
      skipped: true,
      reason: 'worker_busy',
      message: 'Tier-2 batch worker is busy. Try again shortly.',
    });
  });

  test('buildTier2RunErrorResponse normalizes run-mode failures', () => {
    expect(buildTier2RunErrorResponse({ dry_run: false, max_sync_items: 7 }, 'planner failed')).toEqual({
      mode: 'run',
      target_schema: 'pkm',
      processing_limit: 7,
      candidate_count: 0,
      decision_counts: { proceed: 0, skipped: 0, not_eligible: 0 },
      persisted_eligibility: { updated: 0, groups: [] },
      planned_selected_count: 0,
      processed_count: 0,
      completed_count: 0,
      failed_count: 1,
      results: [],
      error: 'planner failed',
    });
  });

  test('buildTier2RunErrorResponse preserves dry_run mode on failures', () => {
    expect(buildTier2RunErrorResponse({ dry_run: true, max_sync_items: 4 }, 'planner failed')).toEqual({
      mode: 'dry_run',
      target_schema: 'pkm',
      processing_limit: 4,
      candidate_count: 0,
      decision_counts: { proceed: 0, skipped: 0, not_eligible: 0 },
      persisted_eligibility: { updated: 0, groups: [] },
      planned_selected_count: 0,
      will_process_count: 0,
      selected: [],
      error: 'planner failed',
    });
  });

  test('runs plan + sync and summarizes results', async () => {
    const syncCalls = [];
    const markQueuedCalls = [];
    const runner = createTier2BatchRunner({
      runPlan: async () => ({
        candidate_count: 10,
        decision_counts: { proceed: 2, skipped: 5, not_eligible: 3 },
        persisted_eligibility: { updated: 8, groups: [] },
        selected_count: 2,
        selected: [
          { id: 'a', entry_id: 101, route: 'direct', chunking_strategy: 'direct', priority_score: 20 },
          { id: 'b', entry_id: 102, route: 'chunked', chunking_strategy: 'structure_paragraph_window_v1', priority_score: 19 },
        ],
      }),
      distillOne: async (entryId) => {
        syncCalls.push(entryId);
        if (entryId === 102) {
          return { entry_id: 102, status: 'failed', error_code: 'generation_error' };
        }
        return { entry_id: entryId, status: 'completed' };
      },
      markQueued: async (ids, opts) => {
        markQueuedCalls.push({ ids, opts });
        return { rowCount: ids.length };
      },
      getConfig: () => ({
        distill: {
          retry: {
            enabled: false,
            max_attempts: 1,
            retryable_error_codes: ['generation_error'],
            non_retryable_error_codes: [],
          },
        },
      }),
      getLogger: () => ({
        child() { return this; },
        async step(_name, fn) { return fn(); },
      }),
    });

    const out = await runner.runTier2BatchCycle({
      max_sync_items: 2,
      persist_eligibility: true,
    });

    expect(markQueuedCalls).toEqual([
      {
        ids: ['a', 'b'],
        opts: { schema: 'pkm', reason_code: 'batch_dispatch' },
      },
    ]);
    expect(syncCalls).toEqual([101, 102]);
    expect(out.mode).toBe('run');
    expect(out.target_schema).toBe('pkm');
    expect(out.candidate_count).toBe(10);
    expect(out.planned_selected_count).toBe(2);
    expect(out.processed_count).toBe(2);
    expect(out.completed_count).toBe(1);
    expect(out.failed_count).toBe(1);
    expect(out.results).toEqual([
      { entry_id: 101, status: 'completed', error_code: null },
      { entry_id: 102, status: 'failed', error_code: 'generation_error' },
    ]);
  });

  test('dry_run skips sync execution', async () => {
    let syncCalled = false;
    let markQueuedCalled = false;
    const runner = createTier2BatchRunner({
      runPlan: async () => ({
        candidate_count: 3,
        decision_counts: { proceed: 1, skipped: 1, not_eligible: 1 },
        persisted_eligibility: { updated: 2, groups: [] },
        selected_count: 1,
        selected: [
          { id: 'a', entry_id: 201, route: 'direct', chunking_strategy: 'direct', priority_score: 10 },
        ],
      }),
      distillOne: async () => {
        syncCalled = true;
        return { entry_id: 201, status: 'completed' };
      },
      markQueued: async () => {
        markQueuedCalled = true;
        return { rowCount: 1 };
      },
      getLogger: () => ({
        child() { return this; },
        async step(_name, fn) { return fn(); },
      }),
    });

    const out = await runner.runTier2BatchCycle({ dry_run: true, max_sync_items: 1 });

    expect(syncCalled).toBe(false);
    expect(markQueuedCalled).toBe(false);
    expect(out.mode).toBe('dry_run');
    expect(out.will_process_count).toBe(1);
    expect(out.selected).toHaveLength(1);
  });

  test('treats boolean-like string options deterministically', async () => {
    let syncCalled = false;
    const runner = createTier2BatchRunner({
      runPlan: async () => ({
        candidate_count: 2,
        decision_counts: { proceed: 1, skipped: 1, not_eligible: 0 },
        persisted_eligibility: { updated: 0, groups: [] },
        selected_count: 1,
        selected: [{ id: 'a', entry_id: 301 }],
      }),
      distillOne: async () => {
        syncCalled = true;
        return { entry_id: 301, status: 'completed' };
      },
      getLogger: () => ({
        child() { return this; },
        async step(_name, fn) { return fn(); },
      }),
    });

    const out = await runner.runTier2BatchCycle({
      dry_run: 'false',
      persist_eligibility: 'false',
      max_sync_items: 1,
    });

    expect(syncCalled).toBe(true);
    expect(out.mode).toBe('run');
    expect(out.persisted_eligibility).toEqual({ updated: 0, groups: [] });
  });

  test('respects max_sync_items limit', async () => {
    const syncCalls = [];
    const markQueuedCalls = [];
    const runner = createTier2BatchRunner({
      runPlan: async () => ({
        candidate_count: 5,
        decision_counts: { proceed: 5, skipped: 0, not_eligible: 0 },
        persisted_eligibility: { updated: 0, groups: [] },
        selected_count: 3,
        selected: [
          { id: 'a', entry_id: 1 },
          { id: 'b', entry_id: 2 },
          { id: 'c', entry_id: 3 },
        ],
      }),
      distillOne: async (entryId) => {
        syncCalls.push(entryId);
        return { entry_id: entryId, status: 'completed' };
      },
      markQueued: async (ids) => {
        markQueuedCalls.push(ids);
        return { rowCount: ids.length };
      },
      getLogger: () => ({
        child() { return this; },
        async step(_name, fn) { return fn(); },
      }),
    });

    const out = await runner.runTier2BatchCycle({ max_sync_items: 2 });
    expect(markQueuedCalls).toEqual([['a', 'b']]);
    expect(syncCalls).toEqual([1, 2]);
    expect(out.processed_count).toBe(2);
  });

  test('retries retryable failures and succeeds on a later attempt', async () => {
    const syncCalls = [];
    const runner = createTier2BatchRunner({
      runPlan: async () => ({
        candidate_count: 1,
        decision_counts: { proceed: 1, skipped: 0, not_eligible: 0 },
        persisted_eligibility: { updated: 0, groups: [] },
        selected_count: 1,
        selected: [{ id: 'a', entry_id: 301 }],
      }),
      distillOne: async (entryId) => {
        syncCalls.push(entryId);
        if (syncCalls.length === 1) {
          return { entry_id: entryId, status: 'failed', error_code: 'generation_error' };
        }
        return { entry_id: entryId, status: 'completed' };
      },
      getConfig: () => ({
        distill: {
          retry: {
            enabled: true,
            max_attempts: 2,
            retryable_error_codes: ['generation_error'],
            non_retryable_error_codes: [],
          },
        },
      }),
      getLogger: () => ({
        child() { return this; },
        async step(_name, fn) { return fn(); },
      }),
    });

    const out = await runner.runTier2BatchCycle({ max_sync_items: 1 });
    expect(syncCalls).toEqual([301, 301]);
    expect(out.completed_count).toBe(1);
    expect(out.failed_count).toBe(0);
    expect(out.results).toEqual([
      { entry_id: 301, status: 'completed', error_code: null },
    ]);
  });

  test('does not retry non-retryable failure codes', async () => {
    const syncCalls = [];
    const runner = createTier2BatchRunner({
      runPlan: async () => ({
        candidate_count: 1,
        decision_counts: { proceed: 1, skipped: 0, not_eligible: 0 },
        persisted_eligibility: { updated: 0, groups: [] },
        selected_count: 1,
        selected: [{ id: 'a', entry_id: 401 }],
      }),
      distillOne: async (entryId) => {
        syncCalls.push(entryId);
        return { entry_id: entryId, status: 'failed', error_code: 'missing_clean_text' };
      },
      getConfig: () => ({
        distill: {
          retry: {
            enabled: true,
            max_attempts: 3,
            retryable_error_codes: ['generation_error'],
            non_retryable_error_codes: ['missing_clean_text'],
          },
        },
      }),
      getLogger: () => ({
        child() { return this; },
        async step(_name, fn) { return fn(); },
      }),
    });

    const out = await runner.runTier2BatchCycle({ max_sync_items: 1 });
    expect(syncCalls).toEqual([401]);
    expect(out.completed_count).toBe(0);
    expect(out.failed_count).toBe(1);
    expect(out.results[0]).toEqual({
      entry_id: 401,
      status: 'failed',
      error_code: 'missing_clean_text',
    });
  });

  test('preserves current-artifact marker in failed batch results', async () => {
    const syncCalls = [];
    const runner = createTier2BatchRunner({
      runPlan: async () => ({
        candidate_count: 1,
        decision_counts: { proceed: 1, skipped: 0, not_eligible: 0 },
        persisted_eligibility: { updated: 0, groups: [] },
        selected_count: 1,
        selected: [{ id: 'a', entry_id: 451 }],
      }),
      distillOne: async (entryId) => {
        syncCalls.push(entryId);
        return {
          entry_id: entryId,
          status: 'failed',
          error_code: 'generation_error',
          preserved_current_artifact: true,
        };
      },
      getConfig: () => ({
        distill: {
          retry: {
            enabled: true,
            max_attempts: 3,
            retryable_error_codes: ['generation_error'],
            non_retryable_error_codes: ['generation_error'],
          },
        },
      }),
      getLogger: () => ({
        child() { return this; },
        async step(_name, fn) { return fn(); },
      }),
    });

    const out = await runner.runTier2BatchCycle({ max_sync_items: 1 });
    expect(syncCalls).toEqual([451]);
    expect(out.results[0]).toEqual({
      entry_id: 451,
      status: 'failed',
      error_code: 'generation_error',
      preserved_current_artifact: true,
    });
  });

  test('stops retrying when max_attempts is reached', async () => {
    const syncCalls = [];
    const runner = createTier2BatchRunner({
      runPlan: async () => ({
        candidate_count: 1,
        decision_counts: { proceed: 1, skipped: 0, not_eligible: 0 },
        persisted_eligibility: { updated: 0, groups: [] },
        selected_count: 1,
        selected: [{ id: 'a', entry_id: 501 }],
      }),
      distillOne: async (entryId) => {
        syncCalls.push(entryId);
        return { entry_id: entryId, status: 'failed', error_code: 'generation_error' };
      },
      getConfig: () => ({
        distill: {
          retry: {
            enabled: true,
            max_attempts: 2,
            retryable_error_codes: ['generation_error'],
            non_retryable_error_codes: [],
          },
        },
      }),
      getLogger: () => ({
        child() { return this; },
        async step(_name, fn) { return fn(); },
      }),
    });

    const out = await runner.runTier2BatchCycle({ max_sync_items: 1 });
    expect(syncCalls).toEqual([501, 501]);
    expect(out.completed_count).toBe(0);
    expect(out.failed_count).toBe(1);
    expect(out.results[0]).toEqual({
      entry_id: 501,
      status: 'failed',
      error_code: 'generation_error',
    });
  });

  test('deterministic validation/currentness failures remain non-retryable', () => {
    const cfg = resolveTier2RetryConfig({
      distill: {
        retry: {
          enabled: true,
          max_attempts: 5,
          retryable_error_codes: [],
          non_retryable_error_codes: [],
        },
      },
    });

    expect(cfg.non_retryable_codes.has('excerpt_not_grounded')).toBe(true);
    expect(cfg.non_retryable_codes.has('summary_empty')).toBe(true);
    expect(cfg.non_retryable_codes.has('currentness_mismatch')).toBe(true);
  });

  test('does not retry deterministic failures even with permissive retry config', async () => {
    const syncCalls = [];
    const runner = createTier2BatchRunner({
      runPlan: async () => ({
        candidate_count: 1,
        decision_counts: { proceed: 1, skipped: 0, not_eligible: 0 },
        persisted_eligibility: { updated: 0, groups: [] },
        selected_count: 1,
        selected: [{ id: 'a', entry_id: 601 }],
      }),
      distillOne: async (entryId) => {
        syncCalls.push(entryId);
        return { entry_id: entryId, status: 'failed', error_code: 'excerpt_not_grounded' };
      },
      getConfig: () => ({
        distill: {
          retry: {
            enabled: true,
            max_attempts: 5,
            retryable_error_codes: [],
            non_retryable_error_codes: [],
          },
        },
      }),
      getLogger: () => ({
        child() { return this; },
        async step(_name, fn) { return fn(); },
      }),
    });

    const out = await runner.runTier2BatchCycle({ max_sync_items: 1 });
    expect(syncCalls).toEqual([601]);
    expect(out.failed_count).toBe(1);
    expect(out.results[0]).toEqual({
      entry_id: 601,
      status: 'failed',
      error_code: 'excerpt_not_grounded',
    });
  });
});
