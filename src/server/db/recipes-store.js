'use strict';

const sb = require('../../libs/sql-builder.js');
const { getPool } = require('../db-pool.js');
const { traceDb } = require('../logger/braintrust.js');
const { getConfigWithTestMode } = require('./runtime-store.js');
const {
  buildSearchText,
  buildReviewReasons,
  upsertReviewMetadata,
  mergeObjects,
  statusForWrite,
  badRequest,
} = require('../recipes/recipe-input.js');

const RECIPE_COLUMNS = [
  'id',
  'public_id',
  'created_at',
  'updated_at',
  'title',
  'title_normalized',
  'servings',
  'ingredients',
  'instructions',
  'notes',
  'search_text',
  'status',
  'metadata',
  'source',
  'cuisine',
  'protein',
  'prep_time_minutes',
  'cook_time_minutes',
  'total_time_minutes',
  'difficulty',
  'tags',
  'url_canonical',
  'capture_text',
  'overnight',
].join(', ');

function resolveSchemaFromConfig(config) {
  const cfg = config && config.db ? config.db : {};
  const candidate = cfg.is_test_mode ? cfg.schema_test : cfg.schema_prod;
  if (sb.isValidIdent(candidate)) return candidate;
  return cfg.is_test_mode ? 'pkm_test' : 'pkm';
}

async function getRecipesTableFromActiveConfig() {
  const config = await getConfigWithTestMode();
  const schema = resolveSchemaFromConfig(config);
  return sb.qualifiedTable(schema, 'recipes');
}

