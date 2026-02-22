import type { ReadItem } from '../types';

interface NormalizeOptions {
  snippetLength?: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return (value && typeof value === 'object' && !Array.isArray(value))
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  const out = String(value).trim();
  return out;
}

function pick(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = text(obj[key]);
    if (value) return value;
  }
  return '';
}

function snip(value: string, maxLen: number): string {
  if (!value) return '';
  if (value.length <= maxLen) return value;
  return `${value.slice(0, Math.max(0, maxLen - 1))}…`;
}

function excerptForRow(obj: Record<string, unknown>, maxLen: number): string {
  const retrieval = pick(obj, ['retrieval_excerpt']);
  if (retrieval) return snip(retrieval, maxLen);

  const gist = pick(obj, ['gist']);
  if (gist) return snip(gist, maxLen);

  const clean = pick(obj, ['clean_text']);
  if (clean) return snip(clean, maxLen);

  const capture = pick(obj, ['capture_text']);
  if (capture) return snip(capture, maxLen);

  const keys = Object.keys(obj).sort();
  return keys.length > 0 ? `JSON keys: ${keys.join(', ')}` : 'No textual content';
}

export function normalizeReadRows(rows: unknown[], options: NormalizeOptions = {}): ReadItem[] {
  const maxLen = Number.isFinite(Number(options.snippetLength))
    ? Math.max(50, Number(options.snippetLength))
    : 800;

  return rows.map((row, index) => {
    const raw = asRecord(row);
    const entryId = pick(raw, ['entry_id']);
    const fallbackId = pick(raw, ['id']) || `row_${index + 1}`;
    const id = entryId || fallbackId;

    const title = pick(raw, ['title']);
    const source = pick(raw, ['source']);
    const author = pick(raw, ['author']);
    const createdAt = pick(raw, ['created_at']);
    const url = pick(raw, ['url', 'url_canonical']);
    const cleanCharCount = pick(raw, ['clean_char_count']);
    const excerpt = excerptForRow(raw, maxLen);

    return {
      id,
      index,
      entry_id: entryId || null,
      title: title || null,
      author: author || null,
      source: source || null,
      created_at: createdAt || null,
      url: url || null,
      clean_char_count: cleanCharCount ? Number(cleanCharCount) : null,
      excerpt,
      raw,
    };
  });
}
