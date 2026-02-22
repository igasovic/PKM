import type { PipelineEventRow, RunBundle } from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  return s ? s : undefined;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function normalizeRow(raw: unknown): PipelineEventRow {
  const src = isRecord(raw) ? raw : {};

  return {
    ...src,
    event_id: asString(src.event_id),
    ts: asString(src.ts),
    run_id: asString(src.run_id),
    seq: asNumber(src.seq),
    service: asString(src.service),
    pipeline: asString(src.pipeline),
    step: asString(src.step),
    direction: asString(src.direction),
    level: asString(src.level),
    duration_ms: asNumber(src.duration_ms),
    entry_id: asNumber(src.entry_id),
    batch_id: asString(src.batch_id),
    trace_id: asString(src.trace_id),
    input_summary: asObject(src.input_summary),
    output_summary: asObject(src.output_summary),
    error: asObject(src.error),
    artifact_path: asString(src.artifact_path),
    meta: asObject(src.meta),
  };
}

function rowSortKey(row: PipelineEventRow): { seq: number; ts: number } {
  const seq = Number.isFinite(Number(row.seq)) ? Number(row.seq) : Number.MAX_SAFE_INTEGER;
  const tsRaw = row.ts ? Date.parse(String(row.ts)) : NaN;
  const ts = Number.isFinite(tsRaw) ? tsRaw : Number.MAX_SAFE_INTEGER;
  return { seq, ts };
}

function sortRows(rows: PipelineEventRow[]): PipelineEventRow[] {
  return rows
    .map((row, idx) => ({ row, idx }))
    .sort((a, b) => {
      const ka = rowSortKey(a.row);
      const kb = rowSortKey(b.row);
      if (ka.seq !== kb.seq) return ka.seq - kb.seq;
      if (ka.ts !== kb.ts) return ka.ts - kb.ts;
      return a.idx - b.idx;
    })
    .map((item) => item.row);
}

function chooseRunId(rows: PipelineEventRow[], preferred?: string): string {
  const pinned = asString(preferred);
  if (pinned) return pinned;

  const counts = new Map<string, number>();
  for (const row of rows) {
    const id = asString(row.run_id);
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  if (counts.size === 0) return 'unknown-run';

  let bestId = '';
  let bestCount = -1;
  for (const [id, count] of counts.entries()) {
    if (count > bestCount) {
      bestId = id;
      bestCount = count;
    }
  }
  return bestId;
}

function normalizeRows(rowsRaw: unknown[]): PipelineEventRow[] {
  return sortRows(rowsRaw.map(normalizeRow));
}

function normalizeFromObject(obj: Record<string, unknown>, preferredRunId?: string): RunBundle {
  const rowsRaw = Array.isArray(obj.rows) ? obj.rows : [];
  const rows = normalizeRows(rowsRaw);
  const run_id = chooseRunId(rows, asString(obj.run_id) || preferredRunId);
  return { run_id, rows };
}

export function normalizeRunBundle(payload: unknown, preferredRunId?: string): RunBundle {
  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return { run_id: chooseRunId([], preferredRunId), rows: [] };
    }

    const first = payload[0];

    if (isRecord(first) && Array.isArray(first.rows)) {
      const bundles = payload.filter(isRecord).map((item) => normalizeFromObject(item, preferredRunId));
      const preferred = asString(preferredRunId);
      if (preferred) {
        const hit = bundles.find((item) => item.run_id === preferred);
        if (hit) return hit;
      }
      return bundles[0];
    }

    const rows = normalizeRows(payload);
    return {
      run_id: chooseRunId(rows, preferredRunId),
      rows,
    };
  }

  if (isRecord(payload)) {
    return normalizeFromObject(payload, preferredRunId);
  }

  throw new Error('unsupported payload shape');
}
