'use strict';

const { createBatchStatusService } = require('../../src/server/batch-status-service.js');

describe('batch status service', () => {
  test('defaults to stage t1 and forwards t1 schema', async () => {
    const calls = [];
    const service = createBatchStatusService({
      getAdapter: (stage) => {
        expect(stage).toBe('t1');
        return {
          getStatusList: async (opts) => {
            calls.push(opts);
            return { summary: {}, jobs: [] };
          },
          getStatus: async () => null,
        };
      },
    });

    await service.getBatchStatusList({
      stage: 't1',
      limit: 10,
      schema: 'pkm_test',
    });

    expect(calls).toEqual([
      {
        limit: 10,
        include_terminal: false,
        schema: 'pkm_test',
      },
    ]);
  });

  test('stage t2 defaults include_terminal=true and ignores schema', async () => {
    const calls = [];
    const service = createBatchStatusService({
      getAdapter: (stage) => {
        expect(stage).toBe('t2');
        return {
          getStatusList: async (opts) => {
            calls.push(opts);
            return { summary: {}, jobs: [] };
          },
          getStatus: async () => null,
        };
      },
    });

    await service.getBatchStatusList({
      stage: 't2',
      limit: 5,
      schema: 'pkm',
    });

    expect(calls).toEqual([
      {
        limit: 5,
        include_terminal: true,
      },
    ]);
  });

  test('unrecognized include_terminal values fall back to stage default', async () => {
    const calls = [];
    const service = createBatchStatusService({
      getAdapter: (stage) => {
        expect(stage).toBe('t2');
        return {
          getStatusList: async (opts) => {
            calls.push(opts);
            return { summary: {}, jobs: [] };
          },
          getStatus: async () => null,
        };
      },
    });

    await service.getBatchStatusList({
      stage: 't2',
      limit: 3,
      include_terminal: 'maybe',
    });

    expect(calls).toEqual([
      {
        limit: 3,
        include_terminal: true,
      },
    ]);
  });

  test('getBatchStatus forwards parsed item options', async () => {
    const calls = [];
    const service = createBatchStatusService({
      getAdapter: (stage) => {
        expect(stage).toBe('t2');
        return {
          getStatusList: async () => ({ summary: {}, jobs: [] }),
          getStatus: async (batchId, opts) => {
            calls.push({ batchId, opts });
            return { batch_id: batchId, status: 'completed' };
          },
        };
      },
    });

    const out = await service.getBatchStatus({
      stage: 't2',
      batch_id: 'b_123',
      include_items: 'true',
      items_limit: '50',
      schema: 'pkm',
    });

    expect(out.batch_id).toBe('b_123');
    expect(calls).toEqual([
      {
        batchId: 'b_123',
        opts: {
          include_items: true,
          items_limit: '50',
        },
      },
    ]);
  });

  test('getBatchStatus falls back include_items to false for unknown values', async () => {
    const calls = [];
    const service = createBatchStatusService({
      getAdapter: () => ({
        getStatusList: async () => ({ summary: {}, jobs: [] }),
        getStatus: async (batchId, opts) => {
          calls.push({ batchId, opts });
          return { batch_id: batchId, status: 'completed' };
        },
      }),
    });

    await service.getBatchStatus({
      stage: 't2',
      batch_id: 'b_456',
      include_items: 'maybe',
      items_limit: '10',
    });

    expect(calls).toEqual([
      {
        batchId: 'b_456',
        opts: {
          include_items: false,
          items_limit: '10',
        },
      },
    ]);
  });

  test('throws on invalid stage', async () => {
    const service = createBatchStatusService({
      getAdapter: () => {
        throw new Error('should not be called');
      },
    });

    await expect(service.getBatchStatusList({ stage: 'abc' })).rejects.toThrow('stage must be t1|t2');
  });
});
