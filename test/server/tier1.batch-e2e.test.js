'use strict';

describe('tier1 batch e2e (mocked LiteLLM + mocked db)', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('enqueue 100 entries and apply 100 updates to the same entry ids', async () => {
    const scheduledBatches = new Map();
    const scheduledRequests = new Map();
    const batchResults = new Map();
    const updatedEntries = new Map();
    let lastCreatedRequests = [];

    const fakeLogger = {
      child() {
        return this;
      },
      async step(_name, fn) {
        return fn();
      },
    };

    jest.doMock('../../src/server/logger/index.js', () => ({
      getLogger: () => fakeLogger,
    }));

    jest.doMock('../../src/server/logger/context.js', () => ({
      getRunContext: () => ({ run_id: 'test-run-tier1-batch' }),
    }));

    jest.doMock('../../src/server/logger/braintrust.js', () => ({
      braintrustSink: {
        logError: jest.fn(),
        logSuccess: jest.fn(),
      },
    }));

    jest.doMock('../../src/server/tier1/store.js', () => {
      const TERMINAL_BATCH_STATUSES = new Set(['completed', 'failed', 'expired', 'cancelled']);

      return {
        TERMINAL_BATCH_STATUSES,
        getActiveSchema: async () => 'pkm_test',
        upsertBatchRow: async (_schema, batch, requestCountHint, metadataExtra) => {
          const id = String(batch && batch.id ? batch.id : '').trim();
          if (!id) throw new Error('batch id is required');
          const existing = scheduledBatches.get(id) || {};
          scheduledBatches.set(id, {
            ...existing,
            batch_id: id,
            status: batch.status || existing.status || null,
            model: batch.model || existing.model || null,
            input_file_id: batch.input_file_id || existing.input_file_id || null,
            output_file_id: batch.output_file_id || existing.output_file_id || null,
            error_file_id: batch.error_file_id || existing.error_file_id || null,
            request_count: Number(batch.request_count || requestCountHint || existing.request_count || 0),
            metadata: metadataExtra || existing.metadata || {},
          });
        },
        upsertBatchItems: async (_schema, batchId, requests) => {
          scheduledRequests.set(String(batchId), Array.isArray(requests) ? requests.slice() : []);
        },
        upsertBatchResults: async (_schema, batchId, rows) => {
          const id = String(batchId);
          const existing = batchResults.get(id) || [];
          const byCustomId = new Map(existing.map((row) => [String(row.custom_id), row]));
          for (const row of (Array.isArray(rows) ? rows : [])) {
            byCustomId.set(String(row.custom_id), row);
          }
          batchResults.set(id, Array.from(byCustomId.values()));
          return Array.isArray(rows) ? rows.length : 0;
        },
        readBatchSummary: async (_schema, batchId) => {
          const rows = batchResults.get(String(batchId)) || [];
          const statusCounts = rows.reduce((acc, row) => {
            const key = String((row && row.status) || '').trim().toLowerCase() || 'error';
            acc[key] = Number(acc[key] || 0) + 1;
            return acc;
          }, {});
          return {
            total: rows.length,
            ok_count: Number(statusCounts.ok || 0),
            parse_error_count: Number(statusCounts.parse_error || 0),
            error_count: Number(statusCounts.error || 0),
          };
        },
        findBatchRecord: async (batchId) => {
          const id = String(batchId || '').trim();
          const record = scheduledBatches.get(id);
          if (!record) return null;
          return {
            schema: 'pkm_test',
            batch: record,
          };
        },
        getBatchItemRequests: async (_schema, batchId) => scheduledRequests.get(String(batchId)) || [],
        listPendingBatchIds: async () => [],
        listBatchStatuses: async () => [],
        getBatchStatus: async () => null,
      };
    });

    jest.doMock('../../src/server/db/tier1-classify-store.js', () => ({
      applyCollectedBatchResults: jest.fn(async (input) => {
        const rows = Array.isArray(input && input.rows) ? input.rows : [];
        let rowCount = 0;
        let skipped_non_ok = 0;
        let skipped_no_selector = 0;

        for (const row of rows) {
          if (!row || row.status !== 'ok' || !row.parsed) {
            skipped_non_ok += 1;
            continue;
          }
          const customId = String(row.custom_id || '').trim();
          const entryMatch = customId.match(/^entry_(\d+)$/);
          if (!entryMatch) {
            skipped_no_selector += 1;
            continue;
          }
          const entryId = Number(entryMatch[1]);
          updatedEntries.set(entryId, {
            entry_id: entryId,
            topic_primary: row.parsed.topic_primary,
            topic_secondary: row.parsed.topic_secondary,
            gist: row.parsed.gist,
          });
          rowCount += 1;
        }

        return {
          rows: Array.from(updatedEntries.values()),
          rowCount,
          skipped_non_ok,
          skipped_no_selector,
        };
      }),
    }));

    jest.doMock('../../src/server/litellm-client.js', () => {
      class LiteLLMClient {
        async createBatch(requests) {
          lastCreatedRequests = Array.isArray(requests) ? requests.slice() : [];
          return {
            input_file_id: 'file_in_t1_100',
            batch: {
              id: 'batch_t1_100',
              status: 'validating',
              model: 't1-batch',
              input_file_id: 'file_in_t1_100',
              output_file_id: 'file_out_t1_100',
              error_file_id: null,
            },
          };
        }

        async retrieveBatch(batchId) {
          return {
            id: String(batchId),
            status: 'completed',
            model: 't1-batch',
            input_file_id: 'file_in_t1_100',
            output_file_id: 'file_out_t1_100',
            error_file_id: null,
          };
        }

        async getFileContent(fileId) {
          if (String(fileId) !== 'file_out_t1_100') return '';
          return lastCreatedRequests.map((request) => {
            const customId = String(request.custom_id);
            const entryMatch = customId.match(/^entry_(\d+)$/);
            const entryId = entryMatch ? Number(entryMatch[1]) : 0;
            const content = JSON.stringify({
              topic_primary: 'topic-primary',
              topic_secondary: `topic-secondary-${entryId}`,
              keywords: ['k1', 'k2', 'k3', 'k4', 'k5'],
              gist: `gist-${entryId}`,
            });
            return JSON.stringify({
              custom_id: customId,
              response: {
                status_code: 200,
                body: {
                  choices: [
                    {
                      message: {
                        content,
                      },
                    },
                  ],
                },
              },
            });
          }).join('\n');
        }
      }

      function extractResponseText(response) {
        if (typeof response === 'string') return response;
        const content = response
          && response.choices
          && response.choices[0]
          && response.choices[0].message
          && response.choices[0].message.content;
        return String(content || '');
      }

      return {
        LiteLLMClient,
        extractResponseText,
      };
    });

    const { runBatchScheduleGraph, runBatchCollectGraph } = require('../../src/server/tier1/graphs.js');

    const inputItems = Array.from({ length: 100 }, (_, idx) => ({
      custom_id: `entry_${idx + 1}`,
      title: `Title ${idx + 1}`,
      author: `Author ${idx + 1}`,
      content_type: 'newsletter',
      clean_text: `This is clean text ${idx + 1}`,
    }));

    const scheduled = await runBatchScheduleGraph(inputItems, {
      completion_window: '24h',
      metadata: { source: 'jest' },
    });

    expect(scheduled).toEqual({
      batch_id: 'batch_t1_100',
      status: 'validating',
      schema: 'pkm_test',
      request_count: 100,
    });

    const collected = await runBatchCollectGraph('batch_t1_100', {});
    expect(collected.batch_id).toBe('batch_t1_100');
    expect(collected.status).toBe('completed');
    expect(collected.updated_items).toBe(100);
    expect(collected.applied_updates).toEqual({
      row_count: 100,
      skipped_non_ok: 0,
      skipped_no_selector: 0,
    });

    const updatedIds = Array.from(updatedEntries.keys()).sort((a, b) => a - b);
    const expectedIds = Array.from({ length: 100 }, (_, idx) => idx + 1);
    expect(updatedIds).toEqual(expectedIds);

    for (const id of expectedIds) {
      const row = updatedEntries.get(id);
      expect(row).toBeTruthy();
      expect(row.gist).toBe(`gist-${id}`);
      expect(row.topic_secondary).toBe(`topic-secondary-${id}`);
    }
  });

  test('completed batch with no parseable rows is marked failed and spawns one retry batch', async () => {
    const scheduledBatches = new Map();
    const scheduledRequests = new Map();
    const batchResults = new Map();
    const updatedEntries = new Map();
    let createBatchCall = 0;
    let lastCreatedRequests = [];

    const fakeLogger = {
      child() {
        return this;
      },
      async step(_name, fn) {
        return fn();
      },
    };

    jest.doMock('../../src/server/logger/index.js', () => ({
      getLogger: () => fakeLogger,
    }));

    jest.doMock('../../src/server/logger/context.js', () => ({
      getRunContext: () => ({ run_id: 'test-run-tier1-empty' }),
    }));

    jest.doMock('../../src/server/logger/braintrust.js', () => ({
      braintrustSink: {
        logError: jest.fn(),
        logSuccess: jest.fn(),
      },
    }));

    jest.doMock('../../src/server/tier1/store.js', () => {
      const TERMINAL_BATCH_STATUSES = new Set(['completed', 'failed', 'expired', 'cancelled']);

      return {
        TERMINAL_BATCH_STATUSES,
        getActiveSchema: async () => 'pkm_test',
        upsertBatchRow: async (_schema, batch, requestCountHint, metadataExtra) => {
          const id = String(batch && batch.id ? batch.id : '').trim();
          if (!id) throw new Error('batch id is required');
          const existing = scheduledBatches.get(id) || {};
          scheduledBatches.set(id, {
            ...existing,
            batch_id: id,
            status: batch.status || existing.status || null,
            model: batch.model || existing.model || null,
            input_file_id: batch.input_file_id || existing.input_file_id || null,
            output_file_id: batch.output_file_id || existing.output_file_id || null,
            error_file_id: batch.error_file_id || existing.error_file_id || null,
            request_count: Number(batch.request_count || requestCountHint || existing.request_count || 0),
            metadata: metadataExtra || existing.metadata || {},
          });
        },
        upsertBatchItems: async (_schema, batchId, requests) => {
          scheduledRequests.set(String(batchId), Array.isArray(requests) ? requests.slice() : []);
        },
        upsertBatchResults: async (_schema, batchId, rows) => {
          const id = String(batchId);
          const existing = batchResults.get(id) || [];
          const byCustomId = new Map(existing.map((row) => [String(row.custom_id), row]));
          for (const row of (Array.isArray(rows) ? rows : [])) {
            byCustomId.set(String(row.custom_id), row);
          }
          batchResults.set(id, Array.from(byCustomId.values()));
          return Array.isArray(rows) ? rows.length : 0;
        },
        readBatchSummary: async (_schema, batchId) => {
          const rows = batchResults.get(String(batchId)) || [];
          return {
            total: rows.length,
            ok_count: 0,
            parse_error_count: 0,
            error_count: 0,
          };
        },
        findBatchRecord: async (batchId) => {
          const id = String(batchId || '').trim();
          const record = scheduledBatches.get(id);
          if (!record) return null;
          return {
            schema: 'pkm_test',
            batch: record,
          };
        },
        getBatchItemRequests: async (_schema, batchId) => scheduledRequests.get(String(batchId)) || [],
        listPendingBatchIds: async () => [],
        listBatchStatuses: async () => [],
        getBatchStatus: async () => null,
      };
    });

    jest.doMock('../../src/server/db/tier1-classify-store.js', () => ({
      applyCollectedBatchResults: jest.fn(async () => ({
        rows: Array.from(updatedEntries.values()),
        rowCount: 0,
        skipped_non_ok: 0,
        skipped_no_selector: 0,
      })),
    }));

    jest.doMock('../../src/server/litellm-client.js', () => {
      class LiteLLMClient {
        async createBatch(requests) {
          createBatchCall += 1;
          lastCreatedRequests = Array.isArray(requests) ? requests.slice() : [];
          const batchId = createBatchCall === 1 ? 'batch_t1_empty_1' : 'batch_t1_empty_retry_1';
          return {
            input_file_id: `${batchId}_in`,
            batch: {
              id: batchId,
              status: 'validating',
              model: 't1-batch',
              input_file_id: `${batchId}_in`,
              output_file_id: `${batchId}_out`,
              error_file_id: null,
            },
          };
        }

        async retrieveBatch(batchId) {
          return {
            id: String(batchId),
            status: 'completed',
            model: 't1-batch',
            input_file_id: 'batch_t1_empty_1_in',
            output_file_id: 'batch_t1_empty_1_out',
            error_file_id: null,
          };
        }

        async getFileContent(fileId) {
          if (String(fileId) === 'batch_t1_empty_1_out') {
            // Intentionally non-JSONL / no parseable batch lines.
            return 'provider returned empty materialized output';
          }
          return '';
        }
      }

      function extractResponseText(response) {
        if (typeof response === 'string') return response;
        const content = response
          && response.choices
          && response.choices[0]
          && response.choices[0].message
          && response.choices[0].message.content;
        return String(content || '');
      }

      return {
        LiteLLMClient,
        extractResponseText,
      };
    });

    const { runBatchScheduleGraph, runBatchCollectGraph } = require('../../src/server/tier1/graphs.js');

    const inputItems = Array.from({ length: 100 }, (_, idx) => ({
      custom_id: `entry_${idx + 1}`,
      title: `Title ${idx + 1}`,
      author: `Author ${idx + 1}`,
      content_type: 'newsletter',
      clean_text: `This is clean text ${idx + 1}`,
    }));

    const scheduled = await runBatchScheduleGraph(inputItems, {
      completion_window: '24h',
      metadata: { source: 'jest' },
    });

    expect(scheduled.batch_id).toBe('batch_t1_empty_1');
    expect(lastCreatedRequests).toHaveLength(100);

    const collected = await runBatchCollectGraph('batch_t1_empty_1', {});
    expect(collected.status).toBe('failed');
    expect(collected.updated_items).toBe(0);
    expect(collected.applied_updates.row_count).toBe(0);
    expect(collected.retry).toEqual({
      spawned: true,
      retry_batch_id: 'batch_t1_empty_retry_1',
      request_count: 100,
    });
    expect(collected.completion_anomaly).toEqual(expect.objectContaining({
      code: 'completed_without_results',
      batch_id: 'batch_t1_empty_1',
      request_count: 100,
      retry_spawned: true,
      retry_batch_id: 'batch_t1_empty_retry_1',
    }));

    const originalBatch = scheduledBatches.get('batch_t1_empty_1');
    expect(originalBatch).toBeTruthy();
    expect(originalBatch.status).toBe('failed');
    expect(originalBatch.metadata).toEqual(expect.objectContaining({
      auto_retry_spawned_batch_id: 'batch_t1_empty_retry_1',
      completion_anomaly: expect.objectContaining({
        code: 'completed_without_results',
      }),
    }));

    const retryBatch = scheduledBatches.get('batch_t1_empty_retry_1');
    expect(retryBatch).toBeTruthy();
    expect(retryBatch.status).toBe('validating');
    expect(retryBatch.request_count).toBe(100);

    const retryRequests = scheduledRequests.get('batch_t1_empty_retry_1');
    expect(Array.isArray(retryRequests)).toBe(true);
    expect(retryRequests).toHaveLength(100);
  });
});
