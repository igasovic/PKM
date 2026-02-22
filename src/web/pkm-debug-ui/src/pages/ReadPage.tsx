import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildContextPack, type ContextPackFormat } from '../lib/contextPack';
import { fmtTs } from '../lib/format';
import { createUiRunId } from '../lib/runId';
import { normalizeReadRows } from '../lib/readNormalize';
import { readContinue, readFind, readLast } from '../lib/readApi';
import { copyText, stableStringify } from '../lib/stable';
import { estimateTokens } from '../lib/tokenEstimate';
import type { ReadItem, ReadOperation } from '../types';

function parsePositiveOrNull(value: string): number | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

export function ReadPage() {
  const navigate = useNavigate();

  const [operation, setOperation] = useState<ReadOperation>('continue');
  const [q, setQ] = useState('');
  const [daysInput, setDaysInput] = useState('');
  const [limitInput, setLimitInput] = useState('');
  const [snippetLengthInput, setSnippetLengthInput] = useState('800');
  const [format, setFormat] = useState<ContextPackFormat>('markdown');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReadItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [lastRunId, setLastRunId] = useState<string>('');
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const days = parsePositiveOrNull(daysInput);
  const limit = parsePositiveOrNull(limitInput);
  const snippetLength = parsePositiveOrNull(snippetLengthInput) || 800;

  const selectedItems = useMemo(
    () => rows.filter((item) => selectedIds.has(item.id)),
    [rows, selectedIds],
  );

  const packMeta = useMemo(() => ({
    operation,
    q: q.trim(),
    days,
    limit,
    run_id: lastRunId,
    generated_at: new Date().toISOString(),
    total_results: rows.length,
  }), [operation, q, days, limit, lastRunId, rows.length]);

  const contextPack = useMemo(
    () => buildContextPack(format, selectedItems, packMeta),
    [format, selectedItems, packMeta],
  );

  const tokenEstimate = useMemo(
    () => estimateTokens(contextPack),
    [contextPack],
  );

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(rows.map((item) => item.id)));
  const selectNone = () => setSelectedIds(new Set());
  const invertSelection = () => {
    setSelectedIds((prev) => {
      const next = new Set<string>();
      rows.forEach((item) => {
        if (!prev.has(item.id)) next.add(item.id);
      });
      return next;
    });
  };

  const run = async () => {
    const query = q.trim();
    if (!query) return;

    setError(null);
    setLoading(true);

    const runId = createUiRunId('ui-read');
    const start = performance.now();

    try {
      const payload = { q: query, days, limit };
      const result = operation === 'continue'
        ? await readContinue(payload, { runId })
        : operation === 'find'
          ? await readFind(payload, { runId })
          : await readLast(payload, { runId });

      const normalized = normalizeReadRows(result.rows, { snippetLength });
      setRows(normalized);
      setSelectedIds(new Set(normalized.map((item) => item.id)));
      setLastRunId(result.run_id || runId);
      setElapsedMs(Math.round(performance.now() - start));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'read failed');
      setRows([]);
      setSelectedIds(new Set());
      setLastRunId(runId);
      setElapsedMs(Math.round(performance.now() - start));
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setError(null);
    setRows([]);
    setSelectedIds(new Set());
    setElapsedMs(null);
    setLastRunId('');
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
        <h1 className="text-lg font-semibold text-slate-100">Read</h1>
        <p className="mt-1 text-sm text-slate-400">Run one read operation and build a context pack from selected results.</p>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2 text-slate-200">
            <input type="radio" checked={operation === 'continue'} onChange={() => setOperation('continue')} /> Continue
          </label>
          <label className="flex items-center gap-2 text-slate-200">
            <input type="radio" checked={operation === 'find'} onChange={() => setOperation('find')} /> Find
          </label>
          <label className="flex items-center gap-2 text-slate-200">
            <input type="radio" checked={operation === 'last'} onChange={() => setOperation('last')} /> Last
          </label>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="q (required)"
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 placeholder:text-slate-500 focus:ring"
          />
          <input
            value={daysInput}
            onChange={(event) => setDaysInput(event.target.value)}
            placeholder="days (optional)"
            inputMode="numeric"
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 placeholder:text-slate-500 focus:ring"
          />
          <input
            value={limitInput}
            onChange={(event) => setLimitInput(event.target.value)}
            placeholder="limit (optional)"
            inputMode="numeric"
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 placeholder:text-slate-500 focus:ring"
          />
          <input
            value={snippetLengthInput}
            onChange={(event) => setSnippetLengthInput(event.target.value)}
            placeholder="snippet length"
            inputMode="numeric"
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 placeholder:text-slate-500 focus:ring"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded border border-emerald-500 bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
            onClick={() => { void run(); }}
            disabled={loading || !q.trim()}
          >
            {loading ? 'Running...' : 'Run'}
          </button>
          <button
            type="button"
            className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
            onClick={reset}
          >
            Reset
          </button>

          {lastRunId && (
            <button
              type="button"
              className="rounded border border-sky-500 bg-sky-500/15 px-3 py-2 text-sm text-sky-300 hover:bg-sky-500/25"
              onClick={() => navigate(`/debug/run/${encodeURIComponent(lastRunId)}`)}
            >
              Open Debug Run
            </button>
          )}
        </div>

        {(lastRunId || elapsedMs !== null || rows.length > 0) && (
          <div className="mt-3 text-xs text-slate-400">
            <span className="mr-3">results: {rows.length}</span>
            <span className="mr-3">op: {operation}</span>
            <span className="mr-3">run_id: {lastRunId || '-'}</span>
            <span>elapsed: {elapsedMs ?? '-'} ms</span>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded border border-rose-700/50 bg-rose-900/20 px-3 py-2 text-sm text-rose-300">
            {error}
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-100">Results</h2>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button className="rounded border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800" onClick={selectAll}>Select all</button>
              <button className="rounded border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800" onClick={selectNone}>Select none</button>
              <button className="rounded border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800" onClick={invertSelection}>Invert</button>
            </div>
          </div>

          {rows.length === 0 && (
            <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-6 text-sm text-slate-400">
              No results yet.
            </div>
          )}

          <div className="space-y-2">
            {rows.map((item) => (
              <article key={item.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={() => toggleSelection(item.id)}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-300">
                      <span>entry\_id: {item.entry_id || '-'}</span>
                      <span>source: {item.source || '-'}</span>
                      <span>created: {item.created_at ? fmtTs(item.created_at) : '-'}</span>
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-100">{item.title || '(no title)'}</div>
                    {item.url && (
                      <div className="mt-1 truncate text-xs text-sky-300" title={item.url}>{item.url}</div>
                    )}
                    <div className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{item.excerpt}</div>
                    <details className="mt-2 rounded border border-slate-800 bg-slate-900/70">
                      <summary className="cursor-pointer px-2 py-1 text-xs text-slate-300">Raw JSON</summary>
                      <pre className="max-h-48 overflow-auto border-t border-slate-800 p-2 text-[11px] text-slate-300">{stableStringify(item.raw, 2)}</pre>
                    </details>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-100">Context Pack</h2>
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                className={`rounded border px-2 py-1 ${format === 'markdown' ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
                onClick={() => setFormat('markdown')}
              >
                Markdown
              </button>
              <button
                type="button"
                className={`rounded border px-2 py-1 ${format === 'json' ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
                onClick={() => setFormat('json')}
              >
                JSON
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded border border-slate-800 bg-slate-950/40 p-2 text-xs text-slate-300">
            <div>selected: {selectedItems.length} / {rows.length}</div>
            <div>chars: {tokenEstimate.chars}</div>
            <div>tokens~: {tokenEstimate.tokens}</div>
            <div>method: {tokenEstimate.method}</div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded border border-emerald-500 bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
              onClick={() => { void copyText(contextPack); }}
              disabled={!selectedItems.length}
            >
              Copy Context Pack
            </button>
          </div>

          <textarea
            readOnly
            value={contextPack}
            rows={24}
            className="w-full rounded border border-slate-800 bg-slate-950 p-2 font-mono text-xs text-slate-200"
          />
        </aside>
      </div>
    </div>
  );
}
