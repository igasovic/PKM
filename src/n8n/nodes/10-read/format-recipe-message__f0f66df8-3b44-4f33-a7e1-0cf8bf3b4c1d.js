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

function formatDuration(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).trim());
  if (!Number.isFinite(n) || n < 0) return asText(value) || null;
  const mins = Math.trunc(n);
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 1) return `${mins}min`;
  if (rem === 0) return `${hours}h`;
  return `${hours}h${rem}min`;
}

function parseNoteLines(notes) {
  if (Array.isArray(notes)) {
    return notes.map((item) => asText(item)).filter(Boolean);
  }
  return asText(notes)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function recipeHeader(recipe) {
  const title = asText(recipe.title) || 'Untitled recipe';
  const publicId = asText(recipe.public_id);
  const status = asText(recipe.status) || 'active';
  const isActive = status.toLowerCase() === 'active';

  const lines = [`${bold(title)} ${publicId ? `\\(\\#${mdv2(publicId)}\\)` : ''}`.trim()];
  if (!isActive) {
    lines.push(`Status: ${mdv2(status)}`);
  }

  const timings = [];
  const prep = formatDuration(recipe.prep_time_minutes);
  const cook = formatDuration(recipe.cook_time_minutes);
  const total = formatDuration(recipe.total_time_minutes);
  if (prep) timings.push(`prep ${mdv2(prep)}`);
  if (cook) timings.push(`cook ${mdv2(cook)}`);
  if (total) timings.push(`total ${mdv2(total)}`);
  if (timings.length) lines.push(`Time: ${timings.join(', ')}`);

  const facets = [];
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
  const notes = parseNoteLines(recipe.notes);
  const url = asText(recipe.url_canonical || recipe.url);
  const servings = asText(recipe.servings);
  const ingredientsHeader = servings ? `Ingredients (${servings} servings)` : 'Ingredients';

  const lines = [
    bold('Recipe'),
    ...recipeHeader(recipe),
    ...(url ? [`URL: ${mdv2(url)}`] : []),
    '',
    bold(ingredientsHeader),
    ...(ingredients.length ? ingredients.map((item) => bullet(item)) : [bullet('none')]),
    '',
    bold('Instructions'),
    ...(instructions.length
      ? instructions.map((item, idx) => `${mdv2(String(idx + 1))}\\. ${mdv2(item)}`)
      : [bullet('none')]),
  ];

  if (notes.length) {
    lines.push('', bold('Notes'), ...notes.map((item) => bullet(item)));
  }

  const seeAlso = safeArray(recipe.linked_recipes)
    .map((item) => (item && typeof item === 'object' ? item : null))
    .filter(Boolean);
  if (seeAlso.length) {
    lines.push('', bold('See Also'));
    for (const link of seeAlso) {
      const title = asText(link.title) || 'Untitled';
      const publicId = asText(link.public_id);
      lines.push(bullet(`${title}${publicId ? ` (#${publicId})` : ''}`));
    }
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
