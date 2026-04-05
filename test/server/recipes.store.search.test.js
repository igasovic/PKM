'use strict';

describe('recipes-store search', () => {
  let queryMock;

  beforeEach(() => {
    jest.resetModules();
    queryMock = jest.fn();

    jest.doMock('../../src/server/db-pool.js', () => ({
      getPool: () => ({ query: queryMock }),
    }));

    jest.doMock('../../src/server/logger/braintrust.js', () => ({
      traceDb: async (_name, _meta, run) => run(),
    }));

    jest.doMock('../../src/server/db/runtime-store.js', () => ({
      getConfigWithTestMode: async () => ({
        db: {
          is_test_mode: false,
          schema_prod: 'pkm',
          schema_test: 'pkm_test',
        },
      }),
    }));

    jest.doMock('../../src/libs/sql-builder.js', () => ({
      isValidIdent: () => true,
      qualifiedTable: (schema, table) => `${schema}.${table}`,
    }));
  });

  test('returns the requested number of alternatives', async () => {
    const base = {
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-01T00:00:00.000Z',
      servings: 2,
      ingredients: ['pasta'],
      instructions: ['boil'],
      notes: null,
      search_text: 'lemon pasta',
      status: 'active',
      metadata: { review: { reasons: [] } },
      source: 'telegram',
      cuisine: 'italian',
      protein: 'none',
      prep_time_minutes: 5,
      cook_time_minutes: 10,
      total_time_minutes: 15,
      difficulty: 'easy',
      tags: ['weeknight'],
      url_canonical: null,
      capture_text: '# Lemon Pasta',
      overnight: false,
    };

    queryMock.mockResolvedValueOnce({
      rows: [
        { ...base, id: 1, public_id: 'R1', title: 'Lemon Pasta', title_normalized: 'lemon pasta' },
        { ...base, id: 2, public_id: 'R2', title: 'Lemon Pasta 2', title_normalized: 'lemon pasta 2' },
        { ...base, id: 3, public_id: 'R3', title: 'Lemon Pasta 3', title_normalized: 'lemon pasta 3' },
        { ...base, id: 4, public_id: 'R4', title: 'Lemon Pasta 4', title_normalized: 'lemon pasta 4' },
        { ...base, id: 5, public_id: 'R5', title: 'Lemon Pasta 5', title_normalized: 'lemon pasta 5' },
      ],
    });

    const { searchRecipes } = require('../../src/server/db/recipes-store.js');
    const out = await searchRecipes({ q: 'lemon pasta', alternatives_count: 4 });

    expect(out.top_hit.public_id).toBe('R1');
    expect(out.alternatives).toHaveLength(4);
    expect(out.alternatives.map((item) => item.public_id)).toEqual(['R2', 'R3', 'R4', 'R5']);
    expect(queryMock).toHaveBeenCalledWith(expect.any(String), ['lemon pasta', 5]);
  });
});
