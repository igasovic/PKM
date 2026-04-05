'use strict';

const recipesRepository = require('../repositories/recipes-repository.js');
const {
  buildCreatePayload,
  buildPatchPayload,
  buildOverwritePayload,
  buildLinkPayload,
  buildAppendNotePayload,
  normalizePublicId,
} = require('../recipes/recipe-input.js');
const {
  readBody,
  parseJsonBody,
  bindRunIdFromBody,
  json,
  notFound,
  sendError,
} = require('../app/http-utils.js');
const {
  logApiSuccess,
  logApiError,
} = require('../logger/braintrust.js');

function duplicateTitleResponse(res, err) {
  json(res, 409, {
    error: 'duplicate_recipe_title',
    message: err && err.message ? err.message : 'duplicate recipe title',
    existing_public_id: err && err.existing_public_id ? err.existing_public_id : null,
  });
}

async function handleRecipesRoutes(ctx) {
  const {
    req,
    res,
    url,
    method,
    logger,
  } = ctx;

  if (method === 'POST' && url.pathname === '/recipes/create') {
    const start = Date.now();
    const meta = {
      op: 'api_recipes_create',
      method,
      path: url.pathname,
    };

    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const payload = buildCreatePayload(body);

      const created = await logger.step(
        'api.recipes.create',
        async () => recipesRepository.createRecipe(payload),
        {
          input: {
            has_capture_text: !!payload.capture_text,
            ingredient_count: payload.ingredients.length,
            instruction_count: payload.instructions.length,
          },
          output: (out) => ({
            public_id: out && out.public_id ? out.public_id : null,
            status: out && out.status ? out.status : null,
          }),
          meta: { route: url.pathname },
        }
      );

      logApiSuccess(meta, {
        public_id: created.public_id,
        status: created.status,
      }, {
        duration_ms: Date.now() - start,
      });
      json(res, 200, created);
    } catch (err) {
      logApiError(meta, err, { duration_ms: Date.now() - start });
      if (err && err.code === 'recipe_duplicate_title') {
        duplicateTitleResponse(res, err);
      } else {
        sendError(res, err, { includeField: false });
      }
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/recipes/search') {
    const start = Date.now();
    const meta = {
      op: 'api_recipes_search',
      method,
      path: url.pathname,
    };

    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const q = String(body.q || '').trim();
      const alternatives_count = body.alternatives_count;
      const result = await logger.step(
        'api.recipes.search',
        async () => recipesRepository.searchRecipes({ q, alternatives_count }),
        {
          input: {
            q_len: q.length,
            alternatives_count,
          },
          output: (out) => ({
            top_hit: out && out.top_hit ? out.top_hit.public_id : null,
            alternatives: out && Array.isArray(out.alternatives) ? out.alternatives.length : 0,
          }),
          meta: { route: url.pathname },
        }
      );

      logApiSuccess(meta, {
        total_candidates: result.total_candidates,
        has_top_hit: !!result.top_hit,
      }, {
        duration_ms: Date.now() - start,
      });
      json(res, 200, result);
    } catch (err) {
      logApiError(meta, err, { duration_ms: Date.now() - start });
      sendError(res, err, { includeField: false });
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/recipes/get') {
    const start = Date.now();
    const meta = {
      op: 'api_recipes_get',
      method,
      path: url.pathname,
    };

    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const public_id = normalizePublicId(body.public_id);

      const recipe = await logger.step(
        'api.recipes.get',
        async () => recipesRepository.getRecipeByPublicId(public_id, { includeArchived: true }),
        {
          input: { public_id },
          output: (out) => ({ found: !!out }),
          meta: { route: url.pathname },
        }
      );

      if (!recipe) {
        notFound(res);
        return true;
      }

      logApiSuccess(meta, {
        public_id: recipe.public_id,
        status: recipe.status,
      }, {
        duration_ms: Date.now() - start,
      });
      json(res, 200, recipe);
    } catch (err) {
      logApiError(meta, err, { duration_ms: Date.now() - start });
      sendError(res, err, { includeField: false });
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/recipes/patch') {
    const start = Date.now();
    const meta = {
      op: 'api_recipes_patch',
      method,
      path: url.pathname,
    };

    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const parsed = buildPatchPayload(body);

      const recipe = await logger.step(
        'api.recipes.patch',
        async () => recipesRepository.patchRecipe(parsed.public_id, parsed.patch),
        {
          input: {
            public_id: parsed.public_id,
            fields: Object.keys(parsed.patch),
          },
          output: (out) => ({ found: !!out, status: out && out.status ? out.status : null }),
          meta: { route: url.pathname },
        }
      );

      if (!recipe) {
        notFound(res);
        return true;
      }

      logApiSuccess(meta, {
        public_id: recipe.public_id,
        status: recipe.status,
      }, {
        duration_ms: Date.now() - start,
      });
      json(res, 200, recipe);
    } catch (err) {
      logApiError(meta, err, { duration_ms: Date.now() - start });
      if (err && err.code === 'recipe_duplicate_title') {
        duplicateTitleResponse(res, err);
      } else {
        sendError(res, err, { includeField: false });
      }
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/recipes/overwrite') {
    const start = Date.now();
    const meta = {
      op: 'api_recipes_overwrite',
      method,
      path: url.pathname,
    };

    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const parsed = buildOverwritePayload(body);

      const recipe = await logger.step(
        'api.recipes.overwrite',
        async () => recipesRepository.overwriteRecipe(parsed.public_id, parsed.recipe),
        {
          input: {
            public_id: parsed.public_id,
            ingredient_count: parsed.recipe.ingredients.length,
            instruction_count: parsed.recipe.instructions.length,
          },
          output: (out) => ({ found: !!out, status: out && out.status ? out.status : null }),
          meta: { route: url.pathname },
        }
      );

      if (!recipe) {
        notFound(res);
        return true;
      }

      logApiSuccess(meta, {
        public_id: recipe.public_id,
        status: recipe.status,
      }, {
        duration_ms: Date.now() - start,
      });
      json(res, 200, recipe);
    } catch (err) {
      logApiError(meta, err, { duration_ms: Date.now() - start });
      if (err && err.code === 'recipe_duplicate_title') {
        duplicateTitleResponse(res, err);
      } else {
        sendError(res, err, { includeField: false });
      }
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/recipes/link') {
    const start = Date.now();
    const meta = {
      op: 'api_recipes_link',
      method,
      path: url.pathname,
    };

    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const parsed = buildLinkPayload(body);

      const recipe = await logger.step(
        'api.recipes.link',
        async () => recipesRepository.linkRecipes(parsed.public_id_1, parsed.public_id_2),
        {
          input: {
            public_id_1: parsed.public_id_1,
            public_id_2: parsed.public_id_2,
          },
          output: (out) => ({
            public_id: out && out.public_id ? out.public_id : null,
            linked_count: out && Array.isArray(out.linked_recipes) ? out.linked_recipes.length : 0,
          }),
          meta: { route: url.pathname },
        }
      );

      logApiSuccess(meta, {
        public_id: recipe.public_id,
        linked_count: Array.isArray(recipe.linked_recipes) ? recipe.linked_recipes.length : 0,
      }, {
        duration_ms: Date.now() - start,
      });
      json(res, 200, recipe);
    } catch (err) {
      logApiError(meta, err, { duration_ms: Date.now() - start });
      sendError(res, err, { includeField: false });
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/recipes/note') {
    const start = Date.now();
    const meta = {
      op: 'api_recipes_note',
      method,
      path: url.pathname,
    };

    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const parsed = buildAppendNotePayload(body);

      const recipe = await logger.step(
        'api.recipes.note',
        async () => recipesRepository.appendRecipeNote(parsed.public_id, parsed.note),
        {
          input: {
            public_id: parsed.public_id,
            note_len: parsed.note.length,
          },
          output: (out) => ({
            found: !!out,
            public_id: out && out.public_id ? out.public_id : null,
          }),
          meta: { route: url.pathname },
        }
      );

      if (!recipe) {
        notFound(res);
        return true;
      }

      logApiSuccess(meta, {
        public_id: recipe.public_id,
      }, {
        duration_ms: Date.now() - start,
      });
      json(res, 200, recipe);
    } catch (err) {
      logApiError(meta, err, { duration_ms: Date.now() - start });
      sendError(res, err, { includeField: false });
    }
    return true;
  }

  if (method === 'GET' && url.pathname === '/recipes/review') {
    const start = Date.now();
    const meta = {
      op: 'api_recipes_review',
      method,
      path: url.pathname,
    };

    try {
      const limit = Number(url.searchParams.get('limit') || 50);
      const result = await logger.step(
        'api.recipes.review',
        async () => recipesRepository.listReviewQueue({ limit }),
        {
          input: { limit },
          output: (out) => ({ count: out && Array.isArray(out.rows) ? out.rows.length : 0 }),
          meta: { route: url.pathname },
        }
      );

      logApiSuccess(meta, {
        count: result.rows.length,
      }, {
        duration_ms: Date.now() - start,
      });
      json(res, 200, result);
    } catch (err) {
      logApiError(meta, err, { duration_ms: Date.now() - start });
      sendError(res, err, { includeField: false });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleRecipesRoutes,
};
