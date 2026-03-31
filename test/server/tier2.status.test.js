'use strict';

describe('tier2 status surfaces', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  function mockQueuedMarkerDb() {
    jest.doMock('../../src/server/db/distill-store.js', () => ({
      persistTier2QueuedStatusByIds: async () => ({ rowCount: 0 }),
    }));
  }

  test('records run history and returns list/detail payloads', async () => {
    mockQueuedMarkerDb();
    jest.doMock('../../src/server/tier2/planner.js', () => ({
      runTier2ControlPlanePlan: async () => ({
        candidate_count: 3,
        decision_counts: { proceed: 2, skipped: 1, not_eligible: 0 },
        persisted_eligibility: { updated: 1, groups: [] },
        selected_count: 2,
        selected: [
          { id: 'a', entry_id: 101 },
          { id: 'b', entry_id: 102 },
        ],
      }),
    }));

    jest.doMock('../../src/server/tier2/service.js', () => ({
      distillTier2SingleEntrySync: async (entryId) => {
        if (Number(entryId) === 102) {
          return { entry_id: 102, status: 'failed', error_code: 'generation_error' };
        }
        return { entry_id: entryId, status: 'completed' };
      },
    }));

    const t2 = require('../../src/server/tier2-enrichment.js');

    const run = await t2.runTier2BatchWorkerCycle({
      max_sync_items: 2,
      persist_eligibility: true,
      dry_run: false,
    });

    expect(run.batch_id).toBeTruthy();
    const list = await t2.getTier2BatchStatusList({ limit: 10, include_terminal: true });
    expect(list.summary.jobs).toBeGreaterThanOrEqual(1);
    expect(list.jobs[0].batch_id).toBe(run.batch_id);
    expect(list.jobs[0].counts.total_items).toBe(2);
    expect(list.jobs[0].counts.ok).toBe(1);
    expect(list.jobs[0].counts.error).toBe(1);
    expect(list.jobs[0].metadata.execution_mode).toBe('batch');
    expect(list.jobs[0].metadata.error_code_counts).toEqual({
      generation_error: 1,
    });

    const detail = await t2.getTier2BatchStatus(run.batch_id, {
      include_items: true,
      items_limit: 10,
    });
    expect(detail).toBeTruthy();
    expect(detail.batch_id).toBe(run.batch_id);
    expect(Array.isArray(detail.items)).toBe(true);
    expect(detail.items).toHaveLength(2);
    expect(detail.items[0]).toHaveProperty('entry_id');
    const failedItem = detail.items.find((item) => item.entry_id === 102);
    expect(failedItem).toBeTruthy();
    expect(failedItem.error_code).toBe('generation_error');
    expect(failedItem.has_error).toBe(true);
  });

  test('dry-run status stores planned count in metadata', async () => {
    mockQueuedMarkerDb();
    jest.doMock('../../src/server/tier2/planner.js', () => ({
      runTier2ControlPlanePlan: async () => ({
        candidate_count: 2,
        decision_counts: { proceed: 1, skipped: 1, not_eligible: 0 },
        persisted_eligibility: { updated: 1, groups: [] },
        selected_count: 1,
        selected: [{ id: 'a', entry_id: 201 }],
      }),
    }));

    jest.doMock('../../src/server/tier2/service.js', () => ({
      distillTier2SingleEntrySync: async () => {
        throw new Error('should not run during dry_run');
      },
    }));

    const t2 = require('../../src/server/tier2-enrichment.js');
    const run = await t2.runTier2BatchWorkerCycle({ dry_run: true, max_sync_items: 1 });

    expect(run.mode).toBe('dry_run');
    const detail = await t2.getTier2BatchStatus(run.batch_id, { include_items: true });
    expect(detail.status).toBe('dry_run');
    expect(detail.counts.pending).toBe(0);
    expect(detail.metadata.will_process_count).toBe(1);
    expect(detail.items[0].status).toBe('planned');
  });

  test('normalizes runtime errors into failed run records', async () => {
    mockQueuedMarkerDb();
    jest.doMock('../../src/server/tier2/planner.js', () => ({
      runTier2ControlPlanePlan: async () => {
        throw new Error('planner unavailable');
      },
    }));

    jest.doMock('../../src/server/tier2/service.js', () => ({
      distillTier2SingleEntrySync: async () => {
        throw new Error('should not be called');
      },
    }));

    const t2 = require('../../src/server/tier2-enrichment.js');
    const run = await t2.runTier2BatchWorkerCycle({ dry_run: false, max_sync_items: 2 });

    expect(run.mode).toBe('run');
    expect(run.error).toContain('planner unavailable');
    expect(run.batch_id).toBeTruthy();
    expect(run.failed_count).toBe(1);

    const detail = await t2.getTier2BatchStatus(run.batch_id, { include_items: true });
    expect(detail).toBeTruthy();
    expect(detail.status).toBe('failed');
    expect(detail.counts.error).toBe(1);
    expect(detail.metadata.error).toContain('planner unavailable');
    expect(detail.items).toHaveLength(0);
  });

  test('status detail keeps preserved-current marker on failed items', async () => {
    mockQueuedMarkerDb();
    jest.doMock('../../src/server/tier2/planner.js', () => ({
      runTier2ControlPlanePlan: async () => ({
        candidate_count: 1,
        decision_counts: { proceed: 1, skipped: 0, not_eligible: 0 },
        persisted_eligibility: { updated: 0, groups: [] },
        selected_count: 1,
        selected: [{ id: 'a', entry_id: 301 }],
      }),
    }));

    jest.doMock('../../src/server/tier2/service.js', () => ({
      distillTier2SingleEntrySync: async () => ({
        entry_id: 301,
        status: 'failed',
        error_code: 'generation_error',
        message: 'provider timeout',
        preserved_current_artifact: true,
      }),
    }));

    const t2 = require('../../src/server/tier2-enrichment.js');
    const run = await t2.runTier2BatchWorkerCycle({ dry_run: false, max_sync_items: 1 });
    const detail = await t2.getTier2BatchStatus(run.batch_id, { include_items: true });

    expect(detail.metadata.preserved_current_count).toBe(1);
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]).toEqual(expect.objectContaining({
      entry_id: 301,
      status: 'generation_error',
      error_code: 'generation_error',
      message: 'provider timeout',
      preserved_current_artifact: true,
    }));
  });
});
