export interface WorkingMemoryReadOptions {
  runId: string;
  timeoutMs?: number;
  view?: 'gpt' | 'debug';
}

export interface WorkingMemoryEnvelope {
  action?: string;
  method?: string;
  outcome?: string;
  result?: {
    meta?: Record<string, unknown>;
    row?: Record<string, unknown> | null;
  };
  error?: Record<string, unknown> | string | null;
}

export interface TopicPatchRequest {
  state?: {
    title?: string;
    why_active_now?: string;
    current_mental_model?: string;
    tensions_uncertainties?: string;
    last_session_id?: string;
  };
  open_questions?: {
    upsert?: Array<{ id?: string; text: string; status?: 'open' | 'closed' }>;
    close?: string[];
    reopen?: string[];
    delete?: string[];
  };
  action_items?: {
    upsert?: Array<{ id?: string; text: string; status?: 'open' | 'done' }>;
    done?: string[];
    reopen?: string[];
    delete?: string[];
  };
}

export interface TopicPatchResult {
  payload: Record<string, unknown>;
  run_id: string;
}

export interface WorkingMemoryReadResult {
  payload: WorkingMemoryEnvelope;
  run_id: string;
}

const DEFAULT_TIMEOUT_MS = 20000;

function asErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const obj = payload as Record<string, unknown>;
  const message = String(obj.message || '').trim();
  if (message) return message;
  const errorValue = obj.error;
  if (!errorValue) return fallback;
  if (typeof errorValue === 'string') {
    const fromString = errorValue.trim();
    if (fromString) return fromString;
    return fallback;
  }
  if (typeof errorValue === 'object') {
    const fromObject = String((errorValue as Record<string, unknown>).message || '').trim();
    if (fromObject) return fromObject;
  }
  return fallback;
}

export async function readWorkingMemory(
  topic: string,
  options: WorkingMemoryReadOptions,
): Promise<WorkingMemoryReadResult> {
  const runId = String(options.runId || '').trim();
  if (!runId) throw new Error('run id is required');
  const topicText = String(topic || '').trim();
  if (!topicText) throw new Error('topic is required');

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch('/chatgpt/working_memory', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-PKM-Run-Id': runId,
      },
      body: JSON.stringify({
        topic: topicText,
        ...(options.view ? { view: options.view } : {}),
      }),
    });

    const text = await res.text();
    let payload: unknown = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error('server returned invalid JSON');
    }

    if (!res.ok) {
      throw new Error(asErrorMessage(payload, `http_${res.status}`));
    }

    const safePayload = payload && typeof payload === 'object'
      ? payload as WorkingMemoryEnvelope
      : {};
    const echoedRunId = res.headers.get('X-PKM-Run-Id') || runId;
    return {
      payload: safePayload,
      run_id: echoedRunId,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('working memory request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function patchTopicState(
  topic: string,
  topicPatch: TopicPatchRequest,
  options: WorkingMemoryReadOptions,
): Promise<TopicPatchResult> {
  const runId = String(options.runId || '').trim();
  if (!runId) throw new Error('run id is required');
  const topicText = String(topic || '').trim();
  if (!topicText) throw new Error('topic is required');
  if (!topicPatch || typeof topicPatch !== 'object' || Array.isArray(topicPatch)) {
    throw new Error('topic patch is required');
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch('/chatgpt/topic-state', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-PKM-Run-Id': runId,
      },
      body: JSON.stringify({
        topic: topicText,
        topic_patch: topicPatch,
      }),
    });

    const text = await res.text();
    let payload: unknown = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error('server returned invalid JSON');
    }

    if (!res.ok) {
      throw new Error(asErrorMessage(payload, `http_${res.status}`));
    }

    const safePayload = payload && typeof payload === 'object'
      ? payload as Record<string, unknown>
      : {};
    const echoedRunId = res.headers.get('X-PKM-Run-Id') || runId;
    return {
      payload: safePayload,
      run_id: echoedRunId,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('topic patch request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
