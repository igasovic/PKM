import type { RunSummary } from '../types';
import { fmtDuration, fmtTs, statusColor } from '../lib/format';

interface SummaryBarProps {
  summary: RunSummary;
}

function statusLabel(status: RunSummary['status']): string {
  if (status === 'ok') return 'OK';
  if (status === 'error') return 'ERROR';
  return 'PARTIAL';
}

export function SummaryBar({ summary }: SummaryBarProps) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">Run ID</div>
          <div className="truncate text-sm text-slate-100">{summary.run_id}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">Status</div>
          <div className={`text-sm font-semibold ${statusColor(summary.status)}`}>{statusLabel(summary.status)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">Total Runtime</div>
          <div className="text-sm text-slate-100">{fmtDuration(summary.total_ms)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">Window</div>
          <div className="text-xs text-slate-300">{fmtTs(summary.started_at)} → {fmtTs(summary.ended_at)}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
          <div className="text-xs uppercase text-slate-400">Errors</div>
          <div className="text-rose-300">{summary.error_count}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
          <div className="text-xs uppercase text-slate-400">Missing Ends</div>
          <div className="text-amber-300">{summary.missing_end_count}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
          <div className="text-xs uppercase text-slate-400">Slowest Span</div>
          <div className="text-slate-200">
            {summary.slow_spans[0]
              ? `${summary.slow_spans[0].step} (${fmtDuration(summary.slow_spans[0].duration_ms)})`
              : '-'}
          </div>
        </div>
      </div>

      {summary.notes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {summary.notes.slice(0, 12).map((note) => (
            <span
              key={note}
              className="rounded-full border border-slate-700 bg-slate-800/80 px-2 py-1 text-xs text-slate-300"
            >
              {note}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
