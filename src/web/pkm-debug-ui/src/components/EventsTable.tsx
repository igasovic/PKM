import type { PipelineEventRow } from '../types';
import { collectBigFieldPills, extractIds, keyCount } from '../lib/summary';
import { directionBadge, fmtDuration, fmtTs } from '../lib/format';

interface EventsTableProps {
  rows: PipelineEventRow[];
  selectedId: string | null;
  onSelect: (row: PipelineEventRow) => void;
}

function rowKey(row: PipelineEventRow, idx: number): string {
  if (row.event_id) return row.event_id;
  return `${row.seq ?? 'na'}_${row.ts ?? 'na'}_${idx}`;
}

export function EventsTable({ rows, selectedId, onSelect }: EventsTableProps) {
  return (
    <div className="overflow-auto rounded-xl border border-slate-800 bg-slate-900/70 shadow-glow">
      <table className="min-w-full divide-y divide-slate-800 text-xs">
        <thead className="bg-slate-900 text-slate-300">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Seq</th>
            <th className="px-3 py-2 text-left font-medium">Step</th>
            <th className="px-3 py-2 text-left font-medium">Pipeline</th>
            <th className="px-3 py-2 text-left font-medium">Dir</th>
            <th className="px-3 py-2 text-left font-medium">Duration</th>
            <th className="px-3 py-2 text-left font-medium">Level</th>
            <th className="px-3 py-2 text-left font-medium">IDs</th>
            <th className="px-3 py-2 text-left font-medium">Key Summary</th>
            <th className="px-3 py-2 text-left font-medium">Timestamp</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/80">
          {rows.map((row, idx) => {
            const key = rowKey(row, idx);
            const ids = extractIds(row);
            const inCount = keyCount(row.input_summary || null);
            const outCount = keyCount(row.output_summary || null);
            const pills = [
              ...collectBigFieldPills(row.input_summary || null, 'in'),
              ...collectBigFieldPills(row.output_summary || null, 'out'),
            ];

            const selected = selectedId === key;

            return (
              <tr
                key={key}
                className={`cursor-pointer transition ${selected ? 'bg-slate-800/90' : 'hover:bg-slate-800/60'}`}
                onClick={() => onSelect(row)}
              >
                <td className="px-3 py-2 text-slate-300">{row.seq ?? '-'}</td>
                <td className="max-w-[24rem] truncate px-3 py-2 text-slate-100" title={String(row.step || '')}>{row.step || '-'}</td>
                <td className="max-w-[14rem] truncate px-3 py-2 text-slate-300" title={String(row.pipeline || '')}>{row.pipeline || '-'}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-1 ${directionBadge(String(row.direction || ''))}`}>
                    {row.direction || '-'}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-300">{fmtDuration(row.duration_ms)}</td>
                <td className="px-3 py-2 text-slate-300">{row.level || '-'}</td>
                <td className="px-3 py-2 text-slate-300">
                  <div className="truncate" title={`entry: ${ids.entry_id}`}>e:{ids.entry_id}</div>
                  <div className="truncate" title={`trace: ${ids.trace_id}`}>t:{ids.trace_id}</div>
                  <div className="truncate" title={`batch: ${ids.batch_id}`}>b:{ids.batch_id}</div>
                </td>
                <td className="max-w-[26rem] px-3 py-2 text-slate-300">
                  <div>in:{inCount ?? '-'} / out:{outCount ?? '-'}</div>
                  {pills.slice(0, 2).map((pill) => (
                    <div key={pill} className="truncate text-[11px] text-amber-300" title={pill}>{pill}</div>
                  ))}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-400">{fmtTs(row.ts)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
