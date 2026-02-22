export function fmtTs(value: string | undefined | null): string {
  if (!value) return '-';
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return String(value);
  return new Date(ms).toLocaleString();
}

export function fmtDuration(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-';
  const ms = Number(value);
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function asTrimmed(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str || null;
}

export function statusColor(status: string): string {
  switch (status) {
    case 'ok': return 'text-emerald-300';
    case 'error':
    case 'orphan_error':
      return 'text-rose-300';
    case 'missing_end':
    case 'orphan_end':
      return 'text-amber-300';
    default:
      return 'text-slate-300';
  }
}

export function directionBadge(direction: string | undefined): string {
  const value = String(direction || '').toLowerCase();
  if (value === 'start') return 'bg-sky-900/50 text-sky-300';
  if (value === 'end') return 'bg-emerald-900/50 text-emerald-300';
  if (value === 'error') return 'bg-rose-900/50 text-rose-300';
  return 'bg-slate-800 text-slate-300';
}
