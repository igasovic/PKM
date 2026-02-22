import type { RecentRunSummary } from '../types';

const DEFAULT_TIMEOUT_MS = 20000;

async function fetchJson(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(path, {
      method: 'GET',
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    const text = await res.text();
    let payload: unknown;

    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error('server returned invalid JSON');
    }

    if (!res.ok) {
      const err = payload as { message?: string; error?: string };
      const details = err?.message || err?.error || `http_${res.status}`;
      throw new Error(details);
    }

    return payload;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchRunById(runId: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  const id = String(runId || '').trim();
  if (!id) throw new Error('run id is required');
  return fetchJson(`/debug/run/${encodeURIComponent(id)}?limit=5000`, timeoutMs);
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str || null;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = asNumber(value, Number.NaN);
  return Number.isFinite(n) ? n : null;
}

export interface FetchRecentRunsOptions {
  limit?: number;
  before_ts?: string | null;
  has_error?: boolean | null;
}

export interface FetchRecentRunsResult {
  rows: RecentRunSummary[];
  limit: number;
  before_ts: string | null;
  has_error: boolean | null;
}

export async function fetchRecentRuns(
  options: FetchRecentRunsOptions = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<FetchRecentRunsResult> {
  const params = new URLSearchParams();
  const limit = Number(options.limit ?? 30);
  params.set('limit', String(Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 30));
  if (options.before_ts) params.set('before_ts', options.before_ts);
  if (options.has_error === true) params.set('has_error', 'true');
  if (options.has_error === false) params.set('has_error', 'false');

  const payload = await fetchJson(`/debug/runs?${params.toString()}`, timeoutMs);
  const data = (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : {};
  const rowsRaw = Array.isArray(data.rows) ? data.rows : [];

  const rows: RecentRunSummary[] = rowsRaw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((row) => ({
      run_id: asString(row.run_id) || 'unknown-run',
      started_at: asString(row.started_at),
      ended_at: asString(row.ended_at),
      total_ms: asNullableNumber(row.total_ms),
      event_count: asNumber(row.event_count, 0),
      error_count: asNumber(row.error_count, 0),
      missing_end_count: asNumber(row.missing_end_count, 0),
    }));

  return {
    rows,
    limit: asNumber(data.limit, rows.length || 30),
    before_ts: asString(data.before_ts),
    has_error: data.has_error === true ? true : data.has_error === false ? false : null,
  };
}
