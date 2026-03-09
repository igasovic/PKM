'use strict';

function createLoggerStub() {
  return {
    child() {
      return this;
    },
    async step(_name, fn) {
      return fn();
    },
  };
}

function buildFinalOutput(overrides) {
  return JSON.stringify({
    distill_summary: 'Distilled summary of the source material.',
    distill_excerpt: 'alpha insight',
    distill_why_it_matters: 'This helps prioritize follow-up reading.',
    distill_stance: 'analytical',
    ...(overrides || {}),
  });
}

describe('tier2 sync service', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('direct route persists completed artifact with sync-direct model', async () => {
    const sendMessage = jest.fn().mockResolvedValue({
      text: buildFinalOutput(),
    });
    const persistTier2SyncSuccess = jest.fn().mockResolvedValue({ rowCount: 1 });
    const persistTier2SyncFailure = jest.fn().mockResolvedValue({ rowCount: 0 });

    jest.doMock('../../src/libs/config.js', () => ({
      getConfig: () => ({
        distill: {
          version: 'distill_v2',
          direct_chunk_threshold_words: 5000,
          models: {
            sync_direct: 't2-sync-direct',
          },
        },
      }),
    }));

    jest.doMock('../../src/server/db.js', () => ({
      getTier2SyncEntryByEntryId: async () => ({
        entry_id: 701,
        title: 'Direct route sample',
        author: 'PKM',
        content_type: 'newsletter',
        clean_text: 'alpha insight appears in this clean source text for grounding checks.',
        clean_word_count: 12,
        content_hash: 'hash_direct_1',
      }),
      persistTier2SyncSuccess,
      persistTier2SyncFailure,
    }));

    jest.doMock('../../src/server/litellm-client.js', () => ({
      LiteLLMClient: jest.fn().mockImplementation(() => ({
        sendMessage,
      })),
    }));

    jest.doMock('../../src/server/logger/index.js', () => ({
      getLogger: () => createLoggerStub(),
    }));

    const { distillTier2SingleEntrySync } = require('../../src/server/tier2/service.js');
    const out = await distillTier2SingleEntrySync(701);

    expect(out).toEqual({
      entry_id: 701,
      status: 'completed',
      summary: 'Distilled summary of the source material.',
      excerpt: 'alpha insight',
      why_it_matters: 'This helps prioritize follow-up reading.',
      stance: 'analytical',
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1].model).toBe('t2-sync-direct');
    expect(persistTier2SyncFailure).not.toHaveBeenCalled();
    expect(persistTier2SyncSuccess).toHaveBeenCalledTimes(1);
    expect(persistTier2SyncSuccess.mock.calls[0][0]).toBe(701);
    expect(persistTier2SyncSuccess.mock.calls[0][1]).toEqual(expect.objectContaining({
      distill_summary: 'Distilled summary of the source material.',
      distill_excerpt: 'alpha insight',
      distill_why_it_matters: 'This helps prioritize follow-up reading.',
      distill_stance: 'analytical',
      distill_version: 'distill_v2',
      distill_created_from_hash: 'hash_direct_1',
      distill_metadata: expect.objectContaining({
        model: 't2-sync-direct',
        request_type: 'direct_generation',
        chunking_strategy: 'direct',
        retry_count: 0,
      }),
    }));
  });

  test('chunked route uses chunk-note and synthesis models before persist', async () => {
    const sendMessage = jest.fn()
      .mockResolvedValueOnce({
        text: JSON.stringify({ note: 'chunk-note-1' }),
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({ note: 'chunk-note-2' }),
      })
      .mockResolvedValueOnce({
        text: buildFinalOutput({
          distill_summary: 'Chunked summary.',
          distill_excerpt: 'alpha insight',
          distill_why_it_matters: 'Chunked synthesis captured key themes.',
        }),
      });
    const persistTier2SyncSuccess = jest.fn().mockResolvedValue({ rowCount: 1 });
    const persistTier2SyncFailure = jest.fn().mockResolvedValue({ rowCount: 0 });

    jest.doMock('../../src/libs/config.js', () => ({
      getConfig: () => ({
        distill: {
          version: 'distill_v1',
          direct_chunk_threshold_words: 5,
          models: {
            chunk_note: 't2-chunk-note',
            synthesis: 't2-synthesis',
          },
        },
      }),
    }));

    jest.doMock('../../src/server/db.js', () => ({
      getTier2SyncEntryByEntryId: async () => ({
        entry_id: 702,
        title: 'Chunked route sample',
        author: 'PKM',
        content_type: 'newsletter',
        clean_text: 'alpha insight appears in this clean source text for grounding checks.',
        clean_word_count: 100,
        content_hash: 'hash_chunked_1',
      }),
      persistTier2SyncSuccess,
      persistTier2SyncFailure,
    }));

    jest.doMock('../../src/server/tier2/chunking.js', () => ({
      chunkTextForTier2: () => ([
        { index: 0, text: 'chunk one text', word_count: 3 },
        { index: 1, text: 'chunk two text', word_count: 3 },
      ]),
    }));

    jest.doMock('../../src/server/litellm-client.js', () => ({
      LiteLLMClient: jest.fn().mockImplementation(() => ({
        sendMessage,
      })),
    }));

    jest.doMock('../../src/server/logger/index.js', () => ({
      getLogger: () => createLoggerStub(),
    }));

    const { distillTier2SingleEntrySync } = require('../../src/server/tier2/service.js');
    const out = await distillTier2SingleEntrySync(702);

    expect(out.status).toBe('completed');
    expect(out.summary).toBe('Chunked summary.');
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessage.mock.calls[0][1].model).toBe('t2-chunk-note');
    expect(sendMessage.mock.calls[1][1].model).toBe('t2-chunk-note');
    expect(sendMessage.mock.calls[2][1].model).toBe('t2-synthesis');
    expect(persistTier2SyncFailure).not.toHaveBeenCalled();
    expect(persistTier2SyncSuccess).toHaveBeenCalledTimes(1);
    expect(persistTier2SyncSuccess.mock.calls[0][1]).toEqual(expect.objectContaining({
      distill_summary: 'Chunked summary.',
      distill_created_from_hash: 'hash_chunked_1',
      distill_metadata: expect.objectContaining({
        model: 't2-synthesis',
        request_type: 'final_synthesis',
        chunking_strategy: 'structure_paragraph_window_v1',
      }),
    }));
  });

  test('batch execution mode uses batch-direct model route', async () => {
    const sendMessage = jest.fn().mockResolvedValue({
      text: buildFinalOutput(),
    });
    const persistTier2SyncSuccess = jest.fn().mockResolvedValue({ rowCount: 1 });

    jest.doMock('../../src/libs/config.js', () => ({
      getConfig: () => ({
        distill: {
          version: 'distill_v2',
          direct_chunk_threshold_words: 5000,
          models: {
            batch_direct: 't2-batch-direct',
          },
        },
      }),
    }));

    jest.doMock('../../src/server/db.js', () => ({
      getTier2SyncEntryByEntryId: async () => ({
        entry_id: 709,
        title: 'Batch mode sample',
        author: 'PKM',
        content_type: 'newsletter',
        clean_text: 'alpha insight appears in this clean source text for grounding checks.',
        clean_word_count: 12,
        content_hash: 'hash_batch_1',
      }),
      persistTier2SyncSuccess,
      persistTier2SyncFailure: jest.fn().mockResolvedValue({ rowCount: 0 }),
    }));

    jest.doMock('../../src/server/litellm-client.js', () => ({
      LiteLLMClient: jest.fn().mockImplementation(() => ({
        sendMessage,
      })),
    }));

    jest.doMock('../../src/server/logger/index.js', () => ({
      getLogger: () => createLoggerStub(),
    }));

    const { distillTier2SingleEntrySync } = require('../../src/server/tier2/service.js');
    const out = await distillTier2SingleEntrySync(709, { execution_mode: 'batch' });

    expect(out.status).toBe('completed');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1].model).toBe('t2-batch-direct');
  });

  test('validation failure persists failed status with validation error code', async () => {
    const sendMessage = jest.fn().mockResolvedValue({
      text: buildFinalOutput({
        distill_excerpt: 'ungrounded excerpt phrase',
      }),
    });
    const persistTier2SyncSuccess = jest.fn().mockResolvedValue({ rowCount: 0 });
    const persistTier2SyncFailure = jest.fn().mockResolvedValue({ rowCount: 1 });

    jest.doMock('../../src/libs/config.js', () => ({
      getConfig: () => ({
        distill: {
          direct_chunk_threshold_words: 5000,
          models: {
            sync_direct: 't2-sync-direct',
          },
        },
      }),
    }));

    jest.doMock('../../src/server/db.js', () => ({
      getTier2SyncEntryByEntryId: async () => ({
        entry_id: 703,
        title: 'Validation failure sample',
        author: 'PKM',
        content_type: 'newsletter',
        clean_text: 'alpha insight appears in this clean source text for grounding checks.',
        clean_word_count: 12,
        content_hash: 'hash_validation_1',
      }),
      persistTier2SyncSuccess,
      persistTier2SyncFailure,
    }));

    jest.doMock('../../src/server/litellm-client.js', () => ({
      LiteLLMClient: jest.fn().mockImplementation(() => ({
        sendMessage,
      })),
    }));

    jest.doMock('../../src/server/logger/index.js', () => ({
      getLogger: () => createLoggerStub(),
    }));

    const { distillTier2SingleEntrySync } = require('../../src/server/tier2/service.js');
    const out = await distillTier2SingleEntrySync(703, { retry_count: 2 });

    expect(out).toEqual({
      entry_id: 703,
      status: 'failed',
      summary: null,
      excerpt: null,
      why_it_matters: null,
      stance: null,
      error_code: 'excerpt_not_grounded',
    });
    expect(persistTier2SyncSuccess).not.toHaveBeenCalled();
    expect(persistTier2SyncFailure).toHaveBeenCalledTimes(1);
    expect(persistTier2SyncFailure).toHaveBeenCalledWith(703, expect.objectContaining({
      status: 'failed',
      metadata: expect.objectContaining({
        error: expect.objectContaining({
          code: 'excerpt_not_grounded',
        }),
        model: 't2-sync-direct',
        chunking_strategy: 'direct',
        retry_count: 2,
      }),
    }));
  });

  test('generation failure returns message and persists generation_error metadata', async () => {
    const sendMessage = jest.fn().mockRejectedValue(new Error('litellm offline'));
    const persistTier2SyncSuccess = jest.fn().mockResolvedValue({ rowCount: 0 });
    const persistTier2SyncFailure = jest.fn().mockResolvedValue({ rowCount: 1 });

    jest.doMock('../../src/libs/config.js', () => ({
      getConfig: () => ({
        distill: {
          direct_chunk_threshold_words: 5000,
          models: {
            sync_direct: 't2-sync-direct',
          },
        },
      }),
    }));

    jest.doMock('../../src/server/db.js', () => ({
      getTier2SyncEntryByEntryId: async () => ({
        entry_id: 704,
        title: 'Generation failure sample',
        author: 'PKM',
        content_type: 'newsletter',
        clean_text: 'alpha insight appears in this clean source text for grounding checks.',
        clean_word_count: 12,
        content_hash: 'hash_generation_1',
      }),
      persistTier2SyncSuccess,
      persistTier2SyncFailure,
    }));

    jest.doMock('../../src/server/litellm-client.js', () => ({
      LiteLLMClient: jest.fn().mockImplementation(() => ({
        sendMessage,
      })),
    }));

    jest.doMock('../../src/server/logger/index.js', () => ({
      getLogger: () => createLoggerStub(),
    }));

    const { distillTier2SingleEntrySync } = require('../../src/server/tier2/service.js');
    const out = await distillTier2SingleEntrySync(704, { retry_count: 3 });

    expect(out).toEqual({
      entry_id: 704,
      status: 'failed',
      summary: null,
      excerpt: null,
      why_it_matters: null,
      stance: null,
      error_code: 'generation_error',
      message: 'litellm offline',
    });
    expect(persistTier2SyncSuccess).not.toHaveBeenCalled();
    expect(persistTier2SyncFailure).toHaveBeenCalledTimes(1);
    expect(persistTier2SyncFailure).toHaveBeenCalledWith(704, expect.objectContaining({
      status: 'failed',
      metadata: expect.objectContaining({
        error: expect.objectContaining({
          code: 'generation_error',
          details: expect.objectContaining({
            message: 'litellm offline',
          }),
        }),
        model: null,
        chunking_strategy: null,
        retry_count: 3,
      }),
    }));
  });

  test('preserves current completed artifact on generation failure', async () => {
    const sendMessage = jest.fn().mockRejectedValue(new Error('litellm timeout'));
    const persistTier2SyncSuccess = jest.fn().mockResolvedValue({ rowCount: 0 });
    const persistTier2SyncFailure = jest.fn().mockResolvedValue({ rowCount: 1 });

    jest.doMock('../../src/libs/config.js', () => ({
      getConfig: () => ({
        distill: {
          direct_chunk_threshold_words: 5000,
          models: {
            sync_direct: 't2-sync-direct',
          },
        },
      }),
    }));

    jest.doMock('../../src/server/db.js', () => ({
      getTier2SyncEntryByEntryId: async () => ({
        entry_id: 706,
        title: 'Current completed artifact',
        author: 'PKM',
        content_type: 'newsletter',
        clean_text: 'alpha insight appears in this clean source text for grounding checks.',
        clean_word_count: 12,
        content_hash: 'hash_completed_1',
        distill_status: 'completed',
        distill_created_from_hash: 'hash_completed_1',
      }),
      persistTier2SyncSuccess,
      persistTier2SyncFailure,
    }));

    jest.doMock('../../src/server/litellm-client.js', () => ({
      LiteLLMClient: jest.fn().mockImplementation(() => ({
        sendMessage,
      })),
    }));

    jest.doMock('../../src/server/logger/index.js', () => ({
      getLogger: () => createLoggerStub(),
    }));

    const { distillTier2SingleEntrySync } = require('../../src/server/tier2/service.js');
    const out = await distillTier2SingleEntrySync(706);

    expect(out).toEqual({
      entry_id: 706,
      status: 'failed',
      summary: null,
      excerpt: null,
      why_it_matters: null,
      stance: null,
      error_code: 'generation_error',
      message: 'litellm timeout',
      preserved_current_artifact: true,
    });
    expect(persistTier2SyncFailure).not.toHaveBeenCalled();
    expect(persistTier2SyncSuccess).not.toHaveBeenCalled();
  });

  test('preserves current completed artifact on validation failure', async () => {
    const sendMessage = jest.fn().mockResolvedValue({
      text: buildFinalOutput({
        distill_excerpt: 'ungrounded excerpt phrase',
      }),
    });
    const persistTier2SyncSuccess = jest.fn().mockResolvedValue({ rowCount: 0 });
    const persistTier2SyncFailure = jest.fn().mockResolvedValue({ rowCount: 1 });

    jest.doMock('../../src/libs/config.js', () => ({
      getConfig: () => ({
        distill: {
          direct_chunk_threshold_words: 5000,
          models: {
            sync_direct: 't2-sync-direct',
          },
        },
      }),
    }));

    jest.doMock('../../src/server/db.js', () => ({
      getTier2SyncEntryByEntryId: async () => ({
        entry_id: 707,
        title: 'Current completed artifact',
        author: 'PKM',
        content_type: 'newsletter',
        clean_text: 'alpha insight appears in this clean source text for grounding checks.',
        clean_word_count: 12,
        content_hash: 'hash_completed_2',
        distill_status: 'completed',
        distill_created_from_hash: 'hash_completed_2',
      }),
      persistTier2SyncSuccess,
      persistTier2SyncFailure,
    }));

    jest.doMock('../../src/server/litellm-client.js', () => ({
      LiteLLMClient: jest.fn().mockImplementation(() => ({
        sendMessage,
      })),
    }));

    jest.doMock('../../src/server/logger/index.js', () => ({
      getLogger: () => createLoggerStub(),
    }));

    const { distillTier2SingleEntrySync } = require('../../src/server/tier2/service.js');
    const out = await distillTier2SingleEntrySync(707);

    expect(out).toEqual({
      entry_id: 707,
      status: 'failed',
      summary: null,
      excerpt: null,
      why_it_matters: null,
      stance: null,
      error_code: 'excerpt_not_grounded',
      preserved_current_artifact: true,
    });
    expect(persistTier2SyncFailure).not.toHaveBeenCalled();
    expect(persistTier2SyncSuccess).not.toHaveBeenCalled();
  });

  test('currentness mismatch returns failed status without overriding row', async () => {
    const sendMessage = jest.fn().mockResolvedValue({
      text: buildFinalOutput(),
    });
    const persistTier2SyncSuccess = jest.fn().mockResolvedValue({ rowCount: 0 });
    const persistTier2SyncFailure = jest.fn().mockResolvedValue({ rowCount: 0 });

    jest.doMock('../../src/libs/config.js', () => ({
      getConfig: () => ({
        distill: {
          direct_chunk_threshold_words: 5000,
          models: {
            sync_direct: 't2-sync-direct',
          },
        },
      }),
    }));

    jest.doMock('../../src/server/db.js', () => ({
      getTier2SyncEntryByEntryId: async () => ({
        entry_id: 705,
        title: 'Currentness mismatch sample',
        author: 'PKM',
        content_type: 'newsletter',
        clean_text: 'alpha insight appears in this clean source text for grounding checks.',
        clean_word_count: 12,
        content_hash: 'hash_before_generation',
      }),
      persistTier2SyncSuccess,
      persistTier2SyncFailure,
    }));

    jest.doMock('../../src/server/litellm-client.js', () => ({
      LiteLLMClient: jest.fn().mockImplementation(() => ({
        sendMessage,
      })),
    }));

    jest.doMock('../../src/server/logger/index.js', () => ({
      getLogger: () => createLoggerStub(),
    }));

    const { distillTier2SingleEntrySync } = require('../../src/server/tier2/service.js');
    const out = await distillTier2SingleEntrySync(705);

    expect(out).toEqual({
      entry_id: 705,
      status: 'failed',
      summary: null,
      excerpt: null,
      why_it_matters: null,
      stance: null,
      error_code: 'currentness_mismatch',
      message: 'entry content changed during distillation; no write was applied',
    });
    expect(persistTier2SyncSuccess).toHaveBeenCalledTimes(1);
    expect(persistTier2SyncFailure).not.toHaveBeenCalled();
  });

  test('sync succeeds for rows without content_hash when persist accepts null currentness', async () => {
    const sendMessage = jest.fn().mockResolvedValue({
      text: buildFinalOutput(),
    });
    const persistTier2SyncSuccess = jest.fn().mockResolvedValue({ rowCount: 1 });
    const persistTier2SyncFailure = jest.fn().mockResolvedValue({ rowCount: 0 });

    jest.doMock('../../src/libs/config.js', () => ({
      getConfig: () => ({
        distill: {
          direct_chunk_threshold_words: 5000,
          models: {
            sync_direct: 't2-sync-direct',
          },
        },
      }),
    }));

    jest.doMock('../../src/server/db.js', () => ({
      getTier2SyncEntryByEntryId: async () => ({
        entry_id: 708,
        title: 'Null hash sample',
        author: 'PKM',
        content_type: 'newsletter',
        clean_text: 'alpha insight appears in this clean source text for grounding checks.',
        clean_word_count: 12,
        content_hash: null,
      }),
      persistTier2SyncSuccess,
      persistTier2SyncFailure,
    }));

    jest.doMock('../../src/server/litellm-client.js', () => ({
      LiteLLMClient: jest.fn().mockImplementation(() => ({
        sendMessage,
      })),
    }));

    jest.doMock('../../src/server/logger/index.js', () => ({
      getLogger: () => createLoggerStub(),
    }));

    const { distillTier2SingleEntrySync } = require('../../src/server/tier2/service.js');
    const out = await distillTier2SingleEntrySync(708);

    expect(out.status).toBe('completed');
    expect(persistTier2SyncSuccess).toHaveBeenCalledTimes(1);
    expect(persistTier2SyncFailure).not.toHaveBeenCalled();
  });
});
