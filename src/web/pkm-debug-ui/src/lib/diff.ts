import type { SummaryDiff } from '../types';

type FlatMap = Map<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function flatten(value: unknown, path: string, out: FlatMap): void {
  if (Array.isArray(value)) {
    out.set(`${path}.__length`, value.length);
    const sample = value.slice(0, 10);
    sample.forEach((item, idx) => flatten(item, `${path}[${idx}]`, out));
    return;
  }

  if (!isRecord(value)) {
    out.set(path, value);
    return;
  }

  const keys = Object.keys(value).sort();
  if (keys.length === 0) {
    out.set(path, '{}');
    return;
  }

  for (const key of keys) {
    const next = path ? `${path}.${key}` : key;
    flatten(value[key], next, out);
  }
}

function valueType(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

export function diffSummaries(before: unknown, after: unknown): SummaryDiff {
  const left: FlatMap = new Map();
  const right: FlatMap = new Map();

  flatten(before ?? {}, '', left);
  flatten(after ?? {}, '', right);

  const added_paths: string[] = [];
  const removed_paths: string[] = [];
  const type_changed: string[] = [];
  const hash_changed: string[] = [];
  const size_changed: Array<{ path: string; before: number; after: number; delta: number }> = [];
  const likely_signals: string[] = [];

  const allPaths = new Set([...left.keys(), ...right.keys()]);

  for (const path of [...allPaths].sort()) {
    const hasLeft = left.has(path);
    const hasRight = right.has(path);

    if (!hasLeft && hasRight) {
      added_paths.push(path);
      continue;
    }
    if (hasLeft && !hasRight) {
      removed_paths.push(path);
      continue;
    }

    const l = left.get(path);
    const r = right.get(path);

    if (valueType(l) !== valueType(r)) {
      type_changed.push(path);
      continue;
    }

    if (path.endsWith('sha256') && typeof l === 'string' && typeof r === 'string' && l !== r) {
      hash_changed.push(path);
    }

    if ((path.endsWith('char_count') || path.endsWith('__length')) && typeof l === 'number' && typeof r === 'number' && l !== r) {
      size_changed.push({ path, before: l, after: r, delta: r - l });
      if (l > 0 && r === 0) {
        likely_signals.push(`${path} dropped to 0`);
      }
      if (Math.abs(r - l) > 5000) {
        likely_signals.push(`${path} changed by ${r - l}`);
      }
    }
  }

  for (const path of type_changed) {
    likely_signals.push(`type changed at ${path}`);
  }

  for (const path of removed_paths) {
    if (path.includes('keys') || path.includes('fields')) {
      likely_signals.push(`summary structure removed at ${path}`);
    }
  }

  return {
    added_paths,
    removed_paths,
    type_changed,
    hash_changed,
    size_changed,
    likely_signals: [...new Set(likely_signals)].slice(0, 20),
  };
}
