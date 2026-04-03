'use strict';

const {
  mdv2,
  bold,
  bullet,
  joinLines,
  finalizeMarkdownV2,
} = require('@igasovic/n8n-blocks/shared/telegram-markdown.js');

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function recipeHeader(recipe) {
  const title = asText(recipe.title) || 'Untitled recipe';
  const publicId = asText(recipe.public_id);
  const status = asText(recipe.status) || 'active';

  const lines = [
    `${bold(title)} ${publicId ? `\\(#${mdv2(publicId)}\\)` : ''}`.trim(),
    `Status: ${mdv2(status)}`,
  ];

  const timings = [];
  if (recipe.prep_time_minutes !== null && recipe.prep_time_minutes !== undefined && recipe.prep_time_minutes !== '') {
    timings.push(`prep ${mdv2(String(recipe.prep_time_minutes))}m`);
  }
  if (recipe.cook_time_minutes !== null && recipe.cook_time_minutes !== undefined && recipe.cook_time_minutes !== '') {
    timings.push(`cook ${mdv2(String(recipe.cook_time_minutes))}m`);
  }
  if (recipe.total_time_minutes !== null && recipe.total_time_minutes !== undefined && recipe.total_time_minutes !== '') {
    timings.push(`total ${mdv2(String(recipe.total_time_minutes))}m`);
  }
  if (timings.length) lines.push(`Time: ${timings.join(', ')}`);

  const facets = [];
  if (asText(recipe.servings)) facets.push(`servings ${mdv2(String(recipe.servings))}`);
  if (asText(recipe.cuisine)) facets.push(`cuisine ${mdv2(recipe.cuisine)}`);
  if (asText(recipe.protein)) facets.push(`protein ${mdv2(recipe.protein)}`);
  if (asText(recipe.difficulty)) facets.push(`difficulty ${mdv2(recipe.difficulty)}`);
  if (facets.length) lines.push(facets.join(', '));

  const reviewReasons = safeArray(recipe.review_reasons).map((v) => asText(v)).filter(Boolean);
  if (reviewReasons.length) {
    lines.push(`Review: ${reviewReasons.map((r) => mdv2(r)).join(', ')}`);
  }

  const tags = safeArray(recipe.tags).map((v) => asText(v)).filter(Boolean);
  if (tags.length) {
    lines.push(`Tags: ${tags.map((t) => `\\#${mdv2(t.replace(/\s+/g, '_'))}`).join(' ')}`);
  }

  return lines;
}

function renderFullRecipe(recipe) {
  const ingredients = safeArray(recipe.ingredients).map((item) => asText(item)).filter(Boolean);
  const instructions = safeArray(recipe.instructions).map((item) => asText(item)).filter(Boolean);
  const notes = asText(recipe.notes);

  const lines = [
    bold('Recipe'),
    ...recipeHeader(recipe),
    '',
    bold('Ingredients'),
    ...(ingredients.length ? ingredients.map((item) => bullet(item)) : [bullet('none')]),
    '',
    bold('Instructions'),
    ...(instructions.length
      ? instructions.map((item, idx) => `${mdv2(String(idx + 1))}\\. ${mdv2(item)}`)
      : [bullet('none')]),
  ];

  if (notes) {
    lines.push('', bold('Notes'), mdv2(notes));
  }

  return joinLines(lines, { trimTrailing: true });
}

function renderSearch(payload) {
  const query = asText(payload.query);
  const topHit = payload.top_hit && typeof payload.top_hit === 'object' ? payload.top_hit : null;
  const alternatives = safeArray(payload.alternatives)
    .map((item) => (item && typeof item === 'object' ? item : null))
    .filter(Boolean);

  if (!topHit) {
    return joinLines([
      bold('Recipe search'),
      query ? `Query: ${mdv2(query)}` : null,
      '',
      'No recipe matched that query\\.',
    ], { trimTrailing: true });
  }

  const lines = [
    bold('Recipe match'),
    query ? `Query: ${mdv2(query)}` : null,
    '',
    ...recipeHeader(topHit),
  ];

  if (alternatives.length) {
    lines.push('', bold('Alternatives'));
    for (const alt of alternatives.slice(0, 2)) {
      const title = asText(alt.title) || 'Untitled';
      const publicId = asText(alt.public_id);
      lines.push(bullet(`${title}${publicId ? ` (#${publicId})` : ''}`));
    }
  }

  return joinLines(lines, { trimTrailing: true });
}

module.exports = async function run(ctx) {
  const { $json } = ctx;
  const payload = $json || {};

  const isSearchPayload = Object.prototype.hasOwnProperty.call(payload, 'top_hit')
    || Object.prototype.hasOwnProperty.call(payload, 'alternatives')
    || Object.prototype.hasOwnProperty.call(payload, 'query');

  const telegram_message = isSearchPayload
    ? renderSearch(payload)
    : renderFullRecipe(payload);

  return [{
    json: {
      ...payload,
      telegram_message: finalizeMarkdownV2(telegram_message, { maxLen: 4000 }),
    },
  }];
};
