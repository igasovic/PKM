'use strict';

const composeErrorMessage = require('../../src/n8n/nodes/99-error-handling/compose-message__566912ab-5d96-4405-8443-6a296ef03366.js');

describe('n8n error handling message formatter', () => {
  test('extracts node name from stack path instead of unknown-node', async () => {
    const out = await composeErrorMessage({
      $json: {
        execution: {
          id: '3182',
          url: 'https://n8n-hook.gasovic.com/workflow/_NgZy8xU5XGXrBeBjl2cp/executions/3182',
          error: {
            executionId: '3183',
            workflowId: 'valOh9zMfqOZOvmHyOQfa',
            message: 'request_id is required to finalize calendar create',
            stack: 'Error: request_id is required to finalize calendar create\\n    at run (/data/src/n8n/nodes/30-calendar-create/prepare-finalize-request__4c9a5cd8-7c13-4ad8-8d1c-a10f2f23520b.js:16:25)',
          },
        },
        workflow: {
          id: '_NgZy8xU5XGXrBeBjl2cp',
          name: '01 Telegram Router',
        },
      },
    });

    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    const message = out[0].json.telegram_message;
    expect(message).toContain('Prepare Finalize Request');
    expect(message).not.toContain('unknown-node');
  });

  test('suppresses imap trigger auto-deactivation noise', async () => {
    const out = await composeErrorMessage({
      $json: {
        execution: {
          id: '5000',
          error: {
            message: 'There was a problem with the trigger node \"Email Trigger (IMAP)1\", for that reason did the workflow had to be deactivated',
          },
        },
      },
    });

    expect(out).toEqual([]);
  });

  test('smoke master failures run cleanup with recovered smoke state', async () => {
    const requests = [];
    const out = await composeErrorMessage({
      $json: {
        workflow: {
          id: '2DB1S0mq7UQN4U3InXRM0',
          name: '00 Smoke - Master',
        },
        execution: {
          id: '8123',
          error: {
            message: 'Smoke run failed: 1 test(s) failed',
          },
        },
        test_run_id: 'smoke_2026_03_18_000003',
        prior_test_mode: false,
        results: [
          { test_case: 'T04-telegram-capture', artifacts: { entry_id: 21 } },
          { test_case: 'T05-email-capture', artifacts: { entry_ids: [22, 23] } },
        ],
        artifacts: {
          created_entry_ids: [21, 22, 23],
        },
      },
      $env: {
        PKM_ADMIN_SECRET: 'secret',
      },
      helpers: {
        httpRequest: async (request) => {
          requests.push(request);
          if (request.method === 'POST' && request.url.endsWith('/db/delete')) {
            return { deleted_count: 3 };
          }
          if (request.method === 'GET' && request.url.endsWith('/db/test-mode')) {
            return [{ is_test_mode: false }];
          }
          throw new Error(`Unexpected request: ${request.method} ${request.url}`);
        },
      },
    });

    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);

    const deleteCall = requests.find((request) => request.method === 'POST' && request.url.endsWith('/db/delete'));
    expect(deleteCall.body.entry_ids).toEqual([21, 22, 23]);

    const message = out[0].json.telegram_message;
    expect(message).toContain('Smoke cleanup: ok');
    expect(message).toContain('Deleted IDs: 21,22,23');
  });
});
