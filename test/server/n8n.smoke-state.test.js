'use strict';

const { requireExternalizedNode } = require('./n8n-node-loader');

const recordStep = requireExternalizedNode('00-smoke-master', 'record-step');
const { collectEntryIds } = requireExternalizedNode('00-smoke-master', 'smoke-state');
const cleanupSmokeRun = requireExternalizedNode('00-smoke-master', 't99-cleanup');

describe('n8n smoke state helpers', () => {
  test('record step rebuilds prior smoke state from build node output', async () => {
    const out = await recordStep({
      $json: {
        current_test_case: 'T04-telegram-capture',
        ok: true,
        assertions: [{ name: 'capture_ok', ok: true }],
        artifacts: {
          entry_id: 42,
          telegram_message: 'saved',
        },
      },
      $items: (nodeName) => {
        if (nodeName === 'Build T04 Capture Fixture') {
          return [{
            json: {
              test_run_id: 'smoke_2026_03_18_000001',
              results: [{ test_case: 'T03-router-capture', ok: true }],
              artifacts: {
                email_capture_entry_id: 7,
                created_entry_ids: [7],
              },
            },
          }];
        }
        return [];
      },
    }, {
      buildNodeName: 'Build T04 Capture Fixture',
      defaultCaseName: 'T04-telegram-capture',
      defaultAssertionName: 'capture_execution_ok',
      artifactAliases: {
        entry_id: 'telegram_capture_entry_id',
      },
    });

    const row = out[0].json;
    expect(row.results).toHaveLength(2);
    expect(row.results[0].test_case).toBe('T03-router-capture');
    expect(row.results[1]).toEqual(expect.objectContaining({
      test_case: 'T04-telegram-capture',
      ok: true,
    }));
    expect(row.artifacts).toEqual(expect.objectContaining({
      email_capture_entry_id: 7,
      telegram_capture_entry_id: 42,
      created_entry_ids: [7, 42],
    }));
  });

  test('collectEntryIds walks nested smoke results and artifacts', () => {
    expect(collectEntryIds(
      { entry_id: '11' },
      { artifacts: { entry_ids: [12, '13', 'not-a-number'] } },
      [{ artifacts: { entry_id: 14 } }],
    )).toEqual([11, 12, 13, 14]);
  });

  test('cleanup deletes every collected smoke entry id and restores test mode independently', async () => {
    const calls = [];
    const out = await cleanupSmokeRun({
      $json: {
        test_run_id: 'smoke_2026_03_18_000002',
        prior_test_mode: false,
        artifacts: {
          created_entry_ids: [11, 12],
          telegram_capture_entry_id: 11,
        },
        results: [
          { artifacts: { entry_id: 13 } },
          { artifacts: { entry_ids: [12, 14] } },
        ],
      },
      $env: {
        PKM_ADMIN_SECRET: 'secret',
      },
      helpers: {
        httpRequest: async (request) => {
          calls.push(request);
          if (request.method === 'GET' && request.url.endsWith('/db/test-mode')) {
            return [{ is_test_mode: true }];
          }
          if (request.method === 'POST' && request.url.endsWith('/db/test-mode/toggle')) {
            return [{ is_test_mode: false }];
          }
          if (request.method === 'POST' && request.url.endsWith('/db/delete')) {
            return { deleted_count: 4 };
          }
          throw new Error(`Unexpected request: ${request.method} ${request.url}`);
        },
      },
    });

    const row = out[0].json;
    const deleteCall = calls.find((request) => request.method === 'POST' && request.url.endsWith('/db/delete'));
    expect(deleteCall.body.entry_ids).toEqual([11, 12, 13, 14]);

    const cleanupResult = row.results.find((result) => result.test_case === 'T99-cleanup');
    expect(cleanupResult).toEqual(expect.objectContaining({
      ok: true,
      artifacts: expect.objectContaining({
        deleted_ids: [11, 12, 13, 14],
      }),
    }));
  });
});
