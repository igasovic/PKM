import type { EntityListRow, EntitiesListMeta } from '../types';

const DEFAULT_TIMEOUT_MS = 20000;

type JsonObject = Record<string, unknown>;

export interface EntitiesFiltersInput {
  content_type?: string;
  source?: string;
  status?: string;
  intent?: string;
  topic_primary?: string;
  created_from?: string;
  created_to?: string;
  has_url?: boolean | null;
  quality_flag?: 'low_signal' | 'boilerplate_heavy' | '';
}

export interface ListEntitiesInput {
  page?: number;
  page_size?: number;
  filters?: EntitiesFiltersInput;
}

export interface ListEntitiesResult {
  rows: EntityListRow[];
  meta: EntitiesListMeta;
  run_id: string;
}

export interface DeleteEntitiesResult {
  schema: string;
  matched_count: number;
  deleted_count: number;
}

export interface MoveEntitiesResult {
  from_schema: string;
  to_schema: string;
  matched_count: number;
  moved_count: number;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out || null;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  }
  return false;
}

function toObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function normalizeTopicOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function normalizeEntityRow(raw: unknown): EntityListRow {
  const row = toObject(raw);
  return {
    entry_id: toText(row.entry_id),
    id: toText(row.id),
    created_at: toText(row.created_at),
    source: toText(row.source),
    intent: toText(row.intent),
    content_type: toText(row.content_type),
    title: toText(row.title),
    author: toText(row.author),
    url: toText(row.url),
    topic_primary: toText(row.topic_primary),
    topic_secondary: toText(row.topic_secondary),
    gist: toText(row.gist),
    excerpt: toText(row.excerpt),
    distill_status: toText(row.distill_status),
    low_signal: toBoolean(row.low_signal),
    boilerplate_heavy: toBoolean(row.boilerplate_heavy),
    raw: row,
  };
}

async function postJson(path: string, body: unknown, timeoutMs = DEFAULT_TIMEOUT_MS, runId = ''): Promise<{ payload: unknown; run_id: string }> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const run_id = String(runId || '').trim();
    if (run_id) headers['X-PKM-Run-Id'] = run_id;

    const res = await fetch(path, {
      method: 'POST',
      signal: ctrl.signal,
      headers,
      body: JSON.stringify(body ?? {}),
    });

    const text = await res.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : [];
    } catch {
      throw new Error('server returned invalid JSON');
    }

    if (!res.ok) {
      const err = payload as { message?: string; error?: string };
      throw new Error(err?.message || err?.error || `http_${res.status}`);
    }

    return {
      payload,
      run_id: res.headers.get('X-PKM-Run-Id') || run_id,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeEntityFilters(filters: EntitiesFiltersInput = {}): JsonObject {
  const out: JsonObject = {};
  const textKeys: Array<keyof EntitiesFiltersInput> = [
    'content_type',
    'source',
    'status',
    'intent',
    'topic_primary',
    'created_from',
    'created_to',
    'quality_flag',
  ];
  for (const key of textKeys) {
    const value = String(filters[key] || '').trim();
    if (!value) continue;
    out[key] = value;
  }
  if (Object.prototype.hasOwnProperty.call(filters, 'has_url')) {
    const hasUrl = filters.has_url;
    out.has_url = hasUrl === null || hasUrl === undefined ? null : !!hasUrl;
  }
  return out;
}

function normalizeEntryIds(entryIds: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of entryIds) {
    const id = String(value || '').trim();
    if (!/^\d+$/.test(id)) continue;
    if (id === '0') continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export async function listEntities(input: ListEntitiesInput, runId: string): Promise<ListEntitiesResult> {
  const page = Number.isFinite(Number(input.page)) && Number(input.page) > 0 ? Math.trunc(Number(input.page)) : 1;
  const page_size = Number.isFinite(Number(input.page_size)) && Number(input.page_size) > 0
    ? Math.min(200, Math.trunc(Number(input.page_size)))
    : 50;
  const body = {
    page,
    page_size,
    filters: normalizeEntityFilters(input.filters || {}),
  };
  const { payload, run_id } = await postJson('/db/read/entities', body, DEFAULT_TIMEOUT_MS, runId);
  const rows = Array.isArray(payload) ? payload : [];
  const metaRaw = rows.find((row) => toBoolean(toObject(row).is_meta)) || {};
  const metaObj = toObject(metaRaw);

  const hits: EntityListRow[] = rows
    .filter((row) => !toBoolean(toObject(row).is_meta))
    .map((row) => normalizeEntityRow(row));

  const meta: EntitiesListMeta = {
    page: toNumber(metaObj.page, page),
    page_size: toNumber(metaObj.page_size, page_size),
    total_count: toNumber(metaObj.total_count, hits.length),
    total_pages: toNumber(metaObj.total_pages, hits.length > 0 ? 1 : 0),
    schema: toText(metaObj.schema) || 'pkm',
    is_test_mode: toBoolean(metaObj.is_test_mode),
    topic_primary_options: normalizeTopicOptions(metaObj.topic_primary_options),
  };

  return {
    rows: hits,
    meta,
    run_id,
  };
}

export async function deleteEntitiesByIds(schema: string, entryIds: string[]): Promise<DeleteEntitiesResult> {
  const ids = normalizeEntryIds(entryIds);
  if (!ids.length) {
    throw new Error('select at least one entity');
  }
  const { payload } = await postJson('/db/delete', {
    schema,
    entry_ids: ids,
    dry_run: false,
    force: false,
  });
  const row = Array.isArray(payload) && payload[0] && typeof payload[0] === 'object'
    ? payload[0] as JsonObject
    : {};
  return {
    schema: toText(row.schema) || schema,
    matched_count: toNumber(row.matched_count, 0),
    deleted_count: toNumber(row.deleted_count, 0),
  };
}

export async function moveEntitiesByIds(fromSchema: string, toSchema: string, entryIds: string[]): Promise<MoveEntitiesResult> {
  const ids = normalizeEntryIds(entryIds);
  if (!ids.length) {
    throw new Error('select at least one entity');
  }
  if (fromSchema === toSchema) {
    throw new Error('destination schema must differ from current schema');
  }
  const { payload } = await postJson('/db/move', {
    from_schema: fromSchema,
    to_schema: toSchema,
    entry_ids: ids,
    dry_run: false,
    force: false,
  });
  const row = Array.isArray(payload) && payload[0] && typeof payload[0] === 'object'
    ? payload[0] as JsonObject
    : {};
  return {
    from_schema: toText(row.from_schema) || fromSchema,
    to_schema: toText(row.to_schema) || toSchema,
    matched_count: toNumber(row.matched_count, 0),
    moved_count: toNumber(row.moved_count, 0),
  };
}
