'use strict';

const {
  routeTelegramInputWithTrace,
  normalizeCalendarRequestWithTrace,
} = require('../../src/server/calendar-service.js');

describe('calendar graph trace surfaces', () => {
  test('routing graph exposes trace metadata', async () => {
    const out = await routeTelegramInputWithTrace({
      text: 'pkm: save this thought',
    });

    expect(out.result.route).toBe('pkm_capture');
    expect(out.trace.route_source).toBe('rule');
    expect(out.trace.rule_id).toBe('prefix_pkm');
  });

  test('calendar extraction graph exposes trace metadata', async () => {
    const keyBackup = process.env.LITELLM_MASTER_KEY;
    process.env.LITELLM_MASTER_KEY = '';

    try {
      const out = await normalizeCalendarRequestWithTrace({
        raw_text: 'Mila appt tomorrow at 3:00p',
      });

      expect(out.result.status).toBe('ready_to_create');
      expect(out.trace.status).toBe('ready_to_create');
      expect(out.trace.llm_used).toBe(false);
      expect(out.trace.llm_reason).toBe('litellm_not_configured');
    } finally {
      if (keyBackup === undefined) {
        delete process.env.LITELLM_MASTER_KEY;
      } else {
        process.env.LITELLM_MASTER_KEY = keyBackup;
      }
    }
  });
});
