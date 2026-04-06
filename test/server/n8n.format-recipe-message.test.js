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
        prep_time_minutes: 45,
        cook_time_minutes: 90,
        total_time_minutes: 135,
        ingredients: ['300g pasta', 'lemon zest'],
        instructions: ['Boil pasta', 'Toss with lemon'],
        notes: 'Finish with parmesan\nServe immediately',
        review_reasons: ['missing_protein'],
        tags: ['weeknight', 'pasta'],
        url_canonical: 'https://www.youtube.com/watch?v=Es3B8Swni14',
        linked_recipes: [
          { public_id: 'R2', title: 'Ragu Bolognese' },
          { public_id: 'R123', title: 'Pico de Gallo' },
        ],
      },
    });

    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    const message = out[0].json.telegram_message;
    expect(message).toContain('*Recipe*');
    expect(message).toContain('Lemon Pasta');
    expect(message).toContain('\\(\\#R42\\)');
    expect(message).toContain('Status: needs\\_review');
    expect(message).toContain('Time: prep 45min, cook 1h30min, total 2h15min');
    expect(message).toContain('*Ingredients \\(4 servings\\)*');
    expect(message).toContain('*Instructions*');
    expect(message).toContain('1\\. Boil pasta');
    expect(message).toContain('\\#weeknight');
    expect(message).toContain('URL: https://www\\.youtube\\.com/watch?v\\=Es3B8Swni14');
    expect(message).toContain('*Notes*');
    expect(message).toContain('• Finish with parmesan');
    expect(message).toContain('• Serve immediately');
    expect(message).toContain('*See Also*');
    expect(message).toContain('• Ragu Bolognese \\(\\#R2\\)');
    expect(message).toContain('• Pico de Gallo \\(\\#R123\\)');
    expect(message.indexOf('Tags:')).toBeLessThan(message.indexOf('URL:'));
    expect(message.indexOf('URL:')).toBeLessThan(message.indexOf('*Ingredients \\(4 servings\\)*'));
  });

  test('omits status line when recipe is active', async () => {
    const out = await formatRecipeMessage({
      $json: {
        public_id: 'R7',
        title: 'Tomato Soup',
        status: 'active',
        servings: 2,
        ingredients: ['tomatoes'],
        instructions: ['Simmer'],
      },
    });

    const message = out[0].json.telegram_message;
    expect(message).not.toContain('Status:');
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
