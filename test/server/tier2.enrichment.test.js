'use strict';

const { createTier2BatchRunner } = require('../../src/server/tier2-enrichment.js');

describe('tier2 enrichment batch runner', () => {
  test('runs plan + sync and summarizes results', async () => {
    const syncCalls = [];
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
      getLogger: () => ({
        child() { return this; },
        async step(_name, fn) { return fn(); },
      }),
    });

    const out = await runner.runTier2BatchCycle({
      max_sync_items: 2,
      persist_eligibility: true,
    });

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
      getLogger: () => ({
        child() { return this; },
        async step(_name, fn) { return fn(); },
      }),
    });

    const out = await runner.runTier2BatchCycle({ dry_run: true, max_sync_items: 1 });

    expect(syncCalled).toBe(false);
    expect(out.mode).toBe('dry_run');
    expect(out.will_process_count).toBe(1);
    expect(out.selected).toHaveLength(1);
  });

  test('respects max_sync_items limit', async () => {
    const syncCalls = [];
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
      getLogger: () => ({
        child() { return this; },
        async step(_name, fn) { return fn(); },
      }),
    });

    const out = await runner.runTier2BatchCycle({ max_sync_items: 2 });
    expect(syncCalls).toEqual([1, 2]);
    expect(out.processed_count).toBe(2);
  });
});
