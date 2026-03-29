import type {
  FailureBundle,
  FailurePackDetail,
  FailurePackSummary,
  RecentRunSummary,
  RunBundle,
} from '../types';

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
  return fetchJson(`/api/debug/run/${encodeURIComponent(id)}?limit=5000`, timeoutMs);
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

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const raw = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  }
  if (typeof value === 'number') return value !== 0;
  return false;
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

  const payload = await fetchJson(`/api/debug/runs?${params.toString()}`, timeoutMs);
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

function normalizeFailureSummary(row: Record<string, unknown>): FailurePackSummary {
  return {
    failure_id: asString(row.failure_id) || 'unknown-failure',
    created_at: asString(row.created_at),
    updated_at: asString(row.updated_at),
    run_id: asString(row.run_id) || 'unknown-run',
    execution_id: asString(row.execution_id),
    workflow_id: asString(row.workflow_id),
    workflow_name: asString(row.workflow_name),
    mode: asString(row.mode),
    failed_at: asString(row.failed_at),
    node_name: asString(row.node_name),
    node_type: asString(row.node_type),
    error_name: asString(row.error_name),
    error_message: asString(row.error_message),
    status: asString(row.status),
    has_sidecars: asBoolean(row.has_sidecars),
    sidecar_root: asString(row.sidecar_root),
  };
}

function normalizeFailureDetail(data: Record<string, unknown>): FailurePackDetail {
  return {
    ...normalizeFailureSummary(data),
    pack: Object.prototype.hasOwnProperty.call(data, 'pack') ? data.pack : null,
  };
}

function normalizeRunTrace(value: unknown): RunBundle | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const rows = Array.isArray(obj.rows) ? obj.rows : [];
  const run_id = asString(obj.run_id)
    || (rows[0] && typeof rows[0] === 'object' ? asString((rows[0] as Record<string, unknown>).run_id) : null)
    || null;
  if (!run_id) return null;
  return {
    run_id,
    rows: rows as RunBundle['rows'],
  };
}

export interface FetchFailurePacksOptions {
  limit?: number;
  before_ts?: string | null;
  workflow_name?: string | null;
  node_name?: string | null;
  mode?: string | null;
}

export interface FetchFailurePacksResult {
  rows: FailurePackSummary[];
  limit: number;
  before_ts: string | null;
  workflow_name: string | null;
  node_name: string | null;
  mode: string | null;
}

export async function fetchFailurePacks(
  options: FetchFailurePacksOptions = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<FetchFailurePacksResult> {
  const params = new URLSearchParams();
  const limit = Number(options.limit ?? 20);
  params.set('limit', String(Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 20));
  if (options.before_ts) params.set('before_ts', options.before_ts);
  if (options.workflow_name) params.set('workflow_name', options.workflow_name);
  if (options.node_name) params.set('node_name', options.node_name);
  if (options.mode) params.set('mode', options.mode);

  const payload = await fetchJson(`/api/debug/failures?${params.toString()}`, timeoutMs);
  const data = (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : {};
  const rowsRaw = Array.isArray(data.rows) ? data.rows : [];
  const rows: FailurePackSummary[] = rowsRaw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((row) => normalizeFailureSummary(row));

  return {
    rows,
    limit: asNumber(data.limit, rows.length || 20),
    before_ts: asString(data.before_ts),
    workflow_name: asString(data.workflow_name),
    node_name: asString(data.node_name),
    mode: asString(data.mode),
  };
}

export async function fetchFailurePackById(
  failureId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<FailurePackDetail> {
  const id = String(failureId || '').trim();
  if (!id) throw new Error('failure id is required');
  const payload = await fetchJson(`/api/debug/failures/${encodeURIComponent(id)}`, timeoutMs);
  const data = (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : {};
  return normalizeFailureDetail(data);
}

export async function fetchFailurePackByRunId(
  runId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<FailurePackDetail> {
  const id = String(runId || '').trim();
  if (!id) throw new Error('run id is required');
  const payload = await fetchJson(`/api/debug/failures/by-run/${encodeURIComponent(id)}`, timeoutMs);
  const data = (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : {};
  return normalizeFailureDetail(data);
}

export async function fetchFailureBundleByRunId(
  runId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<FailureBundle> {
  const id = String(runId || '').trim();
  if (!id) throw new Error('run id is required');
  const payload = await fetchJson(`/api/debug/failure-bundle/${encodeURIComponent(id)}`, timeoutMs);
  const data = (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : {};
  const failure = data.failure && typeof data.failure === 'object'
    ? (data.failure as Record<string, unknown>)
    : null;
  return {
    run_id: asString(data.run_id) || id,
    failure: failure ? {
      failure_id: asString(failure.failure_id),
      workflow_name: asString(failure.workflow_name),
      node_name: asString(failure.node_name),
      error_message: asString(failure.error_message),
      failed_at: asString(failure.failed_at),
      mode: asString(failure.mode),
      status: asString(failure.status),
    } : null,
    pack: Object.prototype.hasOwnProperty.call(data, 'pack') ? data.pack : null,
    run_trace: normalizeRunTrace(data.run_trace),
  };
}
