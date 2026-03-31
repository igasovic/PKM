'use strict';

const {
  loadRouterFixtures,
  loadNormalizeFixtures,
} = require('../../scripts/evals/lib/fixtures.js');
const {
  scoreRouterResults,
  scoreNormalizeResults,
} = require('../../scripts/evals/lib/scoring.js');
const {
  buildRouterMarkdown,
  buildCalendarMarkdown,
} = require('../../scripts/evals/lib/reporting.js');
const { evaluateAssertions } = require('../../scripts/evals/run_calendar_live.js');

describe('family-calendar eval tooling', () => {
  test('router fixtures meet required minimum buckets', () => {
    const { stateless, stateful } = loadRouterFixtures();
    const counts = stateless.reduce((acc, row) => {
      acc[row.bucket] = (acc[row.bucket] || 0) + 1;
      return acc;
    }, {});

    expect(stateless.length).toBeGreaterThanOrEqual(50);
    expect(stateful.length).toBeGreaterThanOrEqual(5);
    expect(counts.obvious).toBeGreaterThanOrEqual(20);
    expect(counts.ambiguous).toBeGreaterThanOrEqual(15);
    expect(counts.adversarial_edge).toBeGreaterThanOrEqual(15);
  });

  test('normalize fixtures meet required bucket sizes', () => {
    const rows = loadNormalizeFixtures();
    const counts = rows.reduce((acc, row) => {
      acc[row.bucket] = (acc[row.bucket] || 0) + 1;
      return acc;
    }, {});

    expect(rows.length).toBeGreaterThanOrEqual(40);
    expect(counts.clean).toBeGreaterThanOrEqual(20);
    expect(counts.clarification).toBeGreaterThanOrEqual(10);
    expect(counts.rejection_edge).toBeGreaterThanOrEqual(10);
  });

  test('normalize padded assertion fails when block_window.padded is missing', () => {
    const result = evaluateAssertions(
      { status: 'ready_to_create', padded: false },
      {
        status: 'ready_to_create',
        normalized_event: {
          category_code: 'MED',
        },
      }
    );

    expect(result.pass).toBe(false);
    expect(result.assertion_details).toEqual(
      expect.arrayContaining([{ field: 'padded', ok: false }])
    );
  });

  test('router scoring and markdown summary include key metrics', () => {
    const summary = scoreRouterResults([
      {
        case_id: 'r1',
        bucket: 'obvious',
        expected_route: 'calendar_create',
        actual_route: 'calendar_create',
        confidence: 0.92,
        pass: true,
      },
      {
        case_id: 'r2',
        bucket: 'ambiguous',
        expected_route: 'ambiguous',
        actual_route: 'calendar_create',
        confidence: 0.95,
        pass: false,
      },
    ]);

    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.failure_groups.false_positive_calendar_create).toHaveLength(1);
    expect(summary.failure_groups.high_confidence_errors).toHaveLength(1);

    const markdown = buildRouterMarkdown({
      metadata: { timestamp: '20260331T010101Z', backend_url: 'http://localhost:8080' },
      summary,
    });

    expect(markdown).toContain('Confusion Matrix');
    expect(markdown).toContain('calendar_create precision');
  });

  test('normalize scoring and markdown summary include clarification metrics', () => {
    const summary = scoreNormalizeResults([
      {
        case_id: 'n1',
        bucket: 'clarification',
        expected_status: 'needs_clarification',
        actual_status: 'needs_clarification',
        actual_missing_fields: ['start_time'],
        expect: { missing_fields_includes: ['start_time'] },
        assertions_total: 2,
        assertions_passed: 2,
        pass: true,
      },
      {
        case_id: 'n2',
        bucket: 'rejection_edge',
        expected_status: 'rejected',
        actual_status: 'ready_to_create',
        actual_missing_fields: [],
        llm_confidence: 0.9,
        assertions_total: 1,
        assertions_passed: 0,
        pass: false,
      },
    ]);

    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.failure_groups.high_confidence_errors).toHaveLength(1);

    const markdown = buildCalendarMarkdown({
      metadata: { timestamp: '20260331T010101Z', backend_url: 'http://localhost:8080' },
      summary,
    });

    expect(markdown).toContain('clarification accuracy');
    expect(markdown).toContain('high-confidence errors');
  });
});
