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
});
