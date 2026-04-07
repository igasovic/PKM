import type { ReadOperation } from '../types';

interface ReadInput {
  q: string;
  days?: number | null;
  limit?: number | null;
}

interface PullInput {
  entry_id: string;
  shortN?: number | null;
  longN?: number | null;
}

interface ReadOptions {
  runId: string;
  timeoutMs?: number;
}

export interface ReadApiResult {
  rows: unknown[];
  run_id: string;
}

const DEFAULT_TIMEOUT_MS = 20000;

function buildBody(input: ReadInput): Record<string, unknown> {
  const body: Record<string, unknown> = { q: input.q };
  if (input.days !== undefined && input.days !== null) body.days = input.days;
  if (input.limit !== undefined && input.limit !== null) body.limit = input.limit;
  return body;
}

function buildPullBody(input: PullInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    entry_id: String(input.entry_id || '').trim(),
  };
  if (input.shortN !== undefined && input.shortN !== null) body.shortN = input.shortN;
  if (input.longN !== undefined && input.longN !== null) body.longN = input.longN;
  return body;
}

async function postRead(operation: ReadOperation, input: ReadInput, options: ReadOptions): Promise<ReadApiResult> {
  const runId = String(options.runId || '').trim();
  if (!runId) throw new Error('run id is required');

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`/db/read/${operation}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-PKM-Run-Id': runId,
      },
      body: JSON.stringify(buildBody(input)),
    });

    const text = await res.text();
    let payload: unknown = [];
    try {
      payload = text ? JSON.parse(text) : [];
    } catch {
      throw new Error('server returned invalid JSON');
    }

    if (!res.ok) {
      const err = payload as { message?: string; error?: string };
      throw new Error(err?.message || err?.error || `http_${res.status}`);
    }

    const rows = Array.isArray(payload) ? payload : [];
    const echoedRunId = res.headers.get('X-PKM-Run-Id') || runId;

    return {
      rows,
      run_id: echoedRunId,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('read request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function readContinue(input: ReadInput, options: ReadOptions): Promise<ReadApiResult> {
  return postRead('continue', input, options);
}

export function readFind(input: ReadInput, options: ReadOptions): Promise<ReadApiResult> {
  return postRead('find', input, options);
}

export function readLast(input: ReadInput, options: ReadOptions): Promise<ReadApiResult> {
  return postRead('last', input, options);
}

export async function readPull(input: PullInput, options: ReadOptions): Promise<ReadApiResult> {
  const runId = String(options.runId || '').trim();
  if (!runId) throw new Error('run id is required');
  const entryId = String(input.entry_id || '').trim();
  if (!entryId) throw new Error('entry_id is required');

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch('/db/read/pull', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-PKM-Run-Id': runId,
      },
      body: JSON.stringify(buildPullBody(input)),
    });

    const text = await res.text();
    let payload: unknown = [];
    try {
      payload = text ? JSON.parse(text) : [];
    } catch {
      throw new Error('server returned invalid JSON');
    }

    if (!res.ok) {
      const err = payload as { message?: string; error?: string };
      throw new Error(err?.message || err?.error || `http_${res.status}`);
    }

    const rows = Array.isArray(payload) ? payload : [];
    const echoedRunId = res.headers.get('X-PKM-Run-Id') || runId;
    return {
      rows,
      run_id: echoedRunId,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('pull request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
