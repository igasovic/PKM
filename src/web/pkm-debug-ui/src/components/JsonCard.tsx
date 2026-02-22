import { useMemo, useState } from 'react';
import { copyText, stableStringify } from '../lib/stable';

function previewLargeStrings(value: unknown): unknown {
  if (typeof value === 'string' && value.length > 2000) {
    return `[string:${value.length} chars]`;
  }

  if (Array.isArray(value)) {
    const limit = value.length > 50 ? 50 : value.length;
    const items = value.slice(0, limit).map(previewLargeStrings);
    if (value.length > limit) items.push(`...[${value.length - limit} more items]`);
    return items;
  }

  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const keys = Object.keys(src).sort();
    for (const key of keys) {
      out[key] = previewLargeStrings(src[key]);
    }
    return out;
  }

  return value;
}

interface JsonCardProps {
  title: string;
  data: unknown;
  defaultOpen?: boolean;
}

export function JsonCard({ title, data, defaultOpen = false }: JsonCardProps) {
  const [copied, setCopied] = useState(false);
  const normalized = useMemo(() => previewLargeStrings(data), [data]);
  const text = useMemo(() => stableStringify(normalized, 2), [normalized]);

  const copy = async () => {
    await copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <details
      className="rounded-lg border border-slate-800 bg-slate-900/70"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-slate-200">
        <span>{title}</span>
        <button
          type="button"
          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
          onClick={(event) => {
            event.preventDefault();
            void copy();
          }}
        >
          {copied ? 'Copied' : 'Copy JSON'}
        </button>
      </summary>
      <pre className="max-h-[22rem] overflow-auto border-t border-slate-800 px-3 py-2 text-xs text-slate-300">
{text}
      </pre>
    </details>
  );
}
