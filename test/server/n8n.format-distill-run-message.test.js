'use strict';

const formatDistillRunMessage = require('../../src/n8n/nodes/10-read/format-distill-run-message__b9f00fcd-a5ed-462f-a8d0-3e49c20eca11.js');

describe('n8n format-distill-run-message', () => {
  test('formats worker-busy skip response safely for markdownv2', async () => {
    const out = await formatDistillRunMessage({
      $json: {
        mode: 'skipped',
        skipped: true,
        reason: 'worker_busy',
        message: 'Tier-2 batch worker is busy. Try again shortly.',
      },
    });

    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0].json.telegram_message).toContain('*Tier\\_2 run skipped*');
    expect(out[0].json.telegram_message).toContain('Reason: worker\\_busy');
    expect(out[0].json.telegram_message).toContain('Tier\\-2 batch worker is busy\\. Try again shortly\\.');
  });

  test('formats run-level errors with batch id and message', async () => {
    const out = await formatDistillRunMessage({
      $json: {
        mode: 'run',
        batch_id: 't2_123_abcd',
        error: 'planner failed: timeout',
      },
    });

    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0].json.telegram_message).toContain('*Tier\\_2 run failed*');
    expect(out[0].json.telegram_message).toContain('Batch\\_id: t2\\_123\\_abcd');
    expect(out[0].json.telegram_message).toContain('Error: planner failed: timeout');
  });

  test('formats successful run with batch_id for status follow-up', async () => {
    const out = await formatDistillRunMessage({
      $json: {
        mode: 'run',
        batch_id: 't2_1700000000_ab12cd',
        candidate_count: 20,
        planned_selected_count: 10,
        processed_count: 10,
        completed_count: 9,
        failed_count: 1,
        decision_counts: { proceed: 15, skipped: 3, not_eligible: 2 },
      },
    });

    expect(out).toHaveLength(1);
    expect(out[0].json.telegram_message).toContain('*Tier\\_2 run *');
    expect(out[0].json.telegram_message).toContain('*Batch\\_id:* t2\\_1700000000\\_ab12cd');
    expect(out[0].json.telegram_message).toContain('*Execution:* batch');
    expect(out[0].json.telegram_message).toContain('*Processed:* 10');
  });

  test('includes preserved-current count when failed results carry marker', async () => {
    const out = await formatDistillRunMessage({
      $json: {
        mode: 'run',
        batch_id: 't2_1700000000_xy12ab',
        candidate_count: 1,
        planned_selected_count: 1,
        processed_count: 1,
        completed_count: 0,
        failed_count: 1,
        decision_counts: { proceed: 1, skipped: 0, not_eligible: 0 },
        results: [
          {
            entry_id: 701,
            status: 'failed',
            error_code: 'generation_error',
            preserved_current_artifact: true,
          },
        ],
      },
    });

    expect(out).toHaveLength(1);
    expect(out[0].json.telegram_message).toContain('Failed: 1');
    expect(out[0].json.telegram_message).toContain('Preserved current: 1');
  });

  test('uses preserved_current_count field when results are omitted', async () => {
    const out = await formatDistillRunMessage({
      $json: {
        mode: 'run',
        batch_id: 't2_1700000000_zz11yy',
        candidate_count: 2,
        planned_selected_count: 2,
        processed_count: 2,
        completed_count: 0,
        failed_count: 2,
        preserved_current_count: 1,
        decision_counts: { proceed: 2, skipped: 0, not_eligible: 0 },
      },
    });

    expect(out).toHaveLength(1);
    expect(out[0].json.telegram_message).toContain('Failed: 2');
    expect(out[0].json.telegram_message).toContain('Preserved current: 1');
  });

  test('shows top failure code counts and sync execution mode when provided', async () => {
    const out = await formatDistillRunMessage({
      $json: {
        mode: 'run',
        execution_mode: 'sync',
        candidate_count: 4,
        planned_selected_count: 4,
        processed_count: 4,
        completed_count: 1,
        failed_count: 3,
        decision_counts: { proceed: 4, skipped: 0, not_eligible: 0 },
        error_code_counts: {
          excerpt_not_grounded: 2,
          generation_error: 1,
        },
      },
    });

    expect(out).toHaveLength(1);
    expect(out[0].json.telegram_message).toContain('*Execution:* sync');
    expect(out[0].json.telegram_message).toContain('Top failures: excerpt\\_not\\_grounded (2), generation\\_error (1)');
  });
});
