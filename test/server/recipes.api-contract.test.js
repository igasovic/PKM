'use strict';

const http = require('http');

function request(port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body: text, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('recipes API contract', () => {
  let server = null;
  let port = null;
  let envBackup;
  let listenDenied = false;
  let recipesRepoMock;

  beforeEach(() => {
    jest.resetModules();
    listenDenied = false;
    envBackup = { ...process.env };
    process.env.PKM_ADMIN_SECRET = 'test-admin-secret';

    recipesRepoMock = {
      createRecipe: jest.fn(async () => ({
        public_id: 'R1',
        title: 'Pasta',
        status: 'active',
        review_reasons: [],
      })),
      searchRecipes: jest.fn(async () => ({
        query: 'pasta',
        top_hit: {
          public_id: 'R1',
          title: 'Pasta',
          status: 'active',
          ingredients: ['pasta'],
          instructions: ['boil'],
          review_reasons: [],
        },
        alternatives: [
          { public_id: 'R2', title: 'Bolognese', status: 'active', review_reasons: [] },
          { public_id: 'R3', title: 'Lasagna', status: 'needs_review', review_reasons: ['missing_cuisine'] },
        ],
        total_candidates: 3,
      })),
      getRecipeByPublicId: jest.fn(async () => ({
        public_id: 'R1',
        title: 'Pasta',
        status: 'active',
      })),
      patchRecipe: jest.fn(async () => ({
        public_id: 'R1',
        title: 'Pasta v2',
        status: 'needs_review',
        review_reasons: ['missing_cuisine'],
      })),
      overwriteRecipe: jest.fn(async () => ({
        public_id: 'R1',
        title: 'Pasta complete',
        status: 'active',
        review_reasons: [],
      })),
      linkRecipes: jest.fn(async () => ({
        public_id: 'R1',
        title: 'Pasta',
        status: 'active',
        linked_recipes: [
          { public_id: 'R2', title: 'Ragu Bolognese', status: 'active' },
        ],
      })),
      appendRecipeNote: jest.fn(async () => ({
        public_id: 'R1',
        title: 'Pasta',
        status: 'active',
        notes: 'Old note\nThis is important.',
      })),
      listReviewQueue: jest.fn(async () => ({
        rows: [
          {
            id: 2,
            public_id: 'R2',
            title: 'Needs review',
            status: 'needs_review',
            review_reasons: ['missing_cuisine'],
            created_at: '2026-04-02T00:00:00.000Z',
          },
        ],
        limit: 25,
      })),
    };

    jest.doMock('../../src/server/repositories/recipes-repository.js', () => recipesRepoMock);
    jest.doMock('../../src/server/tier1-enrichment.js', () => ({
      getTier1BatchStatusList: async () => ({ summary: {}, jobs: [] }),
      getTier1BatchStatus: async () => null,
      startTier1BatchWorker: () => {},
      stopTier1BatchWorker: () => {},
      enrichTier1: jest.fn(),
      enqueueTier1Batch: jest.fn(),
    }));
    jest.doMock('../../src/server/tier2-enrichment.js', () => ({
      getTier2BatchStatusList: async () => ({ summary: {}, jobs: [] }),
      getTier2BatchStatus: async () => null,
      startTier2BatchWorker: () => {},
      stopTier2BatchWorker: () => {},
      runTier2BatchWorkerCycle: jest.fn(),
    }));
  });

  afterEach(async () => {
    if (server && server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    server = null;
    port = null;
    process.env = envBackup;
  });

  async function startServer() {
    const { createServer } = require('../../src/server/index.js');
    server = createServer();
    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => reject(err);
        server.once('error', onError);
        server.listen(0, '127.0.0.1', () => {
          server.off('error', onError);
          resolve();
        });
      });
      port = server.address().port;
    } catch (err) {
      if (err && (err.code === 'EPERM' || err.code === 'EACCES')) {
        listenDenied = true;
        return;
      }
      throw err;
    }
  }

  test('POST /recipes/create creates one recipe', async () => {
    await startServer();
    if (listenDenied) return;

    const body = {
      title: 'Pasta',
      servings: 4,
      ingredients: ['pasta', 'salt'],
      instructions: ['boil water'],
      capture_text: '# Pasta\n## Ingredients\n- pasta\n## Instructions\n1. boil',
    };
    const res = await request(port, 'POST', '/recipes/create', JSON.stringify(body), {
      'Content-Type': 'application/json',
    });

    expect(res.status).toBe(200);
    expect(recipesRepoMock.createRecipe).toHaveBeenCalledTimes(1);
    expect(JSON.parse(res.body)).toEqual(expect.objectContaining({ public_id: 'R1' }));
  });

  test('POST /recipes/create returns duplicate payload on title collision', async () => {
    const duplicateErr = new Error('duplicate recipe title');
    duplicateErr.code = 'recipe_duplicate_title';
    duplicateErr.statusCode = 409;
    duplicateErr.existing_public_id = 'R77';
    recipesRepoMock.createRecipe.mockRejectedValueOnce(duplicateErr);

    await startServer();
    if (listenDenied) return;

    const body = {
      title: 'Pasta',
      servings: 4,
      ingredients: ['pasta'],
      instructions: ['boil'],
      capture_text: '# Pasta\n## Ingredients\n- pasta\n## Instructions\n1. boil',
    };
    const res = await request(port, 'POST', '/recipes/create', JSON.stringify(body), {
      'Content-Type': 'application/json',
    });

    expect(res.status).toBe(409);
    expect(JSON.parse(res.body)).toEqual(expect.objectContaining({
      error: 'duplicate_recipe_title',
      existing_public_id: 'R77',
    }));
  });

  test('POST /recipes/search returns top hit plus alternatives', async () => {
    await startServer();
    if (listenDenied) return;

    const res = await request(port, 'POST', '/recipes/search', JSON.stringify({ q: 'pasta' }), {
      'Content-Type': 'application/json',
    });

    expect(res.status).toBe(200);
    expect(recipesRepoMock.searchRecipes).toHaveBeenCalledWith({ q: 'pasta', alternatives_count: undefined });
    const payload = JSON.parse(res.body);
    expect(payload.top_hit.public_id).toBe('R1');
    expect(payload.alternatives).toHaveLength(2);
  });

  test('POST /recipes/get returns 404 when public_id is missing in store', async () => {
    recipesRepoMock.getRecipeByPublicId.mockResolvedValueOnce(null);
    await startServer();
    if (listenDenied) return;

    const res = await request(port, 'POST', '/recipes/get', JSON.stringify({ public_id: 'R999' }), {
      'Content-Type': 'application/json',
    });

    expect(res.status).toBe(404);
    expect(recipesRepoMock.getRecipeByPublicId).toHaveBeenCalledWith('R999', { includeArchived: true });
  });

  test('POST /recipes/patch forwards public id and patch payload', async () => {
    await startServer();
    if (listenDenied) return;

    const res = await request(port, 'POST', '/recipes/patch', JSON.stringify({
      public_id: 'R1',
      patch: { title: 'Pasta v2' },
    }), {
      'Content-Type': 'application/json',
    });

    expect(res.status).toBe(200);
    expect(recipesRepoMock.patchRecipe).toHaveBeenCalledWith('R1', expect.objectContaining({
      title: 'Pasta v2',
      title_normalized: 'pasta v2',
    }));
  });

  test('POST /recipes/overwrite forwards full payload', async () => {
    await startServer();
    if (listenDenied) return;

    const res = await request(port, 'POST', '/recipes/overwrite', JSON.stringify({
      public_id: 'R1',
      recipe: {
        title: 'Pasta complete',
        servings: 4,
        ingredients: ['pasta'],
        instructions: ['boil'],
        capture_text: '# Pasta complete\n## Ingredients\n- pasta\n## Instructions\n1. boil',
      },
    }), {
      'Content-Type': 'application/json',
    });

    expect(res.status).toBe(200);
    expect(recipesRepoMock.overwriteRecipe).toHaveBeenCalledWith('R1', expect.objectContaining({
      title: 'Pasta complete',
      title_normalized: 'pasta complete',
    }));
  });

  test('GET /recipes/review forwards limit query', async () => {
    await startServer();
    if (listenDenied) return;

    const res = await request(port, 'GET', '/recipes/review?limit=25');

    expect(res.status).toBe(200);
    expect(recipesRepoMock.listReviewQueue).toHaveBeenCalledWith({ limit: 25 });
    expect(JSON.parse(res.body)).toEqual(expect.objectContaining({
      rows: expect.any(Array),
      limit: 25,
    }));
  });

  test('POST /recipes/link forwards recipe id pair', async () => {
    await startServer();
    if (listenDenied) return;

    const res = await request(port, 'POST', '/recipes/link', JSON.stringify({
      public_id_1: 'r1',
      public_id_2: 'R2',
    }), {
      'Content-Type': 'application/json',
    });

    expect(res.status).toBe(200);
    expect(recipesRepoMock.linkRecipes).toHaveBeenCalledWith('R1', 'R2');
    expect(JSON.parse(res.body)).toEqual(expect.objectContaining({
      public_id: 'R1',
      linked_recipes: expect.any(Array),
    }));
  });

  test('POST /recipes/note appends note and returns recipe payload', async () => {
    await startServer();
    if (listenDenied) return;

    const res = await request(port, 'POST', '/recipes/note', JSON.stringify({
      public_id: 'r1',
      note: 'this is important.',
    }), {
      'Content-Type': 'application/json',
    });

    expect(res.status).toBe(200);
    expect(recipesRepoMock.appendRecipeNote).toHaveBeenCalledWith('R1', 'This is important.');
    expect(JSON.parse(res.body)).toEqual(expect.objectContaining({
      public_id: 'R1',
    }));
  });

  test('POST /recipes/note returns 404 when recipe does not exist', async () => {
    recipesRepoMock.appendRecipeNote.mockResolvedValueOnce(null);
    await startServer();
    if (listenDenied) return;

    const res = await request(port, 'POST', '/recipes/note', JSON.stringify({
      public_id: 'R999',
      note: 'missing recipe',
    }), {
      'Content-Type': 'application/json',
    });

    expect(res.status).toBe(404);
    expect(JSON.parse(res.body)).toEqual(expect.objectContaining({
      error: 'not_found',
    }));
  });
});
