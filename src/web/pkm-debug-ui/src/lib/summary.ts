import type { PipelineEventRow } from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

export function keyCount(summary: Record<string, unknown> | null | undefined): number | null {
  if (!summary) return null;
  const direct = asNumber(summary.key_count);
  if (direct !== null) return direct;
  if (Array.isArray(summary.keys)) return summary.keys.length;
  return null;
}

export function collectBigFieldPills(
  summary: Record<string, unknown> | null | undefined,
  prefix: string,
  limit = 6,
): string[] {
  if (!summary) return [];
  const pills: string[] = [];

  const walk = (value: unknown, path: string[]): void => {
    if (pills.length >= limit) return;
    if (!isRecord(value)) return;

    const charCount = asNumber(value.char_count);
    if (charCount !== null && charCount > 2000) {
      const sha = typeof value.sha256 === 'string' ? value.sha256.slice(0, 8) : 'n/a';
      const label = [...path].join('.');
      pills.push(`${prefix}.${label}: ${charCount} chars | ${sha}`);
      return;
    }

    for (const key of Object.keys(value).sort()) {
      walk(value[key], [...path, key]);
      if (pills.length >= limit) return;
    }
  };

  walk(summary, []);
  return pills;
}

export function extractIds(row: PipelineEventRow): { entry_id: string; trace_id: string; batch_id: string } {
  const meta = (row.meta && typeof row.meta === 'object' ? row.meta : {}) as Record<string, unknown>;

  const entry = row.entry_id !== null && row.entry_id !== undefined ? String(row.entry_id) : '-';
  const trace = row.trace_id ? String(row.trace_id) : '-';
  const batch = row.batch_id
    ? String(row.batch_id)
    : (meta.batch_id ? String(meta.batch_id) : '-');

  return { entry_id: entry, trace_id: trace, batch_id: batch };
}
