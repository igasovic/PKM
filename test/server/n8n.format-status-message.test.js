'use strict';

const formatStatusMessage = require('../../src/n8n/nodes/10-read/format-status-message__075f1d02-d3af-43dc-a694-f387f757ba3d.js');

describe('n8n format-status-message', () => {
  test('formats generic batch summary', async () => {
    const out = await formatStatusMessage({
      $json: {
        summary: {
          jobs: 2,
          in_progress: 1,
          terminal: 1,
          total_items: 15,
          processed: 10,
          pending: 5,
          ok: 8,
          parse_error: 1,
          error: 1,
        },
        jobs: [],
      },
    });

    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    const message = out[0].json.telegram_message;
    expect(message).toContain('*Batch summary*');
    expect(message).toContain('*Jobs:* 2');
    expect(message).toContain('• Pending: 5');
    expect(message).not.toContain('Would process');
  });

  test('includes dry-run planned count when available', async () => {
    const out = await formatStatusMessage({
      $json: {
        summary: {
          jobs: 1,
          in_progress: 0,
          terminal: 1,
          total_items: 10,
          processed: 0,
          pending: 0,
          ok: 0,
          parse_error: 0,
          error: 0,
        },
        jobs: [
          {
            status: 'dry_run',
            metadata: {
              will_process_count: 10,
            },
          },
        ],
      },
    });

    expect(out).toHaveLength(1);
    const message = out[0].json.telegram_message;
    expect(message).toContain('• Pending: 0');
    expect(message).toContain('• Would process \\(dry\\_run\\): 10');
  });

  test('includes preserved-current aggregate when available', async () => {
    const out = await formatStatusMessage({
      $json: {
        summary: {
          jobs: 2,
          in_progress: 0,
          terminal: 2,
          total_items: 2,
          processed: 2,
          pending: 0,
          ok: 0,
          parse_error: 0,
          error: 2,
        },
        jobs: [
          { status: 'failed', metadata: { preserved_current_count: 1 } },
          { status: 'partial_failed', metadata: { preserved_current_count: 2 } },
        ],
      },
    });

    const message = out[0].json.telegram_message;
    expect(message).toContain('❌ Error: 2');
    expect(message).toContain('• Preserved current: 3');
  });
});
