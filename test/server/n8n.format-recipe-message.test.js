'use strict';

const formatRecipeMessage = require('../../src/n8n/nodes/10-read/format-recipe-message__f0f66df8-3b44-4f33-a7e1-0cf8bf3b4c1d.js');

describe('n8n format-recipe-message', () => {
  test('formats full recipe payload for direct get/create responses', async () => {
    const out = await formatRecipeMessage({
      $json: {
        public_id: 'R42',
        title: 'Lemon Pasta',
        status: 'needs_review',
        servings: 4,
        cuisine: 'Italian',
        protein: 'None',
        difficulty: 'Easy',
        prep_time_minutes: 15,
        cook_time_minutes: 20,
        total_time_minutes: 35,
        ingredients: ['300g pasta', 'lemon zest'],
        instructions: ['Boil pasta', 'Toss with lemon'],
        notes: 'Finish with parmesan',
        review_reasons: ['missing_protein'],
        tags: ['weeknight', 'pasta'],
      },
    });

    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    const message = out[0].json.telegram_message;
    expect(message).toContain('*Recipe*');
    expect(message).toContain('Lemon Pasta');
    expect(message).toContain('\\(\\#R42\\)');
    expect(message).toContain('*Ingredients*');
    expect(message).toContain('*Instructions*');
    expect(message).toContain('1\\. Boil pasta');
    expect(message).toContain('\\#weeknight');
  });

  test('formats search payload without top hit as no-match', async () => {
    const out = await formatRecipeMessage({
      $json: {
        query: 'unknown dish',
        top_hit: null,
        alternatives: [],
      },
    });

    const message = out[0].json.telegram_message;
    expect(message).toContain('*Recipe search*');
    expect(message).toContain('No recipe matched that query\\.');
  });

  test('formats search payload with top hit and alternatives', async () => {
    const out = await formatRecipeMessage({
      $json: {
        query: 'pasta',
        top_hit: {
          public_id: 'R9',
          title: 'Creamy Pasta',
          status: 'active',
          servings: 2,
          ingredients: [],
          instructions: [],
          review_reasons: [],
        },
        alternatives: [
          { public_id: 'R10', title: 'Lemon Pasta' },
          { public_id: 'R11', title: 'Tomato Pasta' },
        ],
      },
    });

    const message = out[0].json.telegram_message;
    expect(message).toContain('*Recipe match*');
    expect(message).toContain('Creamy Pasta');
    expect(message).toContain('*Alternatives*');
    expect(message).toContain('Lemon Pasta');
    expect(message).toContain('Tomato Pasta');
  });
});
