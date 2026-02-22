export function createUiRunId(prefix = 'ui-read'): string {
  const base = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  return `${prefix}-${base}`;
}
