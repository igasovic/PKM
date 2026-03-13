'use strict';

jest.mock('/data/src/libs/config.js', () => ({
  getConfig: () => ({ db: { is_test_mode: false } }),
}), { virtual: true });

const formatTelegramMessage = require('../../src/n8n/nodes/10-read/format-telegram-message__f305ac84-35d3-44df-8ef5-1c0e004f37b8.js');

describe('n8n format-telegram-message', () => {
  test('escapes topic arrow for MarkdownV2', async () => {
    const out = await formatTelegramMessage({
      $json: {
        entry_id: '797',
        topic_primary: 'Health',
        topic_secondary: 'Dentist',
        clean_text: 'Body text',
      },
    });

    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    const message = out[0].json.telegram_message;
    expect(message).toContain('*Topic* Health \\-\\> Dentist');
    expect(message).not.toContain('\\->');
  });
});
