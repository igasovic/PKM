import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { JsonCard } from '../components/JsonCard';
import {
  analyzeFailurePack,
  fetchFailureBundleByRunId,
  fetchFailurePackById,
  fetchOpenFailurePacks,
  resolveFailurePack,
} from '../lib/api';
import { fmtTs } from '../lib/format';
import type { FailureBundle, FailurePackDetail, FailurePackSummary } from '../types';

const PAGE_SIZE = 30;

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-6 text-sm text-slate-400">
      {text}
    </div>
  );
}

export function FailuresPage() {
  const navigate = useNavigate();

  const [rows, setRows] = useState<FailurePackSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<FailurePackDetail | null>(null);
  const [bundle, setBundle] = useState<FailureBundle | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [analysisReason, setAnalysisReason] = useState('');
  const [proposedFix, setProposedFix] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [resolveBusy, setResolveBusy] = useState(false);

  const selectedRunId = selected?.run_id || '';

  const loadRows = async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await fetchOpenFailurePacks(PAGE_SIZE);
      setRows(result.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load failures');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setAnalysisReason(selected?.analysis_reason || '');
    setProposedFix(selected?.proposed_fix || '');
  }, [selected]);

  const selectedSummary = useMemo(() => {
    if (!selected) return null;
    return {
      failure_id: selected.failure_id,
      run_id: selected.run_id,
      root_execution_id: selected.root_execution_id,
      reporting_workflow_names: selected.reporting_workflow_names,
      workflow_name: selected.workflow_name,
      node_name: selected.node_name,
      mode: selected.mode,
      status: selected.status,
      failed_at: selected.failed_at,
      analyzed_at: selected.analyzed_at,
      error_message: selected.error_message,
      analysis_reason: selected.analysis_reason,
      proposed_fix: selected.proposed_fix,
      has_sidecars: selected.has_sidecars,
      sidecar_root: selected.sidecar_root,
    };
  }, [selected]);

  const loadByFailureId = async (failureId: string) => {
    setDetailError(null);
    setDetailLoading(true);
    try {
      const detail = await fetchFailurePackById(failureId);
      setSelected(detail);
      const byRunBundle = detail.run_id ? await fetchFailureBundleByRunId(detail.run_id) : null;
      setBundle(byRunBundle);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'failed to load failure detail');
      setSelected(null);
      setBundle(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const saveAnalysis = async () => {
    if (!selected) return;
    const reason = analysisReason.trim();
    const fix = proposedFix.trim();
    if (!reason || !fix) {
      setDetailError('analysis_reason and proposed_fix are required');
      return;
    }

    setDetailError(null);
    setSaveBusy(true);
    try {
      const updated = await analyzeFailurePack(selected.failure_id, {
        analysis_reason: reason,
        proposed_fix: fix,
      });
      setSelected(updated);
      const byRunBundle = updated.run_id ? await fetchFailureBundleByRunId(updated.run_id) : null;
      setBundle(byRunBundle);
      await loadRows();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'failed to save analysis');
    } finally {
      setSaveBusy(false);
    }
  };

  const markResolved = async () => {
    if (!selected) return;
    setDetailError(null);
    setResolveBusy(true);
    try {
      const updated = await resolveFailurePack(selected.failure_id);
      setSelected(updated);
      const byRunBundle = updated.run_id ? await fetchFailureBundleByRunId(updated.run_id) : null;
      setBundle(byRunBundle);
      await loadRows();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'failed to resolve failure');
    } finally {
      setResolveBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
        <h1 className="text-lg font-semibold text-slate-100">Failures</h1>
        <p className="mt-1 text-sm text-slate-400">Open failures (`status=captured`) with analysis and resolve lifecycle actions.</p>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="rounded border border-emerald-500 bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
            onClick={() => { void loadRows(); }}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded border border-rose-700/50 bg-rose-900/20 px-3 py-2 text-sm text-rose-300">
            {error}
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_560px]">
        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
          <h2 className="text-sm font-semibold text-slate-100">Captured Failures</h2>

          {!loading && rows.length === 0 && <EmptyState text="No captured failures found." />}

          <div className="space-y-2">
            {rows.map((row) => (
              <button
                key={row.failure_id}
                type="button"
                className={`w-full rounded-lg border px-3 py-3 text-left transition ${selected?.failure_id === row.failure_id
                  ? 'border-sky-500 bg-sky-500/10'
                  : 'border-slate-800 bg-slate-950/40 hover:bg-slate-900/60'
                }`}
                onClick={() => { void loadByFailureId(row.failure_id); }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                  <span>{row.failure_id}</span>
                  <span>{row.failed_at ? fmtTs(row.failed_at) : '-'}</span>
                </div>
                <div className="mt-1 text-sm font-medium text-slate-100">{row.workflow_name || '(unknown workflow)'}</div>
                <div className="mt-1 text-xs text-slate-300">{row.node_name || '-'} | status: {row.status || '-'}</div>
                <div className="mt-2 line-clamp-2 text-xs text-slate-400">{row.error_message || '-'}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
          <h2 className="text-sm font-semibold text-slate-100">Failure Detail</h2>

          {detailError && (
            <div className="rounded border border-rose-700/50 bg-rose-900/20 px-3 py-2 text-sm text-rose-300">
              {detailError}
            </div>
          )}

          {!selected && !detailLoading && <EmptyState text="Select a failure row to inspect details." />}

          {selected && (
            <>
              <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-300">
                <div>failure_id: {selected.failure_id}</div>
                <div>run_id: {selected.run_id}</div>
                <div>root_execution_id: {selected.root_execution_id || '-'}</div>
                <div>failed_at: {selected.failed_at ? fmtTs(selected.failed_at) : '-'}</div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded border border-sky-500 bg-sky-500/15 px-3 py-1.5 text-xs text-sky-300 hover:bg-sky-500/25"
                  onClick={() => navigate(`/debug/run/${encodeURIComponent(selected.run_id)}`)}
                  disabled={!selectedRunId}
                >
                  Open Debug Run
                </button>
                <button
                  type="button"
                  className="rounded border border-emerald-500 bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                  onClick={() => { void saveAnalysis(); }}
                  disabled={saveBusy || resolveBusy || selected.status === 'resolved'}
                >
                  {saveBusy ? 'Saving...' : 'Save Analysis'}
                </button>
                <button
                  type="button"
                  className="rounded border border-amber-500 bg-amber-500/15 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-500/25 disabled:opacity-50"
                  onClick={() => { void markResolved(); }}
                  disabled={resolveBusy || saveBusy || selected.status === 'resolved'}
                >
                  {resolveBusy ? 'Resolving...' : 'Mark Resolved'}
                </button>
              </div>

              {selected.status === 'resolved' && (
                <div className="rounded border border-emerald-700/50 bg-emerald-900/20 px-3 py-2 text-xs text-emerald-200">
                  This failure is resolved (terminal in v1).
                </div>
              )}

              <div className="space-y-2 rounded border border-slate-800 bg-slate-950/40 p-3">
                <div className="text-xs font-semibold text-slate-200">Analysis</div>
                <textarea
                  value={analysisReason}
                  onChange={(event) => setAnalysisReason(event.target.value)}
                  placeholder="analysis_reason"
                  rows={4}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none ring-sky-500 placeholder:text-slate-500 focus:ring"
                  disabled={selected.status === 'resolved'}
                />
                <textarea
                  value={proposedFix}
                  onChange={(event) => setProposedFix(event.target.value)}
                  placeholder="proposed_fix"
                  rows={4}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none ring-sky-500 placeholder:text-slate-500 focus:ring"
                  disabled={selected.status === 'resolved'}
                />
              </div>

              <JsonCard title="summary" data={selectedSummary || {}} defaultOpen />
              <JsonCard title="pack" data={selected.pack || {}} />
              <JsonCard title="bundle.failure" data={bundle?.failure || {}} />
              <JsonCard title="bundle.run_trace" data={bundle?.run_trace || {}} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
