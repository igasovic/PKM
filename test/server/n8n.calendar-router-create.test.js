'use strict';

const prepareRouteInput = require('../../src/n8n/nodes/01-telegram-router/prepare-route-input__2fc8f31e-0d24-4d3f-88f3-33dc31652d8b.js');
const buildNormalizeRequest = require('../../src/n8n/nodes/30-calendar-create/build-normalize-request__bff8ba8c-b146-4316-a6d4-a7c757a4679b.js');
const buildGoogleEventPayload = require('../../src/n8n/nodes/30-calendar-create/build-google-event-payload__2f4ea2fd-0178-4f8c-88f4-2fdf86889d89.js');
const prepareFinalizeRequest = require('../../src/n8n/nodes/30-calendar-create/prepare-finalize-request__4c9a5cd8-7c13-4ad8-8d1c-a10f2f23520b.js');

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
    expect(row.google_start).toBe('2026-03-13T15:00:00');
    expect(row.google_end).toBe('2026-03-13T16:00:00');
    expect(row.google_summary).toBe('[M][MED] 3:00p Mila dentist');
    expect(row.google_color_id).toBe('3');
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
});
