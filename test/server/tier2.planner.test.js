'use strict';

const {
  createTier2Planner,
  buildEligibilityPersistenceGroups,
} = require('../../src/server/tier2/planner.js');

function makeLogger() {
  return {
    child() {
      return this;
    },
    async step(_name, fn) {
      return fn();
    },
  };
}

describe('tier2 planner', () => {
  test('builds plan, persists eligibility states, and returns selected rows', async () => {
    const persistedCalls = [];
    const fakeDb = {
      async getTier2Candidates() {
        return {
          rows: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              entry_id: 101,
              content_type: 'newsletter',
              clean_word_count: 6200,
              has_usable_clean_text: true,
              intent: 'think',
              quality_score: 0.8,
              topic_primary_confidence: 0.7,
              topic_secondary_confidence: 0.6,
              distill_status: 'pending',
              content_hash: 'a1',
              distill_created_from_hash: 'a0',
              created_at: '2026-03-01T00:00:00.000Z',
            },
            {
              id: '22222222-2222-4222-8222-222222222222',
              entry_id: 102,
              content_type: 'note',
              clean_word_count: 500,
              has_usable_clean_text: true,
              intent: 'archive',
              quality_score: 0.5,
              topic_primary_confidence: 0.2,
              topic_secondary_confidence: 0.1,
              distill_status: 'pending',
              content_hash: 'b1',
              distill_created_from_hash: null,
              created_at: '2026-03-02T00:00:00.000Z',
            },
            {
              id: '33333333-3333-4333-8333-333333333333',
              entry_id: 103,
              content_type: 'newsletter',
              clean_word_count: 0,
              has_usable_clean_text: false,
              intent: 'archive',
              quality_score: 0.5,
              topic_primary_confidence: 0,
              topic_secondary_confidence: 0,
              distill_status: 'pending',
              content_hash: 'c1',
              distill_created_from_hash: null,
              created_at: '2026-03-03T00:00:00.000Z',
            },
          ],
          rowCount: 3,
        };
      },
      async persistTier2EligibilityStatusByIds(ids, opts) {
        persistedCalls.push({ ids, opts });
        return { rowCount: ids.length, rows: [] };
      },
      async getTier2DetailsByIds(ids) {
        return {
          rows: [
            {
              id: ids[0],
              entry_id: 101,
              clean_word_count: 6200,
              distill_status: 'pending',
              created_at: '2026-03-01T00:00:00.000Z',
            },
          ],
          rowCount: ids.length,
        };
      },
    };

    const planner = createTier2Planner({
      db: fakeDb,
      getLogger: () => makeLogger(),
      getConfig: () => ({
        distill: {
          max_entries_per_run: 25,
          direct_chunk_threshold_words: 5000,
        },
      }),
    });

    const out = await planner.runTier2ControlPlanePlan({
      persist_eligibility: true,
      include_details: true,
    });

    expect(out.candidate_count).toBe(3);
    expect(out.decision_counts).toEqual({
      proceed: 1,
      skipped: 1,
      not_eligible: 1,
    });
    expect(out.persisted_eligibility.updated).toBe(2);
    expect(persistedCalls).toHaveLength(2);
    expect(out.selected_count).toBe(1);
    expect(out.selected[0]).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      entry_id: 101,
      route: 'chunked',
      chunking_strategy: 'structure_paragraph_window_v1',
      priority_score: 75,
      clean_word_count: 6200,
      distill_status: 'pending',
      created_at: '2026-03-01T00:00:00.000Z',
    });
  });

  test('skips persistence when persist_eligibility is false', async () => {
    const fakeDb = {
      async getTier2Candidates() {
        return {
          rows: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              entry_id: 101,
              content_type: 'newsletter',
              clean_word_count: 500,
              has_usable_clean_text: true,
              intent: 'archive',
              quality_score: 0.5,
              topic_primary_confidence: 0,
              topic_secondary_confidence: 0,
              distill_status: 'pending',
              content_hash: 'a1',
              distill_created_from_hash: null,
              created_at: '2026-03-01T00:00:00.000Z',
            },
          ],
          rowCount: 1,
        };
      },
      async persistTier2EligibilityStatusByIds() {
        throw new Error('should not be called');
      },
    };

    const planner = createTier2Planner({
      db: fakeDb,
      getLogger: () => makeLogger(),
      getConfig: () => ({ distill: { max_entries_per_run: 10, direct_chunk_threshold_words: 5000 } }),
    });

    const out = await planner.runTier2ControlPlanePlan({ persist_eligibility: false });
    expect(out.persisted_eligibility.updated).toBe(0);
    expect(out.selected_count).toBe(1);
  });

  test('parses boolean-like string options for persistence/details flags', async () => {
    let persistCalled = false;
    let detailsCalled = false;
    const fakeDb = {
      async getTier2Candidates() {
        return {
          rows: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              entry_id: 101,
              content_type: 'newsletter',
              clean_word_count: 6200,
              has_usable_clean_text: true,
              intent: 'archive',
              quality_score: 0.8,
              topic_primary_confidence: 0.8,
              topic_secondary_confidence: 0.8,
              distill_status: 'pending',
              content_hash: 'a1',
              distill_created_from_hash: null,
              created_at: '2026-03-01T00:00:00.000Z',
            },
          ],
          rowCount: 1,
        };
      },
      async persistTier2EligibilityStatusByIds() {
        persistCalled = true;
        return { rowCount: 1, rows: [] };
      },
      async getTier2DetailsByIds() {
        detailsCalled = true;
        return { rows: [], rowCount: 0 };
      },
    };

    const planner = createTier2Planner({
      db: fakeDb,
      getLogger: () => makeLogger(),
      getConfig: () => ({ distill: { max_entries_per_run: 10, direct_chunk_threshold_words: 5000 } }),
    });

    await planner.runTier2ControlPlanePlan({
      persist_eligibility: 'false',
      include_details: 'true',
    });

    expect(persistCalled).toBe(false);
    expect(detailsCalled).toBe(true);
  });

  test('groups eligibility persistence by status and reason code', () => {
    const groups = buildEligibilityPersistenceGroups([
      { id: '1', decision: 'skipped', reason_code: 'already_current' },
      { id: '2', decision: 'skipped', reason_code: 'already_current' },
      { id: '3', decision: 'not_eligible', reason_code: 'wrong_content_type' },
      { id: '4', decision: 'proceed', reason_code: null },
    ]);

    expect(groups).toEqual([
      { status: 'skipped', reason_code: 'already_current', ids: ['1', '2'] },
      { status: 'not_eligible', reason_code: 'wrong_content_type', ids: ['3'] },
    ]);
  });
});
