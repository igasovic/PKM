import { useMemo, useState } from 'react';
import {
  recipeCreateFromCapture,
  recipeGet,
  recipeOverwrite,
  recipePatch,
  recipeReviewQueue,
  recipeSearch,
} from '../lib/recipesApi';
import type { RecipeReviewQueueItem, RecipeSearchResult, RecipeUpsertPayload } from '../types';

function toPretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function parseObjectJson(raw: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export function RecipesPage() {
  const [searchQ, setSearchQ] = useState('');
  const [captureText, setCaptureText] = useState('');
  const [lookupId, setLookupId] = useState('');

  const [searchResult, setSearchResult] = useState<RecipeSearchResult | null>(null);
  const [selected, setSelected] = useState<RecipeUpsertPayload | null>(null);
  const [reviewRows, setReviewRows] = useState<RecipeReviewQueueItem[]>([]);

  const [patchText, setPatchText] = useState('{\n  "title": ""\n}');
  const [overwriteText, setOverwriteText] = useState('{}');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const selectedSummary = useMemo(() => {
    if (!selected) return null;
    return {
      public_id: selected.public_id,
      title: selected.title,
      status: selected.status,
      servings: selected.servings,
      cuisine: selected.cuisine,
      protein: selected.protein,
      difficulty: selected.difficulty,
      prep_time_minutes: selected.prep_time_minutes,
      cook_time_minutes: selected.cook_time_minutes,
      total_time_minutes: selected.total_time_minutes,
      review_reasons: selected.review_reasons,
    };
  }, [selected]);

  const loadRecipe = async (publicId: string) => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const out = await recipeGet(publicId);
      setSelected(out);
      setLookupId(out.public_id);
      setPatchText('{\n  "title": "' + out.title.replace(/"/g, '\\"') + '"\n}');
      const overwriteObject: Record<string, unknown> = {
        title: out.title,
        servings: out.servings,
        ingredients: out.ingredients,
        instructions: out.instructions,
        notes: out.notes,
        source: out.source,
        cuisine: out.cuisine,
        protein: out.protein,
        prep_time_minutes: out.prep_time_minutes,
        cook_time_minutes: out.cook_time_minutes,
        difficulty: out.difficulty,
        tags: out.tags,
        url_canonical: out.url_canonical,
        capture_text: out.capture_text,
        overnight: out.overnight,
      };
      setOverwriteText(toPretty(overwriteObject));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load recipe');
    } finally {
      setBusy(false);
    }
  };

  const runSearch = async () => {
    const q = searchQ.trim();
    if (!q) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const out = await recipeSearch(q, 2);
      setSearchResult(out);
      if (out.top_hit) {
        setSelected(out.top_hit);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'search failed');
      setSearchResult(null);
    } finally {
      setBusy(false);
    }
  };

  const createFromCapture = async () => {
    const text = captureText.trim();
    if (!text) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const out = await recipeCreateFromCapture(text);
      setSelected(out);
      setLookupId(out.public_id);
      setInfo(`Created ${out.public_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create failed');
    } finally {
      setBusy(false);
    }
  };

  const applyPatch = async () => {
    if (!selected) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const patch = parseObjectJson(patchText, 'Patch payload');
      const out = await recipePatch(selected.public_id, patch);
      setSelected(out);
      setInfo(`Patched ${out.public_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'patch failed');
    } finally {
      setBusy(false);
    }
  };

  const applyOverwrite = async () => {
    if (!selected) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const recipe = parseObjectJson(overwriteText, 'Overwrite payload');
      const out = await recipeOverwrite(selected.public_id, recipe);
      setSelected(out);
      setInfo(`Overwrote ${out.public_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'overwrite failed');
    } finally {
      setBusy(false);
    }
  };

  const loadReviewQueue = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const out = await recipeReviewQueue(50);
      setReviewRows(out.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'review queue failed');
      setReviewRows([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
        <h1 className="text-lg font-semibold text-slate-100">Recipes</h1>
        <p className="mt-1 text-sm text-slate-400">Search, inspect, and edit recipe records through the backend recipes API.</p>

        <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
          <input
            value={searchQ}
            onChange={(event) => setSearchQ(event.target.value)}
            placeholder="search recipes (title, ingredients, metadata)"
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 placeholder:text-slate-500 focus:ring"
          />
          <button
            type="button"
            className="rounded border border-emerald-500 bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
            onClick={() => { void runSearch(); }}
            disabled={busy || !searchQ.trim()}
          >
            {busy ? 'Working...' : 'Search'}
          </button>
          <button
            type="button"
            className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            onClick={() => { void loadReviewQueue(); }}
            disabled={busy}
          >
            Review Queue
          </button>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-[160px_auto_auto]">
          <input
            value={lookupId}
            onChange={(event) => setLookupId(event.target.value.toUpperCase())}
            placeholder="R42"
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 placeholder:text-slate-500 focus:ring"
          />
          <button
            type="button"
            className="rounded border border-sky-500 bg-sky-500/15 px-3 py-2 text-sm text-sky-300 hover:bg-sky-500/25 disabled:opacity-50"
            onClick={() => { void loadRecipe(lookupId.trim()); }}
            disabled={busy || !lookupId.trim()}
          >
            Get By ID
          </button>
          <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
            /recipe R42 compatible lookup
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-xs text-slate-300">Create from one-shot capture text</div>
          <textarea
            value={captureText}
            onChange={(event) => setCaptureText(event.target.value)}
            rows={8}
            placeholder="# Recipe title\n\n- Servings: 4\n\n## Ingredients\n- ...\n\n## Instructions\n1. ..."
            className="w-full rounded border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200"
          />
          <div className="mt-2">
            <button
              type="button"
              className="rounded border border-indigo-500 bg-indigo-500/15 px-3 py-2 text-sm text-indigo-300 hover:bg-indigo-500/25 disabled:opacity-50"
              onClick={() => { void createFromCapture(); }}
              disabled={busy || !captureText.trim()}
            >
              Create Recipe
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded border border-rose-700/50 bg-rose-900/20 px-3 py-2 text-sm text-rose-300">
            {error}
          </div>
        )}

        {info && (
          <div className="mt-3 rounded border border-emerald-700/50 bg-emerald-900/20 px-3 py-2 text-sm text-emerald-300">
            {info}
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_560px]">
        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
          <h2 className="text-sm font-semibold text-slate-100">Search Results</h2>

          {!searchResult && (
            <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-6 text-sm text-slate-400">
              Run a search or load by public id.
            </div>
          )}

          {searchResult && (
            <div className="space-y-3">
              <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-300">
                query: {searchResult.query} | candidates: {searchResult.total_candidates}
              </div>

              {searchResult.top_hit && (
                <button
                  type="button"
                  className="w-full rounded border border-emerald-700/60 bg-emerald-900/15 px-3 py-3 text-left"
                  onClick={() => { void loadRecipe(searchResult.top_hit!.public_id); }}
                >
                  <div className="text-xs text-emerald-300">Top hit</div>
                  <div className="mt-1 text-sm font-medium text-slate-100">{searchResult.top_hit.title} ({searchResult.top_hit.public_id})</div>
                  <div className="mt-1 text-xs text-slate-300">status: {searchResult.top_hit.status}</div>
                </button>
              )}

              {searchResult.alternatives.map((alt) => (
                <button
                  key={alt.public_id}
                  type="button"
                  className="w-full rounded border border-slate-800 bg-slate-950/40 px-3 py-3 text-left hover:bg-slate-900/70"
                  onClick={() => { void loadRecipe(alt.public_id); }}
                >
                  <div className="text-sm font-medium text-slate-100">{alt.title} ({alt.public_id})</div>
                  <div className="mt-1 text-xs text-slate-300">
                    status: {alt.status} | total time: {alt.total_time_minutes ?? '-'}
                  </div>
                </button>
              ))}
            </div>
          )}

          <h3 className="pt-2 text-sm font-semibold text-slate-100">Review Queue</h3>
          <div className="space-y-2">
            {reviewRows.length === 0 && (
              <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-3 text-xs text-slate-400">
                No review rows loaded.
              </div>
            )}
            {reviewRows.map((row) => (
              <button
                key={row.public_id}
                type="button"
                className="w-full rounded border border-slate-800 bg-slate-950/40 px-3 py-2 text-left hover:bg-slate-900/70"
                onClick={() => { void loadRecipe(row.public_id); }}
              >
                <div className="text-xs text-slate-300">{row.public_id} | {row.status}</div>
                <div className="text-sm text-slate-100">{row.title}</div>
                <div className="text-xs text-slate-400">{row.review_reasons.join(', ') || '-'}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
          <h2 className="text-sm font-semibold text-slate-100">Recipe Detail</h2>

          {!selected && (
            <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-6 text-sm text-slate-400">
              Select a recipe to inspect and edit.
            </div>
          )}

          {selected && (
            <>
              <pre className="rounded border border-slate-800 bg-slate-950 p-2 text-[11px] text-slate-300">{toPretty(selectedSummary)}</pre>

              <div>
                <div className="mb-1 text-xs text-slate-300">Patch payload (partial fields)</div>
                <textarea
                  value={patchText}
                  onChange={(event) => setPatchText(event.target.value)}
                  rows={10}
                  className="w-full rounded border border-slate-800 bg-slate-950 p-2 font-mono text-xs text-slate-200"
                />
                <button
                  type="button"
                  className="mt-2 rounded border border-sky-500 bg-sky-500/15 px-3 py-2 text-xs text-sky-300 hover:bg-sky-500/25 disabled:opacity-50"
                  onClick={() => { void applyPatch(); }}
                  disabled={busy}
                >
                  Apply Patch
                </button>
              </div>

              <div>
                <div className="mb-1 text-xs text-slate-300">Overwrite payload (full recipe)</div>
                <textarea
                  value={overwriteText}
                  onChange={(event) => setOverwriteText(event.target.value)}
                  rows={14}
                  className="w-full rounded border border-slate-800 bg-slate-950 p-2 font-mono text-xs text-slate-200"
                />
                <button
                  type="button"
                  className="mt-2 rounded border border-amber-500 bg-amber-500/15 px-3 py-2 text-xs text-amber-300 hover:bg-amber-500/25 disabled:opacity-50"
                  onClick={() => { void applyOverwrite(); }}
                  disabled={busy}
                >
                  Apply Overwrite
                </button>
              </div>

              <details className="rounded border border-slate-800 bg-slate-950/40">
                <summary className="cursor-pointer px-2 py-1 text-xs text-slate-300">Full payload JSON</summary>
                <pre className="max-h-64 overflow-auto border-t border-slate-800 p-2 text-[11px] text-slate-300">{toPretty(selected)}</pre>
              </details>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
