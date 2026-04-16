import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EventsTable } from '../components/EventsTable';
import { JsonCard } from '../components/JsonCard';
import { RecentRunsList, type RecentFilter } from '../components/RecentRunsList';
import { SpanList } from '../components/SpanList';
import { SummaryBar } from '../components/SummaryBar';
import { TreeView } from '../components/TreeView';
import { fetchRecentRuns, fetchRunById } from '../lib/api';
import { buildInvestigationBundle } from '../lib/bundle';
import { fmtDuration, fmtTs } from '../lib/format';
import { normalizeRunBundle } from '../lib/normalize';
import { buildCallTree, computeRunSummary, pairSpans } from '../lib/spans';
import { copyText, stableStringify } from '../lib/stable';
import type { PairedSpan, PipelineEventRow, RecentRunSummary, RunBundle, TreeNode } from '../types';

type ViewMode = 'events' | 'tree' | 'spans';
type SourceMode = 'lookup' | 'paste';
const RECENT_PAGE_SIZE = 30;
type Selection =
  | { kind: 'row'; value: PipelineEventRow }
  | { kind: 'span'; value: PairedSpan }
  | { kind: 'tree'; value: TreeNode }
  | null;

function rowId(row: PipelineEventRow): string {
  if (row.event_id) return row.event_id;
  return `${row.seq ?? 'na'}|${row.ts ?? 'na'}|${row.step ?? 'na'}`;
}

function Drawer({ selected }: { selected: Selection }) {
  if (!selected) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-400 shadow-glow">
        Select an event/span to inspect details.
      </div>
    );
  }

  if (selected.kind === 'row') {
    const row = selected.value;
    const meta = (row.meta && typeof row.meta === 'object') ? row.meta : {};

    return (
      <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Event Detail</h2>
          <div className="mt-1 text-xs text-slate-400">{row.pipeline || '-'} :: {row.step || '-'}</div>
          <div className="mt-1 text-xs text-slate-400">seq {row.seq ?? '-'} | {String(row.direction || '-')} | {fmtDuration(row.duration_ms)}</div>
          <div className="mt-1 text-xs text-slate-500">{fmtTs(row.ts)}</div>
        </div>
        <JsonCard title="meta" data={meta} defaultOpen />
        <JsonCard title="input_summary" data={row.input_summary || {}} />
        <JsonCard title="output_summary" data={row.output_summary || {}} />
        <JsonCard title="error" data={row.error || {}} />
        <button
          type="button"
          className="rounded border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
          onClick={() => {
            void copyText(stableStringify(row, 2));
          }}
        >
          Copy row JSON
        </button>
      </div>
    );
  }

  if (selected.kind === 'span') {
    const span = selected.value;
    return (
      <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Span Detail</h2>
          <div className="mt-1 text-xs text-slate-400">{span.pipeline || '-'} :: {span.step || '-'}</div>
          <div className="mt-1 text-xs text-slate-400">status {span.status} | duration {fmtDuration(span.duration_ms)}</div>
          <div className="mt-1 text-xs text-slate-500">seq {span.start?.seq ?? '-'} → {span.end?.seq ?? '-'}</div>
        </div>
        <JsonCard title="start.input_summary" data={span.start?.input_summary || {}} />
        <JsonCard title="end.output_summary" data={span.end?.output_summary || {}} />
        <JsonCard title="diff" data={span.diff || {}} defaultOpen />
        <button
          type="button"
          className="rounded border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
          onClick={() => {
            void copyText(stableStringify(span, 2));
          }}
        >
          Copy span JSON
        </button>
      </div>
    );
  }

  const node = selected.value;
  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
      <div>
        <h2 className="text-sm font-semibold text-slate-100">Tree Node</h2>
        <div className="mt-1 text-xs text-slate-400">{node.pipeline || '-'} :: {node.step || '-'}</div>
        <div className="mt-1 text-xs text-slate-400">status {node.status} | duration {fmtDuration(node.duration_ms)}</div>
      </div>
      <JsonCard title="start event" data={node.start || {}} defaultOpen />
      <JsonCard title="end event" data={node.end || {}} />
      <button
        type="button"
        className="rounded border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
        onClick={() => {
          void copyText(stableStringify(node, 2));
        }}
      >
        Copy node JSON
      </button>
    </div>
  );
}

