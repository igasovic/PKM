import type { PairedSpan, PipelineEventRow, RunSummary } from '../types';

export function buildInvestigationBundle(summary: RunSummary, spans: PairedSpan[], rows: PipelineEventRow[]) {
  const orderedRows = [...rows].sort((a, b) => {
    const seqA = Number.isFinite(Number(a.seq)) ? Number(a.seq) : Number.MAX_SAFE_INTEGER;
    const seqB = Number.isFinite(Number(b.seq)) ? Number(b.seq) : Number.MAX_SAFE_INTEGER;
    if (seqA !== seqB) return seqA - seqB;
    const tsA = a.ts ? Date.parse(String(a.ts)) : Number.MAX_SAFE_INTEGER;
    const tsB = b.ts ? Date.parse(String(b.ts)) : Number.MAX_SAFE_INTEGER;
    if (tsA !== tsB) return tsA - tsB;
    return 0;
  });

  const serializedSpans = spans.map((span) => ({
    id: span.id,
    pipeline: span.pipeline,
    step: span.step,
    status: span.status,
    duration_ms: span.duration_ms,
    start_seq: span.start?.seq ?? null,
    end_seq: span.end?.seq ?? null,
    diff: span.diff,
  }));

  return {
    summary,
    spans: serializedSpans,
    events: orderedRows,
  };
}
