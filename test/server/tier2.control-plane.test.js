'use strict';

const {
  evaluateTier2Eligibility,
  computeTier2PriorityScore,
  selectTier2Budget,
  resolveTier2Route,
} = require('../../src/server/tier2/control-plane.js');

describe('tier2 control-plane', () => {
  test('eligibility returns proceed for newsletter candidate', () => {
    const out = evaluateTier2Eligibility({
      content_type: 'newsletter',
      has_usable_clean_text: true,
      distill_status: 'pending',
      content_hash: 'a',
      distill_created_from_hash: 'b',
    });
    expect(out).toEqual({ decision: 'proceed', reason_code: null });
  });

  test('eligibility returns skipped for already queued', () => {
    const out = evaluateTier2Eligibility({
      content_type: 'newsletter',
      has_usable_clean_text: true,
      distill_status: 'queued',
    });
    expect(out).toEqual({ decision: 'skipped', reason_code: 'already_queued' });
  });

  test('stale entries receive max score', () => {
    const score = computeTier2PriorityScore({
      distill_status: 'stale',
      intent: 'archive',
      quality_score: 0.1,
      clean_word_count: 100,
    });
    expect(score).toBe(1000);
  });

  test('budget tie-break uses word count then age', () => {
    const selected = selectTier2Budget([
      {
        id: 'c',
        priority_score: 80,
        distill_status: 'pending',
        clean_word_count: 500,
        created_at: '2026-03-01T00:00:00.000Z',
      },
      {
        id: 'a',
        priority_score: 80,
        distill_status: 'pending',
        clean_word_count: 1200,
        created_at: '2026-03-02T00:00:00.000Z',
      },
      {
        id: 'b',
        priority_score: 80,
        distill_status: 'pending',
        clean_word_count: 1200,
        created_at: '2026-02-01T00:00:00.000Z',
      },
    ], 2);

    expect(selected.map((row) => row.id)).toEqual(['b', 'a']);
  });

  test('route switches to chunked above threshold', () => {
    const route = resolveTier2Route(
      { clean_word_count: 6001 },
      { distill: { direct_chunk_threshold_words: 5000 } }
    );
    expect(route.route).toBe('chunked');
    expect(route.chunking_strategy).toBe('structure_paragraph_window_v1');
  });
});
