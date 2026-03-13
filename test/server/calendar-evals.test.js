'use strict';

const fs = require('fs');
const path = require('path');

const {
  routeTelegramInput,
  normalizeCalendarRequest,
} = require('../../src/server/calendar-service.js');

function readFixture(name) {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'calendar-evals', name);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

describe('calendar eval fixtures', () => {
  test('routing eval set', () => {
    const rows = readFixture('routing.json');
    rows.forEach((row) => {
      const out = routeTelegramInput(row.input || {});
      expect(out.route).toBe(row.expect.route);
    });
  });

  test('normalization eval set', () => {
    const rows = readFixture('normalization.json');
    rows.forEach((row) => {
      const out = normalizeCalendarRequest(row.input || {});
      const expected = row.expect || {};

      expect(out.status).toBe(expected.status);

      if (Array.isArray(expected.missing_fields_includes)) {
        expect(out.missing_fields).toEqual(expect.arrayContaining(expected.missing_fields_includes));
      }
      if (expected.reason_code) {
        expect(out.reason_code).toBe(expected.reason_code);
      }
      if (expected.category_code) {
        expect(out.normalized_event.category_code).toBe(expected.category_code);
      }
      if (expected.duration_minutes) {
        expect(out.normalized_event.duration_minutes).toBe(expected.duration_minutes);
      }
      if (typeof expected.padded === 'boolean') {
        expect(out.normalized_event.block_window.padded).toBe(expected.padded);
      }
      if (expected.location_prefix) {
        expect(out.normalized_event.location).toContain(expected.location_prefix);
      }
      if (expected.subject_people_tag) {
        expect(out.normalized_event.subject_people_tag).toBe(expected.subject_people_tag);
      }
      if (expected.logical_color) {
        expect(out.normalized_event.color_choice.logical_color).toBe(expected.logical_color);
      }
    });
  });

  test('clarification eval set', () => {
    const rows = readFixture('clarification.json');
    rows.forEach((row) => {
      const out = normalizeCalendarRequest(row.input || {});
      const expected = row.expect || {};

      expect(out.status).toBe(expected.status);

      if (Array.isArray(expected.missing_fields_includes)) {
        expect(out.missing_fields).toEqual(expect.arrayContaining(expected.missing_fields_includes));
      }
      if (expected.subject_people_tag) {
        expect(out.normalized_event.subject_people_tag).toBe(expected.subject_people_tag);
      }
    });
  });
});
