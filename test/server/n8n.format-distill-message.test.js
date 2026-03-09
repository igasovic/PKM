'use strict';

const formatDistillMessage = require('../../src/n8n/nodes/10-read/format-distill-message__ef76e14a-f96e-4cb2-90da-c1b8f6fd2fca.js');

describe('n8n format-distill-message', () => {
  test('formats completed payload with summary, why_it_matters, and excerpt', async () => {
    const out = await formatDistillMessage({
      $json: {
        entry_id: 794,
        status: 'completed',
        stance: 'analytical',
        summary: 'Primary summary.',
        why_it_matters: 'Important for retrieval.',
        excerpt: 'Grounded source sentence.',
      },
    });

    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    const message = out[0].json.telegram_message;
    expect(message).toContain('*Tier\\_2 distill completed*');
    expect(message).toContain('*Summary*');
    expect(message).toContain('Primary summary\\.');
    expect(message).toContain('*Why it matters*');
    expect(message).toContain('Important for retrieval\\.');
    expect(message).toContain('*Excerpt*');
    expect(message).toContain('Grounded source sentence\\.');
  });

  test('omits excerpt block when excerpt is empty', async () => {
    const out = await formatDistillMessage({
      $json: {
        entry_id: 795,
        status: 'completed',
        stance: 'descriptive',
        summary: 'Summary only.',
        why_it_matters: 'Still useful.',
        excerpt: null,
      },
    });

    const message = out[0].json.telegram_message;
    expect(message).toContain('*Why it matters*');
    expect(message).not.toContain('*Excerpt*');
  });
});
