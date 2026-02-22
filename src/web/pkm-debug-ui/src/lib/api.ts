const DEFAULT_TIMEOUT_MS = 20000;

export async function fetchRunById(runId: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  const id = String(runId || '').trim();
  if (!id) throw new Error('run id is required');

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(`/debug/run/${encodeURIComponent(id)}?limit=5000`, {
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
