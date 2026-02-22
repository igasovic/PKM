import { stableStringify } from './stable';
import type { ReadItem, ReadOperation } from '../types';

export type ContextPackFormat = 'markdown' | 'json';

export interface ContextPackMeta {
  operation: ReadOperation;
  q: string;
  days: number | null;
  limit: number | null;
  run_id: string;
  generated_at: string;
  total_results: number;
}

function normValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'default';
  return String(value);
}

export function buildContextPackMarkdown(items: ReadItem[], meta: ContextPackMeta): string {
  const lines: string[] = [];
  lines.push('# Context Pack');
  lines.push(`generated_at: ${meta.generated_at}`);
  lines.push(`operation: ${meta.operation}`);
  lines.push(`q: "${meta.q}"`);
  lines.push(`days: ${normValue(meta.days)}`);
  lines.push(`limit: ${normValue(meta.limit)}`);
  lines.push(`run_id: ${meta.run_id}`);
  lines.push('');
  lines.push(`## Items (${items.length} selected of ${meta.total_results} total)`);
  lines.push('');

  items.forEach((item, idx) => {
    lines.push(`### Item ${idx + 1}`);
    lines.push(`entry_id: ${item.entry_id || ''}`);
    lines.push(`title: ${item.title || ''}`);
    lines.push(`author: ${item.author || ''}`);
    lines.push(`source: ${item.source || ''}`);
    lines.push(`created_at: ${item.created_at || ''}`);
    lines.push(`url: ${item.url || ''}`);
    if (item.clean_char_count !== null && item.clean_char_count !== undefined) {
      lines.push(`clean_char_count: ${item.clean_char_count}`);
    }
    lines.push('excerpt:');
    lines.push(item.excerpt || '');
    lines.push('');
  });

  return lines.join('\n').trim();
}

export function buildContextPackJson(items: ReadItem[], meta: ContextPackMeta): string {
  const payload = {
    generated_at: meta.generated_at,
    operation: meta.operation,
    q: meta.q,
    days: meta.days,
    limit: meta.limit,
    run_id: meta.run_id,
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
