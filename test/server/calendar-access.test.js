'use strict';

const {
  resolveTelegramAccess,
  applyRouteAccessPolicy,
  calendarAccessMessage,
} = require('../../src/server/calendar-access.js');

describe('calendar access policy', () => {
  test('resolveTelegramAccess allows all when allowlist is disabled', () => {
    const out = resolveTelegramAccess(
      { telegram_user_id: '222' },
      { telegram_access: { enforce_allowlist: false } }
    );
    expect(out.calendar_allowed).toBe(true);
    expect(out.pkm_allowed).toBe(true);
    expect(out.reason_code).toBeNull();
  });

  test('resolveTelegramAccess supports calendar-only users', () => {
    const out = resolveTelegramAccess(
      { telegram_user_id: '222' },
      {
        telegram_access: {
          enforce_allowlist: true,
          calendar_allowed_user_ids: ['111', '222'],
          pkm_allowed_user_ids: ['111'],
        },
      }
    );
    expect(out.calendar_allowed).toBe(true);
    expect(out.pkm_allowed).toBe(false);
    expect(out.reason_code).toBe('telegram_user_not_pkm_allowed');
  });

  test('applyRouteAccessPolicy downgrades disallowed PKM route to ambiguous', () => {
    const route = applyRouteAccessPolicy(
      { route: 'pkm_capture', confidence: 0.8 },
      {
        enforce: true,
        calendar_allowed: true,
        pkm_allowed: false,
        reason_code: 'telegram_user_not_pkm_allowed',
      }
    );
    expect(route.route).toBe('ambiguous');
    expect(route.clarification_question).toContain('calendar-only access');
  });

  test('applyRouteAccessPolicy downgrades recipe search for calendar-only user', () => {
    const route = applyRouteAccessPolicy(
      { route: 'recipe_search', confidence: 0.9, recipe_query: 'pasta' },
      {
        enforce: true,
        calendar_allowed: true,
        pkm_allowed: false,
        reason_code: 'telegram_user_not_pkm_allowed',
      }
    );
    expect(route.route).toBe('ambiguous');
    expect(route.clarification_question).toContain('calendar-only access');
  });

  test('calendarAccessMessage reports non-calendar sender', () => {
    expect(calendarAccessMessage({ reason_code: 'telegram_user_not_calendar_allowed' }))
      .toContain('not allowed');
  });
});
