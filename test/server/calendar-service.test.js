'use strict';

const {
  routeTelegramInput,
  normalizeCalendarRequest,
  normalizeCalendarRequestDeterministic,
} = require('../../src/server/calendar-service.js');

describe('calendar-service', () => {
  test('routeTelegramInput identifies calendar query intent', async () => {
    const out = await routeTelegramInput({
      text: 'What do we have tomorrow on calendar?',
    });
    expect(out.route).toBe('calendar_query');
    expect(out.confidence).toBeGreaterThanOrEqual(0.8);
  });

  test('routeTelegramInput identifies calendar create intent', async () => {
    const out = await routeTelegramInput({
      text: 'Mila dentist tomorrow at 3:00p',
    });
    expect(out.route).toBe('calendar_create');
  });

  test('normalizeCalendarRequest asks clarification when fields are missing', async () => {
    const out = await normalizeCalendarRequest({
      raw_text: 'birthday party Saturday',
    });
    expect(out.status).toBe('needs_clarification');
    expect(out.missing_fields).toEqual(expect.arrayContaining(['start_time', 'people']));
    expect(typeof out.clarification_question).toBe('string');
  });

  test('normalizeCalendarRequest builds ready payload with home no-padding rule', async () => {
    const out = await normalizeCalendarRequest({
      raw_text: 'Mila dentist tomorrow at 3:00p for 60 min at home',
    });
    expect(out.status).toBe('ready_to_create');
    expect(out.normalized_event.subject_code).toContain('[M][MED]');
    expect(out.normalized_event.block_window.padded).toBe(false);
    expect(out.normalized_event.color_choice.logical_color).toBe('purple');
  });

  test('normalizeCalendarRequest maps "appt" to MED category', async () => {
    const out = await normalizeCalendarRequest({
      raw_text: 'Mila appt tomorrow at 3:00p',
    });
    expect(out.status).toBe('ready_to_create');
    expect(out.normalized_event.category_code).toBe('MED');
  });

  test('normalizeCalendarRequest title excludes connector before time', async () => {
    const out = await normalizeCalendarRequest({
      raw_text: 'Mila dentist tomorrow at 3:00p for 60 min',
    });
    expect(out.status).toBe('ready_to_create');
    expect(out.normalized_event.title).toBe('Mila dentist');
    expect(out.normalized_event.subject_code).toContain('Mila dentist');
  });

  test('normalizeCalendarRequest collapses to FAM when all canonical people are present', async () => {
    const out = await normalizeCalendarRequest({
      raw_text: 'Mila Iva Louie Igor Danijela birthday party tomorrow at 1:00p',
    });
    expect(out.status).toBe('ready_to_create');
    expect(out.normalized_event.subject_code).toContain('[FAM]');
    expect(out.normalized_event.color_choice.logical_color).toBe('green');
  });

  test('normalizeCalendarRequest rejects all-day create in v1', async () => {
    const out = await normalizeCalendarRequest({
      raw_text: 'all-day Mila doctor appointment tomorrow',
    });
    expect(out.status).toBe('rejected');
    expect(out.reason_code).toBe('all_day_not_supported');
  });

  test('normalizeCalendarRequestDeterministic prefers llm clarification question when missing fields remain', () => {
    const out = normalizeCalendarRequestDeterministic({
      raw_text: 'birthday party Saturday',
      llm_extraction: {
        clarification_question: 'What time should I schedule this, and who is it for?',
      },
    });
    expect(out.status).toBe('needs_clarification');
    expect(out.clarification_question).toBe('What time should I schedule this, and who is it for?');
  });

  test('normalizeCalendarRequestDeterministic falls back when llm clarification question is invalid', () => {
    const out = normalizeCalendarRequestDeterministic({
      raw_text: 'birthday party Saturday',
      llm_extraction: {
        clarification_question: '  ',
      },
    });
    expect(out.status).toBe('needs_clarification');
    expect(out.clarification_question).toContain('start time');
  });

  test('normalizeCalendarRequestDeterministic removes bare-hour connector from title after clarification', () => {
    const out = normalizeCalendarRequestDeterministic({
      raw_text: 'Louie store tomorrow at 5 for 90min',
      clarification_turns: [{ answer_text: '5pm' }],
    });
    expect(out.status).toBe('ready_to_create');
    expect(out.normalized_event.title).toBe('Louie store');
  });

  test('normalizeCalendarRequestDeterministic prefers deterministic category and duration over conflicting llm extraction', () => {
    const out = normalizeCalendarRequestDeterministic({
      raw_text: 'Louie vet friday at 9:00a',
      llm_extraction: {
        category_code: 'MED',
        duration_minutes: 30,
      },
    });
    expect(out.status).toBe('ready_to_create');
    expect(out.normalized_event.category_code).toBe('DOG');
    expect(out.normalized_event.duration_minutes).toBe(60);
    expect(out.normalized_event.start_time_local).toBe('09:00');
  });

  test('normalizeCalendarRequestDeterministic maps school/class terms to SCH', () => {
    const out = normalizeCalendarRequestDeterministic({
      raw_text: 'Mila class photo tomorrow at 8:30a',
    });
    expect(out.status).toBe('ready_to_create');
    expect(out.normalized_event.category_code).toBe('SCH');
  });

  test('normalizeCalendarRequestDeterministic marks 3+ family names as FAM people tag without forcing category', () => {
    const out = normalizeCalendarRequestDeterministic({
      raw_text: 'Mila Iva Igor birthday tomorrow at 1:00p',
    });
    expect(out.status).toBe('ready_to_create');
    expect(out.normalized_event.category_code).toBe('EVT');
    expect(out.normalized_event.subject_people_tag).toBe('FAM');
  });

  test('normalizeCalendarRequestDeterministic keeps home no-padding from raw text when llm location conflicts', () => {
    const out = normalizeCalendarRequestDeterministic({
      raw_text: 'Mila dentist tomorrow at 3:00p for 60 min at home',
      llm_extraction: {
        location: 'Clinic',
      },
    });
    expect(out.status).toBe('ready_to_create');
    expect(out.normalized_event.location).toBe('home');
    expect(out.normalized_event.block_window.padded).toBe(false);
  });

  test('normalizeCalendarRequestDeterministic ignores llm date when raw text lacks date evidence', () => {
    const out = normalizeCalendarRequestDeterministic({
      raw_text: 'cal: family meeting',
      llm_extraction: {
        date_local: '2026-04-10',
        start_time_local: '15:00',
      },
    });
    expect(out.status).toBe('needs_clarification');
    expect(out.missing_fields).toEqual(expect.arrayContaining(['date', 'people']));
  });
});