function parseReviewReasons(metadata) {
  if (!metadata || typeof metadata !== 'object') return [];
  const review = metadata.review;
  if (!review || typeof review !== 'object') return [];
  const reasons = review.reasons;
  if (!Array.isArray(reasons)) return [];
  return reasons
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function mapRecipeRow(row) {
  if (!row || typeof row !== 'object') return null;
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : null;
  return {
    id: row.id,
    public_id: row.public_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    title: row.title,
    title_normalized: row.title_normalized,
    servings: row.servings,
    ingredients: Array.isArray(row.ingredients) ? row.ingredients : [],
    instructions: Array.isArray(row.instructions) ? row.instructions : [],
    notes: row.notes || null,
    search_text: row.search_text,
    status: row.status,
    metadata,
    source: row.source || null,
    cuisine: row.cuisine || null,
    protein: row.protein || null,
    prep_time_minutes: row.prep_time_minutes,
    cook_time_minutes: row.cook_time_minutes,
    total_time_minutes: row.total_time_minutes,
    difficulty: row.difficulty || null,
    tags: Array.isArray(row.tags) ? row.tags : null,
    url_canonical: row.url_canonical || null,
    capture_text: row.capture_text,
    overnight: !!row.overnight,
    review_reasons: parseReviewReasons(metadata),
  };
}

function wrapRecipesTableError(err, table) {
  if (!err) return err;
  if (err.code === '42P01' || err.code === '3F000') {
    const wrapped = new Error(`recipes table missing: create ${table} before using recipe endpoints`);
    wrapped.cause = err;
    wrapped.statusCode = 500;
    return wrapped;
  }
  return err;
}

async function lookupExistingPublicIdByTitleNormalized(table, titleNormalized, excludePublicId = null) {
  const clauses = ['title_normalized = $1'];
  const params = [titleNormalized];
  if (excludePublicId) {
    clauses.push('public_id <> $2');
    params.push(excludePublicId);
  }
  const sql = `SELECT public_id, title FROM ${table} WHERE ${clauses.join(' AND ')} LIMIT 1`;
  const res = await traceDb('recipes_duplicate_lookup', {
    table,
    has_exclusion: !!excludePublicId,
  }, () => getPool().query(sql, params));
  return res.rows && res.rows[0] ? res.rows[0] : null;
}

function buildDuplicateTitleError(existingPublicId) {
  const err = new Error('duplicate recipe title');
  err.statusCode = 409;
  err.code = 'recipe_duplicate_title';
  if (existingPublicId) {
    err.existing_public_id = existingPublicId;
  }
  return err;
}

async function getRecipeByPublicId(publicId, opts = {}) {
  const includeArchived = opts.includeArchived !== false;
  const table = opts.table || await getRecipesTableFromActiveConfig();
  const filters = ['public_id = $1'];
  if (!includeArchived) {
    filters.push(`status <> 'archived'`);
  }
  const sql = `SELECT ${RECIPE_COLUMNS} FROM ${table} WHERE ${filters.join(' AND ')} LIMIT 1`;
  try {
    const result = await traceDb('recipes_get_by_public_id', {
      table,
      include_archived: includeArchived,
    }, () => getPool().query(sql, [publicId]));
    return result.rows && result.rows[0] ? mapRecipeRow(result.rows[0]) : null;
  } catch (err) {
    throw wrapRecipesTableError(err, table);
  }
}

async function createRecipe(payload) {
  const table = await getRecipesTableFromActiveConfig();
  const reviewReasons = buildReviewReasons(payload);
  const status = statusForWrite(null, payload.requested_status, reviewReasons);
  const metadata = upsertReviewMetadata(
    mergeObjects(payload.metadata, payload.parser_meta ? { parser: payload.parser_meta } : null),
    reviewReasons
  );

  const sql = `
    INSERT INTO ${table} (
      title,
      title_normalized,
      servings,
      ingredients,
      instructions,
      notes,
      search_text,
      status,
      metadata,
      source,
      cuisine,
      protein,
      prep_time_minutes,
      cook_time_minutes,
      difficulty,
      tags,
      url_canonical,
      capture_text,
      overnight,
      created_at,
      updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now(),now()
    )
    ON CONFLICT (title_normalized) DO NOTHING
    RETURNING ${RECIPE_COLUMNS}
  `;

  const params = [
    payload.title,
    payload.title_normalized,
    payload.servings,
    payload.ingredients,
    payload.instructions,
    payload.notes,
    payload.search_text,
    status,
    JSON.stringify(metadata),
    payload.source,
    payload.cuisine,
    payload.protein,
    payload.prep_time_minutes,
    payload.cook_time_minutes,
    payload.difficulty,
    payload.tags,
    payload.url_canonical,
    payload.capture_text,
    payload.overnight,
  ];

  try {
    const result = await traceDb('recipes_create', {
      table,
      status,
      ingredient_count: payload.ingredients.length,
      instruction_count: payload.instructions.length,
    }, () => getPool().query(sql, params));

    if (result.rows && result.rows[0]) {
      return mapRecipeRow(result.rows[0]);
    }

    const existing = await lookupExistingPublicIdByTitleNormalized(table, payload.title_normalized);
    throw buildDuplicateTitleError(existing && existing.public_id ? existing.public_id : null);
  } catch (err) {
    if (err && err.code === '23505') {
      const existing = await lookupExistingPublicIdByTitleNormalized(table, payload.title_normalized);
      throw buildDuplicateTitleError(existing && existing.public_id ? existing.public_id : null);
    }
    throw wrapRecipesTableError(err, table);
  }
}

function buildMergedRecipe(current, incoming, opts = {}) {
  const overwrite = opts.overwrite === true;
  const merged = {
    ...current,
    title: incoming.title ?? current.title,
    title_normalized: incoming.title_normalized ?? current.title_normalized,
    servings: incoming.servings ?? current.servings,
    ingredients: incoming.ingredients ?? current.ingredients,
    instructions: incoming.instructions ?? current.instructions,
    notes: Object.prototype.hasOwnProperty.call(incoming, 'notes') ? incoming.notes : current.notes,
    source: Object.prototype.hasOwnProperty.call(incoming, 'source') ? incoming.source : current.source,
    cuisine: Object.prototype.hasOwnProperty.call(incoming, 'cuisine') ? incoming.cuisine : current.cuisine,
    protein: Object.prototype.hasOwnProperty.call(incoming, 'protein') ? incoming.protein : current.protein,
    prep_time_minutes: Object.prototype.hasOwnProperty.call(incoming, 'prep_time_minutes')
      ? incoming.prep_time_minutes
      : current.prep_time_minutes,
    cook_time_minutes: Object.prototype.hasOwnProperty.call(incoming, 'cook_time_minutes')
      ? incoming.cook_time_minutes
      : current.cook_time_minutes,
    difficulty: Object.prototype.hasOwnProperty.call(incoming, 'difficulty') ? incoming.difficulty : current.difficulty,
    tags: Object.prototype.hasOwnProperty.call(incoming, 'tags') ? incoming.tags : current.tags,
    url_canonical: Object.prototype.hasOwnProperty.call(incoming, 'url_canonical')
      ? incoming.url_canonical
      : current.url_canonical,
    capture_text: Object.prototype.hasOwnProperty.call(incoming, 'capture_text')
      ? incoming.capture_text
      : current.capture_text,
    overnight: Object.prototype.hasOwnProperty.call(incoming, 'overnight') ? incoming.overnight : current.overnight,
  };

  if (overwrite) {
    merged.metadata = incoming.metadata || null;
  } else if (Object.prototype.hasOwnProperty.call(incoming, 'metadata')) {
    merged.metadata = mergeObjects(current.metadata, incoming.metadata);
  } else {
    merged.metadata = current.metadata;
  }

  if (incoming.parser_meta) {
    merged.metadata = mergeObjects(merged.metadata, { parser: incoming.parser_meta });
  }

  merged.search_text = buildSearchText(merged);
  if (!merged.search_text) {
    throw badRequest('search_text cannot be empty');
  }

  const reviewReasons = buildReviewReasons(merged);
  merged.status = statusForWrite(current.status, incoming.requested_status, reviewReasons);
  merged.metadata = upsertReviewMetadata(merged.metadata, reviewReasons);

  return merged;
}

async function persistUpdatedRecipe(table, publicId, merged) {
  const sql = `
    UPDATE ${table}
    SET
      title = $2,
      title_normalized = $3,
      servings = $4,
      ingredients = $5,
      instructions = $6,
      notes = $7,
      search_text = $8,
      status = $9,
      metadata = $10::jsonb,
      source = $11,
      cuisine = $12,
      protein = $13,
      prep_time_minutes = $14,
      cook_time_minutes = $15,
      difficulty = $16,
      tags = $17,
      url_canonical = $18,
      capture_text = $19,
      overnight = $20,
      updated_at = now()
    WHERE public_id = $1
    RETURNING ${RECIPE_COLUMNS}
  `;

  const params = [
    publicId,
    merged.title,
    merged.title_normalized,
    merged.servings,
    merged.ingredients,
    merged.instructions,
    merged.notes,
    merged.search_text,
    merged.status,
    JSON.stringify(merged.metadata || {}),
    merged.source,
    merged.cuisine,
    merged.protein,
    merged.prep_time_minutes,
    merged.cook_time_minutes,
    merged.difficulty,
    merged.tags,
    merged.url_canonical,
    merged.capture_text,
    merged.overnight,
  ];

  const result = await traceDb('recipes_update', {
    table,
    status: merged.status,
  }, () => getPool().query(sql, params));

  if (!result.rows || !result.rows[0]) return null;
  return mapRecipeRow(result.rows[0]);
}

async function patchRecipe(publicId, patch) {
  const table = await getRecipesTableFromActiveConfig();
  const current = await getRecipeByPublicId(publicId, { includeArchived: true, table });
  if (!current) return null;

  let merged;
  try {
    merged = buildMergedRecipe(current, patch, { overwrite: false });
  } catch (err) {
    throw wrapRecipesTableError(err, table);
  }

  try {
    return await persistUpdatedRecipe(table, publicId, merged);
  } catch (err) {
    if (err && err.code === '23505') {
      const existing = await lookupExistingPublicIdByTitleNormalized(table, merged.title_normalized, publicId);
      throw buildDuplicateTitleError(existing && existing.public_id ? existing.public_id : null);
    }
    throw wrapRecipesTableError(err, table);
  }
}

async function overwriteRecipe(publicId, payload) {
  const table = await getRecipesTableFromActiveConfig();
  const current = await getRecipeByPublicId(publicId, { includeArchived: true, table });
  if (!current) return null;

  let merged;
  try {
    merged = buildMergedRecipe(current, payload, { overwrite: true });
  } catch (err) {
    throw wrapRecipesTableError(err, table);
  }

  try {
    return await persistUpdatedRecipe(table, publicId, merged);
  } catch (err) {
    if (err && err.code === '23505') {
      const existing = await lookupExistingPublicIdByTitleNormalized(table, merged.title_normalized, publicId);
      throw buildDuplicateTitleError(existing && existing.public_id ? existing.public_id : null);
    }
    throw wrapRecipesTableError(err, table);
  }
}

async function searchRecipes(opts) {
  const table = await getRecipesTableFromActiveConfig();
  const q = String((opts && opts.q) || '').trim().toLowerCase();
  if (!q) {
    throw badRequest('q is required');
  }

  const alternativesCount = Number(opts && opts.alternatives_count);
  const limitRaw = Number.isFinite(alternativesCount) ? alternativesCount : 2;
  const limit = Math.max(0, Math.min(5, Math.trunc(limitRaw))) + 1;

  const sql = `
    WITH query_input AS (
      SELECT
        $1::text AS q,
        lower($1::text) AS qnorm,
        plainto_tsquery('simple', lower($1::text)) AS tsq,
        array_remove(regexp_split_to_array(lower($1::text), '\\s+'), '') AS tokens
    )
    SELECT
      ${RECIPE_COLUMNS},
      (
        CASE WHEN r.title_normalized = qi.qnorm THEN 120 ELSE 0 END +
        CASE WHEN r.title_normalized LIKE '%' || qi.qnorm || '%' THEN 60 ELSE 0 END +
        COALESCE(ts_rank_cd(to_tsvector('simple', lower(r.search_text)), qi.tsq), 0) * 40 +
        CASE WHEN r.cuisine IS NOT NULL AND lower(r.cuisine) LIKE '%' || qi.qnorm || '%' THEN 12 ELSE 0 END +
        CASE WHEN r.protein IS NOT NULL AND lower(r.protein) LIKE '%' || qi.qnorm || '%' THEN 12 ELSE 0 END +
        CASE WHEN r.difficulty IS NOT NULL AND lower(r.difficulty) LIKE '%' || qi.qnorm || '%' THEN 8 ELSE 0 END +
        (
          SELECT COALESCE(SUM(
            CASE
              WHEN token <> '' AND (
                lower(r.title) LIKE '%' || token || '%' OR
                lower(array_to_string(r.ingredients, ' ')) LIKE '%' || token || '%' OR
                (r.tags IS NOT NULL AND lower(array_to_string(r.tags, ' ')) LIKE '%' || token || '%')
              ) THEN 3
              ELSE 0
            END
          ), 0)
          FROM unnest(qi.tokens) AS token
        )
      ) AS lexical_score
    FROM ${table} r
    CROSS JOIN query_input qi
    WHERE
      r.status <> 'archived'
      AND (
        lower(r.title) LIKE '%' || qi.qnorm || '%' OR
        lower(r.search_text) LIKE '%' || qi.qnorm || '%' OR
        to_tsvector('simple', lower(r.search_text)) @@ qi.tsq
      )
    ORDER BY lexical_score DESC, r.updated_at DESC
    LIMIT $2
  `;

  try {
    const result = await traceDb('recipes_search', {
      table,
      limit,
      q_len: q.length,
    }, () => getPool().query(sql, [q, limit]));

    const rows = Array.isArray(result.rows) ? result.rows.map((row) => mapRecipeRow(row)) : [];
    const top = rows[0] || null;
    const alternatives = rows.slice(1, 3).map((row) => ({
      public_id: row.public_id,
      title: row.title,
      status: row.status,
      review_reasons: row.review_reasons,
      cuisine: row.cuisine,
      protein: row.protein,
      difficulty: row.difficulty,
      total_time_minutes: row.total_time_minutes,
      tags: row.tags,
      updated_at: row.updated_at,
    }));

    return {
      query: q,
      top_hit: top,
      alternatives,
      total_candidates: rows.length,
    };
  } catch (err) {
    throw wrapRecipesTableError(err, table);
  }
}

async function listReviewQueue(opts = {}) {
  const table = await getRecipesTableFromActiveConfig();
  const raw = Number(opts.limit || 50);
  const limit = Number.isFinite(raw) ? Math.max(1, Math.min(200, Math.trunc(raw))) : 50;
  const sql = `
    SELECT ${RECIPE_COLUMNS}
    FROM ${table}
    WHERE status = 'needs_review'
    ORDER BY created_at ASC
    LIMIT $1
  `;

  try {
    const result = await traceDb('recipes_review_queue', {
      table,
      limit,
    }, () => getPool().query(sql, [limit]));

    const rows = Array.isArray(result.rows) ? result.rows.map((row) => {
      const mapped = mapRecipeRow(row);
      return {
        id: mapped.id,
        public_id: mapped.public_id,
        title: mapped.title,
        status: mapped.status,
        review_reasons: mapped.review_reasons,
        created_at: mapped.created_at,
      };
    }) : [];

    return {
      rows,
      limit,
    };
  } catch (err) {
    throw wrapRecipesTableError(err, table);
  }
}

module.exports = {
  getRecipeByPublicId,
  createRecipe,
  patchRecipe,
  overwriteRecipe,
  searchRecipes,
  listReviewQueue,
};
