'use strict';

jest.mock('/data/src/libs/config.js', () => ({
  getConfig: () => ({ db: { is_test_mode: false } }),
}), { virtual: true });

const formatTelegramMessage = require('../../src/n8n/nodes/10-read/format-telegram-message__f305ac84-35d3-44df-8ef5-1c0e004f37b8.js');

describe('n8n format-telegram-message', () => {
  test('formats pull message in new structure and skips empty optional lines', async () => {
    const out = await formatTelegramMessage({
      $json: {
        entry_id: '797',
        author: 'Igor',
        content_type: 'article',
        topic_primary: 'Health',
        topic_secondary: 'Dentist',
        clean_text: 'Body text with context.',
        clean_word_count: 4,
      },
    });

    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    const message = out[0].json.telegram_message;
    expect(message).toContain('🗣️ \\[Igor\\] \\(#797\\) \\- article');
    expect(message).toContain('📏 4 words');
    expect(message).toContain('🏷️ Health → Dentist');
    expect(message).not.toContain('📰');
    expect(message).not.toContain('🔗');
  });
});
