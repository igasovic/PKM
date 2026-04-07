import { fmtTs } from '../lib/format';
import { toStandardizedEntryView } from '../lib/entryStandardize';
import { stableStringify } from '../lib/stable';

interface EntryStandardCardProps {
  title: string;
  payload: unknown;
  fullPayload?: unknown;
  fullJsonLabel?: string;
}

export function EntryStandardCard({
  title,
  payload,
  fullPayload,
  fullJsonLabel = 'Full JSON payload',
}: EntryStandardCardProps) {
  const view = toStandardizedEntryView(payload);
  const keywordsText = view.keywords.length ? view.keywords.join(', ') : '-';

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        <span
          className={`rounded border px-2 py-0.5 text-xs ${
            view.found
              ? 'border-emerald-700/70 bg-emerald-900/20 text-emerald-300'
              : 'border-amber-700/70 bg-amber-900/20 text-amber-300'
          }`}
        >
          {view.found ? 'Found' : 'Not Found'}
        </span>
      </div>

      <div className="mt-3 grid gap-2 rounded border border-slate-800 bg-slate-950/40 p-2 text-xs text-slate-300 md:grid-cols-2">
        <div>entry_id: {view.entryId}</div>
        <div>source: {view.source}</div>
        <div>author: {view.author}</div>
        <div>content_type: {view.contentType}</div>
        <div>created: {view.createdAt ? fmtTs(view.createdAt) : '-'}</div>
        <div>words: {view.wordCount ?? '-'}</div>
      </div>

      <div className="mt-3 space-y-2 text-sm">
        <div className="text-slate-100">{view.title || '(no title)'}</div>
        {view.url && (
          <div className="truncate text-xs text-sky-300" title={view.url}>{view.url}</div>
        )}
        <div className="text-xs text-slate-300">
          topic: {view.topicPrimary || '-'} -&gt; {view.topicSecondary || '-'}
        </div>
        <div className="text-xs text-slate-300">
          keywords: {keywordsText}
        </div>
        {view.summary && (
          <div className="rounded border border-slate-800 bg-slate-950/50 p-2">
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Summary</div>
            <div className="whitespace-pre-wrap text-sm text-slate-200">{view.summary}</div>
          </div>
        )}
        {view.whyItMatters && (
          <div className="rounded border border-slate-800 bg-slate-950/50 p-2">
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Why It Matters</div>
            <div className="whitespace-pre-wrap text-sm text-slate-200">{view.whyItMatters}</div>
          </div>
        )}
        <div className="rounded border border-slate-800 bg-slate-950/50 p-2">
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Standardized Content</div>
          <div className="whitespace-pre-wrap text-sm text-slate-200">{view.body}</div>
        </div>
      </div>

      <details className="mt-3 rounded border border-slate-800 bg-slate-950/60">
        <summary className="cursor-pointer px-2 py-1 text-xs text-slate-300">{fullJsonLabel}</summary>
        <pre className="max-h-64 overflow-auto border-t border-slate-800 p-2 text-[11px] text-slate-300">
          {stableStringify(fullPayload ?? payload, 2)}
        </pre>
      </details>
    </section>
  );
}
