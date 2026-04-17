'use strict';

const fs = require('fs');
const path = require('path');
const { loadInlineCodeNode, requireExternalizedNode } = require('./n8n-node-loader');

const WORKFLOWS_DIR = path.join(__dirname, '..', '..', 'src', 'n8n', 'workflows');

function findWorkflowFile(prefix) {
  const matches = fs.readdirSync(WORKFLOWS_DIR)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
    .sort();
  if (matches.length !== 1) {
    throw new Error(`expected exactly one workflow file for ${prefix}, found ${matches.length}`);
  }
  return path.join(WORKFLOWS_DIR, matches[0]);
}

function loadWorkflow(prefix) {
  const filePath = findWorkflowFile(prefix);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

describe('n8n WF99 error handling', () => {
  const wf99ExtractFailureContext = requireExternalizedNode('99-error-handling', 'extract-failure-context');
  const wf99BuildFailurePackEnvelope = requireExternalizedNode('99-error-handling', 'build-failure-pack-envelope');
  const wf99ComposeMessage = requireExternalizedNode('99-error-handling', 'compose-message');

  const checkIgnoreRules = loadInlineCodeNode('99-error-handling', 'Check Ignore Rules');
  const finalizeFailurePackResult = loadInlineCodeNode('99-error-handling', 'Finalize Failure Pack Result');
  const runSmokeCleanup = loadInlineCodeNode('99-error-handling', 'Run Smoke Cleanup');

  test('workflow wiring preserves ignore short-circuit and failure-pack post path', () => {
    const wf99 = loadWorkflow('99-error-handling__');
    const byName = new Map(wf99.nodes.map((node) => [node.name, node]));

    const ifMain = wf99.connections['IF Ignore Error'].main;
    expect(ifMain[0]).toEqual([]);
    expect(ifMain[1][0].node).toBe('Build Failure Pack Envelope');

    expect(wf99.connections['Build Failure Pack Envelope'].main[0].map((e) => e.node).sort())
      .toEqual(['Merge Pack Context', 'Store Failure Pack']);
    expect(wf99.connections['Store Failure Pack'].main[0][0].node).toBe('Merge Pack Context');
    expect(wf99.connections['Merge Pack Context'].main[0][0].node).toBe('Finalize Failure Pack Result');

    const storeNode = byName.get('Store Failure Pack');
    expect(storeNode.type).toBe('n8n-nodes-base.httpRequest');
    expect(storeNode.onError).toBe('continueRegularOutput');
    expect(storeNode.parameters.url).toBe('http://pkm-server:8080/debug/failures');
    expect(storeNode.parameters.options.ignoreResponseCode).toBe(true);
    expect(storeNode.parameters.jsonBody).toContain('failure_pack_envelope');

    const headerParams = storeNode.parameters.headerParameters.parameters;
    const headerNames = headerParams.map((p) => p.name);
    expect(headerNames).toContain('x-pkm-admin-secret');
    expect(headerNames).toContain('X-PKM-Run-Id');

    const sendNode = byName.get('Send a text message');
    expect(sendNode.parameters.additionalFields.parse_mode).toBe('MarkdownV2');
    expect(sendNode.parameters.text).toBe('={{ $json.telegram_message }}');
  });

  test('WF99 inline code nodes do not depend on legacy ctx runtime shims', () => {
    const wf99 = loadWorkflow('99-error-handling__');
    const inlineCodeNodes = wf99.nodes.filter((node) => node.type === 'n8n-nodes-base.code' && typeof node.parameters?.jsCode === 'string');

    inlineCodeNodes.forEach((node) => {
      expect(node.parameters.jsCode).not.toContain('(ctx && ctx.$json)');
      expect(node.parameters.jsCode).not.toContain('ctx || {}');
    });
  });

  test('Check Ignore Rules marks known rule match and leaves non-matches active', async () => {
    const matched = await checkIgnoreRules({
      $json: {
        workflow_name: '03 E-Mail Capture',
        error_message: 'There was a problem with the trigger node. Email Trigger (IMAP). Workflow had to be deactivated.',
      },
    });

    expect(matched[0].json.ignored_error).toBe(true);
    expect(matched[0].json.ignore_rule_id).toBe('wf03_imap_trigger_auto_deactivation');

    const missed = await checkIgnoreRules({
      $json: {
        workflow_name: '10 Read',
        error_message: 'Unexpected token in JSON at position 1',
      },
    });

    expect(missed[0].json.ignored_error).toBe(false);
    expect(missed[0].json.ignore_rule_id).toBeNull();
    expect(missed[0].json.ignore_reason).toBeNull();
  });

  test('Finalize Failure Pack Result normalizes success and failure outcomes', async () => {
    const success = await finalizeFailurePackResult({
      $json: {
        statusCode: 200,
        body: {
          failure_id: 'failure-1',
          run_id: 'run-1',
          status: 'captured',
          upsert_action: 'inserted',
        },
        failure_pack_envelope: {
          status: 'captured',
        },
      },
    });

    expect(success[0].json.failure_pack_post).toEqual({
      ok: true,
      error: '',
      failure_id: 'failure-1',
      run_id: 'run-1',
      upsert_action: 'inserted',
      status: 'captured',
    });

    const failed = await finalizeFailurePackResult({
      $json: {
        statusCode: 502,
        body: { message: 'gateway timeout' },
        failure_pack_envelope: { status: 'partial' },
        run_id: 'run-2',
      },
    });

    expect(failed[0].json.failure_pack_post.ok).toBe(false);
    expect(failed[0].json.failure_pack_post.error).toBe('gateway timeout');
    expect(failed[0].json.failure_pack_post.failure_id).toBeNull();
    expect(failed[0].json.failure_pack_post.run_id).toBe('run-2');
    expect(failed[0].json.failure_pack_post.status).toBe('partial');
  });

  test('Run Smoke Cleanup keeps payload and sets explicit smoke cleanup summary placeholder', async () => {
    const out = await runSmokeCleanup({
      $json: {
        run_id: 'run-123',
        workflow_name: 'WF Test',
      },
    });

    expect(out[0].json.run_id).toBe('run-123');
    expect(out[0].json.workflow_name).toBe('WF Test');
    expect(out[0].json.smoke_cleanup_summary).toBeNull();
  });

  test('extract-failure-context enriches Telegram markdown parse failures', async () => {
    const out = await wf99ExtractFailureContext({
      $json: {
        workflow: {
          name: '99 Error Handling',
          id: 'wf99-id',
        },
        execution: {
          id: '901',
          url: '/execution/901',
          startedAt: '2026-04-17T05:00:00.000Z',
          error: {
            node: {
              name: 'Send a text message',
              type: 'n8n-nodes-base.telegram',
            },
            message: 'Bad request - please check your parameters',
            description: "Bad Request: can't parse entities: Character '[' is reserved and must be escaped with the preceding '\\\\'",
            stack: '[extjs:99-error-handling/compose-message__566912ab-5d96-4405-8443-6a296ef03366.js] trace',
          },
        },
        run_id: 'run-telegram-1',
      },
    });

    const row = out[0].json;
    expect(row.workflow_name).toBe('99 Error Handling');
    expect(row.workflow_id).toBe('wf99-id');
    expect(row.execution_id).toBe('901');
    expect(row.execution_url).toBe('/execution/901');
    expect(row.run_id).toBe('run-telegram-1');
    expect(row.node_name).toBe('Send a text message');
    expect(row.error_message).toContain("Bad request - please check your parameters: Bad Request: can't parse entities");
    expect(row.telegram_error).toEqual(expect.objectContaining({
      provider: 'telegram',
      is_markdownv2_parse_error: true,
      reserved_character: '[',
    }));
  });

  test('extract-failure-context resolves node name from extjs marker when explicit node is missing', async () => {
    const out = await wf99ExtractFailureContext({
      $json: {
        workflow: {
          name: '99 Error Handling',
          id: 'wf99-id',
        },
        execution: {
          id: '902',
          startedAt: '2026-04-17T05:00:00.000Z',
          error: {
            message: 'wrapper error',
            stack: '[extjs:99-error-handling/compose-message__566912ab-5d96-4405-8443-6a296ef03366.js] trace',
          },
        },
        run_id: 'run-extjs-1',
      },
    });

    expect(out[0].json.node_name).toBe('Compose Message');
    expect(out[0].json.run_id).toBe('run-extjs-1');
  });

  test('build-failure-pack-envelope captures redacted payloads and parent deltas', async () => {
    const out = await wf99BuildFailurePackEnvelope({
      $json: {
        workflow_name: '10 Read',
        workflow_id: 'wf10-id',
        node_name: 'HTTP Request',
        error_message: 'http 500',
        failed_at: '2026-04-17T05:01:00.000Z',
        execution_id: '777',
        run_id: 'run-pack-1',
        created_at_iso: '2026-04-17T05:01:05.000Z',
        error_event: {
          mode: 'production',
          nodes: [
            { name: 'Build Payload', type: 'n8n-nodes-base.code' },
            { name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest' },
          ],
          execution: {
            data: {
              resultData: {
                runData: {
                  'HTTP Request': [
                    {
                      inputData: {
                        main: [[
                          {
                            json: {
                              authorization: 'Bearer abc123',
                              same: 'keep',
                              detail: 'failing-input',
                            },
                          },
                        ]],
                      },
                      source: {
                        main: [[{ previousNode: 'Build Payload' }]],
                      },
                    },
                  ],
                  'Build Payload': [
                    {
                      inputData: {
                        main: [[
                          {
                            json: {
                              same: 'keep',
                              parent_only: 'upstream-context',
                              password: 'super-secret',
                            },
                          },
                        ]],
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    });

    const row = out[0].json;
    const envelope = row.failure_pack_envelope;

    expect(envelope.run_id).toBe('run-pack-1');
    expect(envelope.status).toBe('captured');
    expect(envelope.graph.failing_node).toBe('HTTP Request');
    expect(envelope.graph.direct_parents).toEqual([
      {
        node_name: 'Build Payload',
        node_type: 'n8n-nodes-base.code',
        branch_index: 0,
      },
    ]);

    expect(envelope.payloads.failing_node_input.item_count).toBe(1);
    expect(envelope.payloads.failing_node_input.items[0].json.authorization).toBe('Bearer [REDACTED]');

    const parentNode = envelope.payloads.upstream_context.nodes[0];
    expect(parentNode.node_name).toBe('Build Payload');
    expect(parentNode.items[0].duplicate_paths_omitted).toContain('same');
    expect(parentNode.items[0].json_delta).toEqual(expect.objectContaining({
      parent_only: 'upstream-context',
      password: '[REDACTED]',
    }));

    expect(envelope.artifacts).toEqual([]);
    expect(row.sidecar_write_errors).toEqual([]);
    expect(row.failure_pack_post).toEqual(expect.objectContaining({
      ok: false,
      error: 'not_posted',
      run_id: 'run-pack-1',
      status: 'captured',
    }));
  });

  test('compose-message returns markdown-safe text and normalized failure_pack summary', async () => {
    const out = await wf99ComposeMessage({
      $json: {
        workflow_name: '10 Read',
        node_name: 'Build Message',
        failed_at: '2026-04-17T05:02:00.000Z',
        error_message: 'bad [markdown] payload',
        execution_id: '881',
        run_id: 'run-message-1',
        failure_pack_post: {
          ok: false,
          error: 'http 500',
          failure_id: null,
          run_id: 'run-message-1',
          upsert_action: null,
          status: 'partial',
        },
        sidecar_write_errors: ['disk write denied'],
        smoke_cleanup_summary: {
          ok: false,
          runId: 'run-message-1',
          deletedIds: ['100', '101'],
          cleanupError: 'cleanup failed [dry-run]',
        },
      },
    });

    const row = out[0].json;
    expect(row.telegram_message).toContain('Failure pack: failed');
    expect(row.telegram_message).toContain('bad \\[markdown\\] payload');
    expect(row.telegram_message).toContain('Cleanup error: cleanup failed \\[dry\\-run\\]');
    expect(row.failure_pack).toEqual({
      run_id: 'run-message-1',
      failure_id: null,
      status: 'partial',
      ok: false,
    });
  });
});
