'use strict';

const { loadInlineCodeNode, requireExternalizedNode } = require('./n8n-node-loader');

const prepareRouteInput = loadInlineCodeNode('01-telegram-router', 'Prepare Route Input');
const prepareRecipeReadMessage = loadInlineCodeNode('01-telegram-router', 'Prepare Recipe Read Message');
const buildNormalizeRequest = loadInlineCodeNode('30-calendar-create', 'Build Normalize Request');
const buildGoogleEventPayload = requireExternalizedNode('30-calendar-create', 'build-google-event-payload');
const prepareConflictContext = requireExternalizedNode('30-calendar-create', 'prepare-conflict-context');
const prepareFinalizeRequest = requireExternalizedNode('30-calendar-create', 'prepare-finalize-request');

describe('n8n calendar router/create helpers', () => {
  test('prepare route input detects command/prefix/actor', async () => {
    const out = await prepareRouteInput({
      $json: {
        message: {
          text: 'cal: Mila dentist tomorrow at 3:00p',
          message_id: 777,
          chat: { id: 1509032341 },
          from: { username: 'igor_g' },
        },
      },
    });

    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    const row = out[0].json;
    expect(row.is_command).toBe(false);
    expect(row.route_hint).toBe('calendar_create');
    expect(row.actor_code).toBe('igor');
    expect(row.telegram_chat_id).toBe('1509032341');
    expect(row.telegram_message_id).toBe('777');
  });

  test('prepare route input defaults plain text to pkm capture', async () => {
    const out = await prepareRouteInput({
      $json: {
        message: {
          text: 'my random thought',
          message_id: 778,
          chat: { id: 1509032341 },
          from: { username: 'igor_g' },
        },
      },
    });

    const row = out[0].json;
    expect(row.route_hint).toBe('pkm_capture');
    expect(row.is_command).toBe(false);
  });

  test('prepare route input defaults link-only text to pkm capture', async () => {
    const out = await prepareRouteInput({
      $json: {
        message: {
          text: 'https://example.com/article',
          message_id: 779,
          chat: { id: 1509032341 },
          from: { username: 'igor_g' },
        },
      },
    });

    const row = out[0].json;
    expect(row.route_hint).toBe('pkm_capture');
  });

  test('prepare recipe read message rewrites route output into /recipe command', async () => {
    const out = await prepareRecipeReadMessage({
      $json: {
        route: 'recipe_search',
        recipe_query: 'cheese quesadilla',
        raw_text: "what's recipe for cheese quesadilla",
        message: {
          text: "what's recipe for cheese quesadilla",
        },
      },
    });

    const row = out[0].json;
    expect(row.raw_text).toBe('/recipe cheese quesadilla');
    expect(row.is_command).toBe(true);
    expect(row.message.text).toBe('/recipe cheese quesadilla');
  });

  test('prepare recipe read message falls back to raw text when recipe_query is missing', async () => {
    const out = await prepareRecipeReadMessage({
      $json: {
        route: 'recipe_search',
        raw_text: 'pasta recipe',
        message: {
          text: 'pasta recipe',
        },
      },
    });

    const row = out[0].json;
    expect(row.raw_text).toBe('/recipe pasta recipe');
    expect(row.message.text).toBe('/recipe pasta recipe');
  });

  test('build normalize request strips cal prefix and keeps source ids', async () => {
    const out = await buildNormalizeRequest({
      $json: {
        raw_text: 'cal: Mila dentist tomorrow at 3:00p for 60 min',
        actor_code: 'igor',
        telegram_chat_id: '1509032341',
        telegram_message_id: '777',
        config: {
          calendar: {
            family_calendar_id: 'family@group.calendar.google.com',
          },
        },
      },
    });

    const row = out[0].json;
    expect(row.raw_text).toBe('Mila dentist tomorrow at 3:00p for 60 min');
    expect(row.source).toEqual({ chat_id: '1509032341', message_id: '777', user_id: null });
    expect(row.family_calendar_id).toBe('family@group.calendar.google.com');
  });

  test('build normalize request enforces explicit calendar test mode guardrails', async () => {
    const out = await buildNormalizeRequest({
      $json: {
        raw_text: 'cal: Louie store tomorrow at 2pm',
        actor_code: 'igor',
        telegram_chat_id: '1509032341',
        telegram_message_id: '777',
        calendar_test_mode: true,
        test_calendar_id: 'test-calendar@group.calendar.google.com',
        prod_calendar_id: 'prod-calendar@group.calendar.google.com',
      },
    });

    const row = out[0].json;
    expect(row.calendar_test_mode).toBe(true);
    expect(row.family_calendar_id).toBe('test-calendar@group.calendar.google.com');
    expect(row.test_calendar_id).toBe('test-calendar@group.calendar.google.com');
    expect(row.prod_calendar_id).toBe('prod-calendar@group.calendar.google.com');
  });

  test('build normalize request blocks calendar test mode when ids collide', async () => {
    await expect(buildNormalizeRequest({
      $json: {
        raw_text: 'cal: Louie store tomorrow at 2pm',
        actor_code: 'igor',
        telegram_chat_id: '1509032341',
        telegram_message_id: '777',
        calendar_test_mode: true,
        test_calendar_id: 'same-calendar@group.calendar.google.com',
        prod_calendar_id: 'same-calendar@group.calendar.google.com',
      },
    })).rejects.toThrow('test_calendar_id must differ from prod_calendar_id');
  });

  test('build google payload maps normalized event to calendar create fields', async () => {
    const out = await buildGoogleEventPayload({
      $json: {
        status: 'ready_to_create',
        request_id: 'req-1',
        telegram_chat_id: '1509032341',
        telegram_message_id: '777',
        family_calendar_id: 'family@group.calendar.google.com',
        normalized_event: {
          subject_code: '[M][MED] 3:00p Mila dentist',
          date_local: '2026-03-13',
          start_time_local: '15:00',
          end_date_local: '2026-03-13',
          end_time_local: '16:00',
          location: 'home',
          color_choice: { google_color_id: '3' },
          original_start: { date_local: '2026-03-13', time_local: '15:00' },
          block_window: {
            start_date_local: '2026-03-13',
            start_time_local: '15:00',
            end_date_local: '2026-03-13',
            end_time_local: '16:00',
          },
        },
      },
    });

    const row = out[0].json;
    expect(row.google_calendar_id).toBe('family@group.calendar.google.com');
    expect(row.google_start).toMatch(/^2026-03-13T15:00:00[+-]\d{2}:\d{2}$/);
    expect(row.google_end).toMatch(/^2026-03-13T16:00:00[+-]\d{2}:\d{2}$/);
    expect(row.google_summary).toBe('[M][MED] 3:00p Mila dentist');
    expect(row.google_color_id).toBe('3');
  });

  test('build google payload applies smoke summary prefix in calendar test mode', async () => {
    const out = await buildGoogleEventPayload({
      $json: {
        status: 'ready_to_create',
        request_id: 'req-2',
        telegram_chat_id: '1509032341',
        telegram_message_id: '778',
        calendar_test_mode: true,
        test_run_id: 'smoke_2026_03_14',
        test_calendar_id: 'test-calendar@group.calendar.google.com',
        prod_calendar_id: 'prod-calendar@group.calendar.google.com',
        normalized_event: {
          subject_code: '[L][DOG] 2:00p Louie store',
          date_local: '2026-03-13',
          start_time_local: '14:00',
          end_date_local: '2026-03-13',
          end_time_local: '15:30',
          color_choice: { google_color_id: '6' },
          original_start: { date_local: '2026-03-13', time_local: '14:00' },
          block_window: {
            start_date_local: '2026-03-13',
            start_time_local: '14:00',
            end_date_local: '2026-03-13',
            end_time_local: '15:30',
          },
        },
      },
    });

    const row = out[0].json;
    expect(row.google_calendar_id).toBe('test-calendar@group.calendar.google.com');
    expect(row.google_summary).toBe('[SMOKE smoke_2026_03_14] [L][DOG] 2:00p Louie store');
    expect(row.google_description).toContain('SMOKE test run id: smoke_2026_03_14');
  });

  test('prepare finalize request marks success when event id exists', async () => {
    const out = await prepareFinalizeRequest({
      $json: {
        request_id: 'req-1',
        google_calendar_id: 'family@group.calendar.google.com',
        id: 'google-event-1',
      },
    });

    const row = out[0].json;
    expect(row.success).toBe(true);
    expect(row.final_status).toBe('calendar_created');
    expect(row.google_event_id).toBe('google-event-1');
    expect(row.error).toBeNull();
  });

  test('prepare finalize request falls back to request id from description', async () => {
    const out = await prepareFinalizeRequest({
      $json: {
        description: 'PKM request id: req-from-description\\nPKM source key: tgcal:1509032341:777',
        id: 'google-event-2',
      },
    });

    const row = out[0].json;
    expect(row.request_id).toBe('req-from-description');
    expect(row.success).toBe(true);
    expect(row.final_status).toBe('calendar_created');
  });

  test('prepare finalize request falls back to request id from upstream items', async () => {
    const out = await prepareFinalizeRequest({
      $json: {
        id: 'google-event-4',
      },
      $items: (name) => {
        if (name === 'Build Google Event Payload') {
          return [{
            json: {
              request_id: 'req-from-items',
            },
          }];
        }
        return [];
      },
    });

    const row = out[0].json;
    expect(row.request_id).toBe('req-from-items');
    expect(row.success).toBe(true);
    expect(row.final_status).toBe('calendar_created');
  });

  test('prepare finalize request keeps success when non-blocking warning exists with event id', async () => {
    const out = await prepareFinalizeRequest({
      $json: {
        request_id: 'req-1',
        id: 'google-event-3',
        error: "ERROR: This parameter's value is invalid. Please enter a valid mode.",
      },
    });

    const row = out[0].json;
    expect(row.success).toBe(true);
    expect(row.final_status).toBe('calendar_created');
    expect(row.error).toBeNull();
    expect(row.warning_codes).toContain('calendar_non_blocking_warning');
  });

  test('prepare finalize request marks failure when id is missing', async () => {
    const out = await prepareFinalizeRequest({
      $json: {
        request_id: 'req-1',
        google_calendar_id: 'family@group.calendar.google.com',
      },
    });

    const row = out[0].json;
    expect(row.success).toBe(false);
    expect(row.final_status).toBe('calendar_failed');
    expect(row.error).toEqual(expect.objectContaining({ code: 'google_event_id_missing' }));
  });

  test('prepare conflict context emits conflict summary and warning code', async () => {
    const out = await prepareConflictContext({
      $json: {},
      $input: {
        all: () => [
          {
            json: {
              id: 'evt-1',
              summary: 'School meeting',
              status: 'confirmed',
              start: { dateTime: '2026-03-15T15:00:00-05:00' },
            },
          },
          {
            json: {
              id: 'evt-2',
              summary: 'Dinner',
              status: 'confirmed',
              start: { date: '2026-03-15' },
            },
          },
        ],
      },
      $items: () => [{
        json: {
          request_id: 'req-1',
          warning_codes: [],
        },
      }],
    });

    const row = out[0].json;
    expect(row.conflict_count).toBe(2);
    expect(row.conflict_preview).toHaveLength(2);
    expect(row.warning_codes).toContain('calendar_conflict_possible');
  });

  test('prepare conflict context ignores non-event payloads', async () => {
    const out = await prepareConflictContext({
      $json: {},
      $input: {
        all: () => [{ json: { message: 'upstream failed' } }],
      },
      $items: () => [{
        json: {
          request_id: 'req-2',
          warning_codes: ['existing_warning'],
        },
      }],
    });

    const row = out[0].json;
    expect(row.conflict_count).toBe(0);
    expect(row.warning_codes).toEqual(['existing_warning']);
  });

  test('prepare conflict context preserves upstream payload when conflict check returns error-only item', async () => {
    const out = await prepareConflictContext({
      $json: {
        error: "ERROR: This parameter's value is invalid. Please enter a valid mode.",
      },
      $input: {
        all: () => [{ json: { error: "ERROR: This parameter's value is invalid. Please enter a valid mode." } }],
      },
      $items: (name) => {
        if (name === 'Build Google Event Payload') {
          return [{
            json: {
              request_id: 'req-ctx-1',
              google_calendar_id: 'pkm.gasovic@gmail.com',
              google_start: '2026-03-15T13:30:00',
              google_end: '2026-03-15T16:00:00',
              google_summary: '[L][DOG] 2:00p Louie store at 2',
            },
          }];
        }
        return [];
      },
    });

    const row = out[0].json;
    expect(row.request_id).toBe('req-ctx-1');
    expect(row.google_calendar_id).toBe('pkm.gasovic@gmail.com');
    expect(row.conflict_count).toBe(0);
    expect(row.warning_codes).toContain('calendar_conflict_check_failed');
    expect(row.warning_message).toContain('invalid. Please enter a valid mode');
  });
});