export function DebugPage() {
  const navigate = useNavigate();
  const params = useParams<{ runId?: string }>();
  const [runId, setRunId] = useState('');
  const [sourceMode, setSourceMode] = useState<SourceMode>('lookup');
  const [pasteJson, setPasteJson] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('events');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<RunBundle | null>(null);
  const [selected, setSelected] = useState<Selection>(null);
  const [recentRuns, setRecentRuns] = useState<RecentRunSummary[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentFilter, setRecentFilter] = useState<RecentFilter>('all');
  const [recentPipelineFilter, setRecentPipelineFilter] = useState('');
  const [recentStepFilter, setRecentStepFilter] = useState('');
  const [recentBeforeTs, setRecentBeforeTs] = useState<string | null>(null);
  const [recentHasMore, setRecentHasMore] = useState(false);

  const rows = bundle?.rows || [];

  const spans = useMemo(() => pairSpans(rows), [rows]);
  const tree = useMemo(() => buildCallTree(rows), [rows]);
  const summary = useMemo(() => {
    if (!bundle) return null;
    return computeRunSummary(bundle.run_id, rows, spans);
  }, [bundle, rows, spans]);

  const selectedId = useMemo(() => {
    if (!selected) return null;
    if (selected.kind === 'row') return rowId(selected.value);
    return selected.value.id;
  }, [selected]);

  const loadByRunId = async (candidateRunId?: string) => {
    setError(null);
    const id = String(candidateRunId ?? runId).trim();
    if (!id) {
      setError('Run ID is required.');
      return;
    }
    setRunId(id);

    setLoading(true);
    try {
      const payload = await fetchRunById(id);
      const normalized = normalizeRunBundle(payload, id);
      setBundle(normalized);
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to fetch run');
    } finally {
      setLoading(false);
    }
  };

  const loadRecentRuns = async (reset = true) => {
    setRecentError(null);
    setRecentLoading(true);
    try {
      const has_error = recentFilter === 'all'
        ? null
        : recentFilter === 'error';
      const before_ts = reset ? null : recentBeforeTs;
      const result = await fetchRecentRuns({
        limit: RECENT_PAGE_SIZE,
        before_ts,
        has_error,
        pipeline: recentPipelineFilter.trim() || null,
        step: recentStepFilter.trim() || null,
      });
      const incoming = result.rows;
      const merged = reset
        ? incoming
        : [...recentRuns, ...incoming].filter((row, index, arr) => {
          const key = `${row.run_id}|${row.ended_at || 'na'}`;
          return arr.findIndex((other) => `${other.run_id}|${other.ended_at || 'na'}` === key) === index;
        });
      setRecentRuns(merged);

      const last = incoming[incoming.length - 1];
      const nextBefore = last && last.ended_at ? last.ended_at : null;
      setRecentBeforeTs(nextBefore);
      setRecentHasMore(incoming.length === RECENT_PAGE_SIZE && !!nextBefore);
    } catch (err) {
      setRecentError(err instanceof Error ? err.message : 'failed to fetch recent runs');
    } finally {
      setRecentLoading(false);
    }
  };

  useEffect(() => {
    void loadRecentRuns(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentFilter, recentPipelineFilter, recentStepFilter]);

  useEffect(() => {
    const routeRunId = String(params.runId || '').trim();
    if (!routeRunId) return;
    if (routeRunId === runId) return;
    setRunId(routeRunId);
    void loadByRunId(routeRunId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.runId]);

  const parsePastedJson = () => {
    setError(null);
    if (!pasteJson.trim()) {
      setError('Paste JSON is empty.');
      return;
    }

    try {
      const parsed = JSON.parse(pasteJson);
      const normalized = normalizeRunBundle(parsed, runId.trim() || undefined);
      setBundle(normalized);
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'invalid JSON payload');
    }
  };

  const copyBundle = async () => {
    if (!bundle || !summary) return;
    const obj = buildInvestigationBundle(summary, spans, rows);
    await copyText(stableStringify(obj, 2));
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-[1800px] p-4">
        <header className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
          <h1 className="text-lg font-semibold">PKM Pipeline Debug UI</h1>
          <p className="mt-1 text-sm text-slate-400">React + Tailwind inspector for /debug pipeline events.</p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`rounded border px-3 py-1.5 text-xs ${sourceMode === 'lookup' ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
              onClick={() => setSourceMode('lookup')}
            >
              Run Lookup
            </button>
            <button
              type="button"
              className={`rounded border px-3 py-1.5 text-xs ${sourceMode === 'paste' ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
              onClick={() => setSourceMode('paste')}
            >
              Paste JSON
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={runId}
              onChange={(event) => setRunId(event.target.value)}
              placeholder="Run ID (numeric or UUID)"
              className="w-[28rem] max-w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 placeholder:text-slate-500 focus:ring"
            />
            {sourceMode === 'lookup' ? (
              <button
                type="button"
                className="rounded border border-emerald-500 bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-60"
                onClick={() => {
                  void loadByRunId(undefined);
                }}
                disabled={loading}
              >
                {loading ? 'Loading...' : 'Load Run'}
              </button>
            ) : (
              <button
                type="button"
                className="rounded border border-indigo-500 bg-indigo-500/15 px-3 py-2 text-sm text-indigo-300 hover:bg-indigo-500/25"
                onClick={parsePastedJson}
              >
                Parse Pasted JSON
              </button>
            )}
            <button
              type="button"
              className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              onClick={() => {
                void copyBundle();
              }}
              disabled={!bundle || !summary}
            >
              Copy Investigation Bundle
            </button>
          </div>

          {sourceMode === 'paste' && (
            <textarea
              value={pasteJson}
              onChange={(event) => setPasteJson(event.target.value)}
              rows={6}
              className="mt-3 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 outline-none ring-indigo-500 focus:ring"
              placeholder="Paste { run_id, rows } or [{ run_id, rows }] payload"
            />
          )}

          {error && (
            <div className="mt-3 rounded border border-rose-700/50 bg-rose-900/20 px-3 py-2 text-sm text-rose-300">
              {error}
            </div>
          )}
        </header>

        <div className="mt-4">
          <RecentRunsList
            rows={recentRuns}
            loading={recentLoading}
            error={recentError}
            filter={recentFilter}
            pipelineFilter={recentPipelineFilter}
            stepFilter={recentStepFilter}
            onPipelineFilterChange={setRecentPipelineFilter}
            onStepFilterChange={setRecentStepFilter}
            onFilterChange={setRecentFilter}
            onRefresh={() => {
              void loadRecentRuns(true);
            }}
            onLoadRun={(id) => {
              navigate(`/debug/run/${encodeURIComponent(id)}`);
            }}
            onLoadMore={() => {
              void loadRecentRuns(false);
            }}
            hasMore={recentHasMore}
          />
        </div>

        {summary && (
          <div className="mt-4">
            <SummaryBar summary={summary} />
          </div>
        )}

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={`rounded border px-3 py-1.5 text-xs ${viewMode === 'events' ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
                onClick={() => setViewMode('events')}
              >
                Raw Events
              </button>
              <button
                type="button"
                className={`rounded border px-3 py-1.5 text-xs ${viewMode === 'tree' ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
                onClick={() => setViewMode('tree')}
              >
                Call Stack Tree
              </button>
              <button
                type="button"
                className={`rounded border px-3 py-1.5 text-xs ${viewMode === 'spans' ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
                onClick={() => setViewMode('spans')}
              >
                Paired Spans
              </button>
            </div>

            {viewMode === 'events' && (
              <EventsTable
                rows={rows}
                selectedId={selected?.kind === 'row' ? selectedId : null}
                onSelect={(row) => setSelected({ kind: 'row', value: row })}
              />
            )}

            {viewMode === 'tree' && (
              <TreeView
                nodes={tree}
                selectedId={selected?.kind === 'tree' ? selectedId : null}
                onSelect={(node) => setSelected({ kind: 'tree', value: node })}
              />
            )}

            {viewMode === 'spans' && (
              <SpanList
                spans={spans}
                selectedId={selected?.kind === 'span' ? selectedId : null}
                onSelect={(span) => setSelected({ kind: 'span', value: span })}
              />
            )}
          </section>

          <aside className="min-w-0">
            <Drawer selected={selected} />
          </aside>
        </div>
      </div>
    </div>
  );
}
