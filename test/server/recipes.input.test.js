'use strict';

const {
  buildCreatePayload,
  buildPatchPayload,
  buildOverwritePayload,
  buildLinkPayload,
  buildAppendNotePayload,
  capitalizeFirstLetter,
  statusForWrite,
  buildReviewReasons,
} = require('../../src/server/recipes/recipe-input.js');

describe('recipe input normalization', () => {
  test('buildCreatePayload parses canonical capture text', () => {
    const payload = buildCreatePayload({
      capture_text: `# Lemon Pasta\n\n- Servings: 4\n- Cuisine: Italian\n- Protein: None\n- Prep time: 15\n- Cook time: 20\n- Difficulty: Easy\n- Tags: weeknight, pasta\n\n## Ingredients\n- 300g pasta\n- lemon zest\n\n## Instructions\n1. Boil pasta\n2. Toss with lemon\n\n## Notes\n- finish with parmesan`,
    });

    expect(payload.title).toBe('Lemon Pasta');
    expect(payload.title_normalized).toBe('lemon pasta');
    expect(payload.servings).toBe(4);
    expect(payload.ingredients).toEqual(['300g pasta', 'lemon zest']);
    expect(payload.instructions).toEqual(['Boil pasta', 'Toss with lemon']);
    expect(payload.tags).toEqual(['weeknight', 'pasta']);
    expect(payload.overnight).toBe(false);
    expect(payload.search_text).toContain('Lemon Pasta');
  });

  test('buildPatchPayload normalizes title and public id', () => {
    const parsed = buildPatchPayload({
      public_id: 'r42',
      patch: {
        title: '  Updated   Pasta  ',
      },
    });

    expect(parsed.public_id).toBe('R42');
    expect(parsed.patch.title).toBe('Updated Pasta');
    expect(parsed.patch.title_normalized).toBe('updated pasta');
  });

  test('buildOverwritePayload requires valid public id and full recipe payload', () => {
    const parsed = buildOverwritePayload({
      public_id: 'R10',
      recipe: {
        title: 'Tomato Soup',
        servings: 2,
        ingredients: ['tomatoes'],
        instructions: ['blend'],
        capture_text: '# Tomato Soup\n## Ingredients\n- tomatoes\n## Instructions\n1. blend',
      },
    });

    expect(parsed.public_id).toBe('R10');
    expect(parsed.recipe.title).toBe('Tomato Soup');
    expect(parsed.recipe.servings).toBe(2);
  });

  test('statusForWrite preserves archived rows unless explicitly changed', () => {
    const reasons = buildReviewReasons({
      cuisine: null,
      protein: null,
      prep_time_minutes: null,
      cook_time_minutes: null,
      difficulty: null,
      servings: 4,
    });

    expect(statusForWrite('archived', null, reasons)).toBe('archived');
    expect(statusForWrite('needs_review', null, reasons)).toBe('needs_review');
    expect(statusForWrite('active', 'archived', reasons)).toBe('archived');
  });

  test('buildLinkPayload normalizes two public ids and blocks self-link', () => {
    const parsed = buildLinkPayload({
      public_id_1: 'r2',
      public_id_2: 'R123',
    });

    expect(parsed.public_id_1).toBe('R2');
    expect(parsed.public_id_2).toBe('R123');
    expect(() => buildLinkPayload({ public_id_1: 'R4', public_id_2: 'r4' })).toThrow('must be different recipes');
  });

  test('buildAppendNotePayload requires note and auto-capitalizes first letter', () => {
    const parsed = buildAppendNotePayload({
      public_id: 'r123',
      note: 'this is a very important note.',
    });

    expect(parsed.public_id).toBe('R123');
    expect(parsed.note).toBe('This is a very important note.');
    expect(capitalizeFirstLetter('  note')).toBe('Note');
  });
});
