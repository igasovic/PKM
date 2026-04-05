import type { RecipeReviewQueueResult, RecipeSearchResult, RecipeUpsertPayload } from '../types';

const DEFAULT_TIMEOUT_MS = 20000;

async function postJson(path: string, body: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(path, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body ?? {}),
    });

    const text = await res.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error('server returned invalid JSON');
    }

    if (!res.ok) {
      const err = payload as { message?: string; error?: string; existing_public_id?: string };
      const details = err.existing_public_id
        ? `${err.message || err.error || `http_${res.status}`} (existing: ${err.existing_public_id})`
        : (err.message || err.error || `http_${res.status}`);
      throw new Error(details);
    }

    return payload;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function getJson(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(path, {
      method: 'GET',
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    const text = await res.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error('server returned invalid JSON');
    }

    if (!res.ok) {
      const err = payload as { message?: string; error?: string };
      throw new Error(err.message || err.error || `http_${res.status}`);
    }

    return payload;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function recipeCreateFromCapture(capture_text: string): Promise<RecipeUpsertPayload> {
  return postJson('/recipes/create', { capture_text }) as Promise<RecipeUpsertPayload>;
}

export async function recipeSearch(q: string, alternativesCount = 2): Promise<RecipeSearchResult> {
  return postJson('/recipes/search', { q, alternatives_count: alternativesCount }) as Promise<RecipeSearchResult>;
}

export async function recipeGet(publicId: string): Promise<RecipeUpsertPayload> {
  return postJson('/recipes/get', { public_id: publicId }) as Promise<RecipeUpsertPayload>;
}

export async function recipePatch(publicId: string, patch: Record<string, unknown>): Promise<RecipeUpsertPayload> {
  return postJson('/recipes/patch', { public_id: publicId, patch }) as Promise<RecipeUpsertPayload>;
}

export async function recipeOverwrite(publicId: string, recipe: Record<string, unknown>): Promise<RecipeUpsertPayload> {
  return postJson('/recipes/overwrite', { public_id: publicId, recipe }) as Promise<RecipeUpsertPayload>;
}

export async function recipeLink(publicId1: string, publicId2: string): Promise<RecipeUpsertPayload> {
  return postJson('/recipes/link', { public_id_1: publicId1, public_id_2: publicId2 }) as Promise<RecipeUpsertPayload>;
}

export async function recipeReviewQueue(limit = 50): Promise<RecipeReviewQueueResult> {
  return getJson(`/recipes/review?limit=${encodeURIComponent(String(limit))}`) as Promise<RecipeReviewQueueResult>;
}
