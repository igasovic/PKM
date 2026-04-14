'use strict';

const { computeReviewStatus } = require('../../src/server/todoist/review-rules.js');

describe('todoist review rules', () => {
  test('preserves manual accepted and overridden when parse was not triggered', () => {
    expect(computeReviewStatus({
      lifecycle_status: 'open',
      project_key: 'work',
      task_shape: 'next_action',
      suggested_next_action: null,
      parse_confidence: 0.99,
      parse_failed: false,
      previous_review_status: 'accepted',
      parse_triggered: false,
    })).toEqual({ review_status: 'accepted', review_reasons: ['manual_accepted_current'] });

    expect(computeReviewStatus({
      lifecycle_status: 'open',
      project_key: 'work',
      task_shape: 'next_action',
      suggested_next_action: null,
      parse_confidence: 0.99,
      parse_failed: false,
      previous_review_status: 'overridden',
      parse_triggered: false,
    })).toEqual({ review_status: 'overridden', review_reasons: ['manual_override_current'] });
  });

  test('enforces inbox and risky-shape routes to needs_review', () => {
    const inbox = computeReviewStatus({
      lifecycle_status: 'open',
      project_key: 'inbox',
      task_shape: 'next_action',
      suggested_next_action: null,
      parse_confidence: 0.95,
      parse_failed: false,
      previous_review_status: null,
      parse_triggered: true,
    });

    expect(inbox.review_status).toBe('needs_review');
    expect(inbox.review_reasons).toEqual(expect.arrayContaining(['inbox_requires_review']));

    const risky = computeReviewStatus({
      lifecycle_status: 'open',
      project_key: 'work',
      task_shape: 'vague_note',
      suggested_next_action: null,
      parse_confidence: 0.95,
      parse_failed: false,
      previous_review_status: null,
      parse_triggered: true,
    });

    expect(risky.review_status).toBe('needs_review');
    expect(risky.review_reasons).toEqual(expect.arrayContaining(['risky_task_shape']));

    const projectWithoutEvidence = computeReviewStatus({
      lifecycle_status: 'open',
      project_key: 'work',
      task_shape: 'project',
      suggested_next_action: 'Break down scope',
      parse_confidence: 0.9,
      has_subtasks: false,
      explicit_project_signal: false,
      parse_failed: false,
      previous_review_status: null,
      parse_triggered: true,
    });

    expect(projectWithoutEvidence.review_status).toBe('needs_review');
    expect(projectWithoutEvidence.review_reasons).toEqual(expect.arrayContaining(['risky_task_shape']));
  });

  test('accepts project shape when strong evidence is present', () => {
    const withSubtasks = computeReviewStatus({
      lifecycle_status: 'open',
      project_key: 'work',
      task_shape: 'project',
      suggested_next_action: 'Define milestone 1',
      parse_confidence: 0.88,
      has_subtasks: true,
      explicit_project_signal: false,
      parse_failed: false,
      previous_review_status: null,
      parse_triggered: true,
    });

    expect(withSubtasks).toEqual({
      review_status: 'no_review_needed',
      review_reasons: [],
    });
  });

  test('applies waiting confidence threshold and reparse-after-override behavior', () => {
    const waitingLowConfidence = computeReviewStatus({
      lifecycle_status: 'waiting',
      project_key: 'work',
      task_shape: 'follow_up',
      suggested_next_action: 'Ping Alex',
      parse_confidence: 0.7,
      parse_failed: false,
      previous_review_status: null,
      parse_triggered: true,
    }, {
      config: {
        todoist: {
          review: {
            min_confidence: 0.72,
            waiting_min_confidence: 0.82,
          },
        },
      },
    });

    expect(waitingLowConfidence.review_status).toBe('needs_review');
    expect(waitingLowConfidence.review_reasons).toEqual(expect.arrayContaining([
      'confidence_below_min',
      'waiting_confidence_below_min',
      'waiting_with_inferred_next_action',
    ]));

    const overrideReparse = computeReviewStatus({
      lifecycle_status: 'open',
      project_key: 'work',
      task_shape: 'next_action',
      suggested_next_action: null,
      parse_confidence: 0.95,
      parse_failed: false,
      previous_review_status: 'overridden',
      parse_triggered: true,
    });

    expect(overrideReparse.review_status).toBe('needs_review');
    expect(overrideReparse.review_reasons).toEqual(expect.arrayContaining(['override_reparse_requires_review']));
  });

  test('returns no_review_needed when no gating reason is present', () => {
    expect(computeReviewStatus({
      lifecycle_status: 'open',
      project_key: 'personal',
      task_shape: 'next_action',
      suggested_next_action: null,
      parse_confidence: 0.95,
      parse_failed: false,
      previous_review_status: null,
      parse_triggered: true,
    })).toEqual({ review_status: 'no_review_needed', review_reasons: [] });
  });
});
