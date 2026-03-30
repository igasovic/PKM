'use strict';

const extractFailureContext = require('../../src/n8n/nodes/99-error-handling/extract-failure-context__9a3df598-56e7-4f09-8ce2-086c7b8285b2.js');
const checkIgnoreRules = require('../../src/n8n/nodes/99-error-handling/check-ignore-rules__7f65eb87-fad0-425d-850c-e31e1981f7f9.js');
const runSmokeCleanup = require('../../src/n8n/nodes/99-error-handling/run-smoke-cleanup__1e49beef-0ce8-4fc3-aa2f-cf298f3537ff.js');
const composeMessage = require('../../src/n8n/nodes/99-error-handling/compose-message__566912ab-5d96-4405-8443-6a296ef03366.js');

describe('n8n wf99 error handling nodes', () => {
  test('extract failure context resolves node name from stack path', async () => {
    const out = await extractFailureContext({
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
    expect(out[0].json.node_name).toBe('Prepare Finalize Request');
    expect(out[0].json.node_name).not.toBe('unknown-node');
  });

  test('ignore rules suppress appendix 1 imap trigger noise', async () => {
    const out = await checkIgnoreRules({
      $json: {
        workflow_name: '03 E-Mail Capture',
        error_message: 'There was a problem with the trigger node "Email Trigger (IMAP)1", for that reason did the workflow had to be deactivated',
      },
    });

    expect(out[0].json.ignored_error).toBe(true);
    expect(out[0].json.ignore_rule_id).toBe('wf03_imap_trigger_auto_deactivation');
  });

  test('ignore rules suppress appendix 2 notion gateway timeout', async () => {
    const out = await checkIgnoreRules({
      $json: {
        workflow_name: '04 Notion Capture',
        error_message: 'Gateway timed out - perhaps try again later?',
      },
    });

    expect(out[0].json.ignored_error).toBe(true);
    expect(out[0].json.ignore_rule_id).toBe('wf04_gateway_timeout_retry_later');
  });

  test('smoke cleanup path still reports cleanup details in composed message', async () => {
    const requests = [];

    const cleaned = await runSmokeCleanup({
      $json: {
        is_smoke_master_error: true,
        error_event: {
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
        error_message: 'Smoke run failed: 1 test(s) failed',
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

    const composed = await composeMessage({
      $json: {
        workflow_name: '00 Smoke - Master',
        workflow_id: '2DB1S0mq7UQN4U3InXRM0',
        node_name: 'Fail Smoke Run',
        failed_at: '2026-03-30T00:32:43.076Z',
        error_message: 'Smoke run failed: 1 test(s) failed',
        execution_id: 'unknown',
        execution_url: null,
        run_id: 'n8n-error-1774830763078',
        failure_pack_post: {
          ok: true,
          error: '',
          failure_id: 'f23701d2-83f7-43bb-ab29-e4ae3df232bd',
          run_id: 'n8n-error-1774830763078',
          upsert_action: 'inserted',
          status: 'captured',
        },
        smoke_cleanup_summary: cleaned[0].json.smoke_cleanup_summary,
      },
    });

    const deleteCall = requests.find((request) => request.method === 'POST' && request.url.endsWith('/db/delete'));
    expect(deleteCall.body.entry_ids).toEqual([21, 22, 23]);

    const message = composed[0].json.telegram_message;
    expect(message).toContain('Smoke cleanup: ok');
    expect(message).toContain('Deleted IDs: 21,22,23');
  });
});
