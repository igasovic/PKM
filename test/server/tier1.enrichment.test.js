'use strict';

const mockListUnclassifiedCandidates = jest.fn();

jest.mock('../../src/server/logger/index.js', () => ({
  getLogger: () => ({
    child: () => ({
      step: async (_name, fn) => fn(),
    }),
  }),
}));

jest.mock('../../src/server/db/tier1-classify-store.js', () => ({
  listUnclassifiedCandidates: (...args) => mockListUnclassifiedCandidates(...args),
}));

jest.mock('../../src/server/tier1/graphs.js', () => ({
  runSyncEnrichmentGraph: jest.fn(),
  runBatchScheduleGraph: jest.fn(),
  runBatchCollectGraph: jest.fn(),
}));

describe('tier1 enrichment run limit safety', () => {
  beforeEach(() => {
    mockListUnclassifiedCandidates.mockReset();
  });

  test('runTier1ClassifyRun defaults limit to 1 when omitted', async () => {
    mockListUnclassifiedCandidates.mockResolvedValue([]);
    const { runTier1ClassifyRun } = require('../../src/server/tier1-enrichment.js');

    const out = await runTier1ClassifyRun({ dry_run: true });

    expect(mockListUnclassifiedCandidates).toHaveBeenCalledWith({ limit: 1, schema: null });
    expect(out.limit).toBe(1);
    expect(out.mode).toBe('dry_run');
    expect(out.will_process_count).toBe(0);
  });

  test('runTier1ClassifyRun rejects non-positive limit', async () => {
    const { runTier1ClassifyRun } = require('../../src/server/tier1-enrichment.js');

    await expect(runTier1ClassifyRun({ limit: 0 })).rejects.toMatchObject({
      message: 'classify run limit must be a positive integer',
      statusCode: 400,
    });
    expect(mockListUnclassifiedCandidates).not.toHaveBeenCalled();
  });
});
