import { stableStringify } from './stable';
import type { ReadItem, ReadOperation } from '../types';
import contextPackBuilder from '@shared/context-pack-builder.js';

export type ContextPackFormat = 'markdown' | 'json';

export interface ContextPackMeta {
  operation: ReadOperation;
  q: string;
  days: number | null;
  limit: number | null;
  generated_at: string;
  total_results: number;
}

function normValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'default';
  return String(value);
}

export function buildContextPackMarkdown(items: ReadItem[], meta: ContextPackMeta): string {
  const helper = contextPackBuilder as {
    buildContextPackMarkdown: (
      rows: Array<Record<string, unknown>>,
      payloadMeta: Record<string, unknown>,
      opts?: { markdownV2?: boolean; maxContentLen?: number },
    ) => string;
  };
  return helper.buildContextPackMarkdown(
    items.map((item) => item.raw),
    {
      method: meta.operation,
      query: meta.q,
      days: normValue(meta.days),
      limit: normValue(meta.limit),
    },
    { markdownV2: false },
  );
}

export function buildContextPackJson(items: ReadItem[], meta: ContextPackMeta): string {
  const payload = {
    generated_at: meta.generated_at,
    operation: meta.operation,
    q: meta.q,
    days: meta.days,
    limit: meta.limit,
    selected_count: items.length,
    total_results: meta.total_results,
    items: items.map((item) => ({
      entry_id: item.entry_id,
      title: item.title,
      author: item.author,
      source: item.source,
      created_at: item.created_at,
      url: item.url,
      clean_char_count: item.clean_char_count,
      excerpt: item.excerpt,
      raw: item.raw,
    })),
  };

  return stableStringify(payload, 2);
}

export function buildContextPack(
  format: ContextPackFormat,
  items: ReadItem[],
  meta: ContextPackMeta,
): string {
  return format === 'json'
    ? buildContextPackJson(items, meta)
    : buildContextPackMarkdown(items, meta);
}
