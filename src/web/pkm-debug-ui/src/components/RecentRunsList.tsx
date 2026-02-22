import type { RecentRunSummary } from '../types';
import { fmtDuration, fmtTs } from '../lib/format';

export type RecentFilter = 'all' | 'error' | 'ok';

interface RecentRunsListProps {
  rows: RecentRunSummary[];
  loading: boolean;
  error: string | null;
  filter: RecentFilter;
  onFilterChange: (next: RecentFilter) => void;
  onRefresh: () => void;
  onLoadRun: (runId: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
}

function statusForRow(row: RecentRunSummary): 'ok' | 'error' | 'partial' {
  if (row.error_count > 0) return 'error';
  if (row.missing_end_count > 0) return 'partial';
  return 'ok';
}

function statusBadge(status: 'ok' | 'error' | 'partial'): string {
  if (status === 'ok') return 'bg-emerald-900/50 text-emerald-300';
  if (status === 'error') return 'bg-rose-900/50 text-rose-300';
  return 'bg-amber-900/50 text-amber-300';
}

export function RecentRunsList(props: RecentRunsListProps) {
  const {
    rows,
    loading,
    error,
    filter,
    onFilterChange,
    onRefresh,
    onLoadRun,
    onLoadMore,
    hasMore,
  } = props;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 shadow-glow">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-100">Recent Runs</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`rounded border px-2 py-1 text-xs ${filter === 'all' ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
            onClick={() => onFilterChange('all')}
          >
            All
          </button>
          <button
            type="button"
            className={`rounded border px-2 py-1 text-xs ${filter === 'error' ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
            onClick={() => onFilterChange('error')}
          >
            Errors
          </button>
          <button
            type="button"
            className={`rounded border px-2 py-1 text-xs ${filter === 'ok' ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
            onClick={() => onFilterChange('ok')}
          >
            No Errors
          </button>
          <button
            type="button"
            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-2 rounded border border-rose-700/50 bg-rose-900/20 px-2 py-1 text-xs text-rose-300">
          {error}
        </div>
      )}

      <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-slate-800">
        <table className="min-w-full divide-y divide-slate-800 text-xs">
          <thead className="bg-slate-900 text-slate-300">
            <tr>
              <th className="px-2 py-2 text-left font-medium">Run ID</th>
              <th className="px-2 py-2 text-left font-medium">Status</th>
              <th className="px-2 py-2 text-left font-medium">Ended</th>
              <th className="px-2 py-2 text-left font-medium">Dur</th>
              <th className="px-2 py-2 text-left font-medium">Events</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-slate-400" colSpan={5}>
                  {loading ? 'Loading recent runs…' : 'No runs found.'}
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const status = statusForRow(row);
              return (
                <tr
                  key={`${row.run_id}|${row.ended_at || 'na'}`}
                  className="cursor-pointer hover:bg-slate-800/50"
                  onClick={() => onLoadRun(row.run_id)}
                  title={`Load run ${row.run_id}`}
                >
                  <td className="max-w-[20rem] truncate px-2 py-2 text-slate-100" title={row.run_id}>{row.run_id}</td>
                  <td className="px-2 py-2">
                    <span className={`rounded px-2 py-0.5 ${statusBadge(status)}`}>{status}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-slate-400">{fmtTs(row.ended_at)}</td>
                  <td className="px-2 py-2 text-slate-300">{fmtDuration(row.total_ms)}</td>
                  <td className="px-2 py-2 text-slate-300">{row.event_count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          onClick={onLoadMore}
          disabled={loading || !hasMore}
        >
          {hasMore ? 'Load More' : 'No More'}
        </button>
      </div>
    </section>
  );
}
