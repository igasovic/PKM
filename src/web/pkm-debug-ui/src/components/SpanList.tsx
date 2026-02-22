import type { PairedSpan } from '../types';
import { fmtDuration } from '../lib/format';

interface SpanListProps {
  spans: PairedSpan[];
  selectedId: string | null;
  onSelect: (span: PairedSpan) => void;
}

function statusPill(status: string): string {
  if (status === 'ok') return 'bg-emerald-900/50 text-emerald-300';
  if (status === 'error' || status === 'orphan_error') return 'bg-rose-900/50 text-rose-300';
  return 'bg-amber-900/50 text-amber-300';
}

export function SpanList({ spans, selectedId, onSelect }: SpanListProps) {
  return (
    <div className="overflow-auto rounded-xl border border-slate-800 bg-slate-900/70 shadow-glow">
      <table className="min-w-full divide-y divide-slate-800 text-xs">
        <thead className="bg-slate-900 text-slate-300">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-left font-medium">Step</th>
            <th className="px-3 py-2 text-left font-medium">Pipeline</th>
            <th className="px-3 py-2 text-left font-medium">Duration</th>
            <th className="px-3 py-2 text-left font-medium">Seq</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/80">
          {spans.map((span) => (
            <tr
              key={span.id}
              className={`cursor-pointer ${selectedId === span.id ? 'bg-slate-800/80' : 'hover:bg-slate-800/50'}`}
              onClick={() => onSelect(span)}
            >
              <td className="px-3 py-2">
                <span className={`rounded px-2 py-1 ${statusPill(span.status)}`}>{span.status}</span>
              </td>
              <td className="max-w-[24rem] truncate px-3 py-2 text-slate-100" title={span.step}>{span.step || '-'}</td>
              <td className="max-w-[14rem] truncate px-3 py-2 text-slate-300" title={span.pipeline}>{span.pipeline || '-'}</td>
              <td className="px-3 py-2 text-slate-300">{fmtDuration(span.duration_ms)}</td>
              <td className="px-3 py-2 text-slate-400">
                {span.start?.seq ?? '-'} → {span.end?.seq ?? '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
