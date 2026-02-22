import type { PairedSpan, PipelineEventRow, RunSummary, SpanStatus, TreeNode } from '../types';
import { diffSummaries } from './diff';

function asDirection(row: PipelineEventRow): string {
  return String(row.direction || '').toLowerCase();
}

function asTsMs(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function spanKey(row: PipelineEventRow): string {
  return `${String(row.pipeline || '')}::${String(row.step || '')}`;
}

function readDuration(start: PipelineEventRow | null, end: PipelineEventRow | null): number | null {
  if (end && typeof end.duration_ms === 'number' && Number.isFinite(end.duration_ms)) return end.duration_ms;
  if (!start || !end) return null;
  const from = asTsMs(start.ts);
  const to = asTsMs(end.ts);
  if (from === null || to === null || to < from) return null;
  return to - from;
}

export function pairSpans(rows: PipelineEventRow[]): PairedSpan[] {
  const spans: PairedSpan[] = [];
  const open = new Map<string, PipelineEventRow[]>();
  let idx = 0;

  for (const row of rows) {
    const direction = asDirection(row);
    const key = spanKey(row);

    if (direction === 'start') {
      const stack = open.get(key) || [];
      stack.push(row);
      open.set(key, stack);
      continue;
    }

    if (direction === 'end' || direction === 'error') {
      const stack = open.get(key) || [];
      const start = stack.length > 0 ? stack.pop() || null : null;
      if (stack.length > 0) {
        open.set(key, stack);
      } else {
        open.delete(key);
      }

      const status: SpanStatus = start
        ? (direction === 'error' ? 'error' : 'ok')
        : (direction === 'error' ? 'orphan_error' : 'orphan_end');

      const span: PairedSpan = {
        id: `span_${idx++}`,
        pipeline: String((start || row).pipeline || ''),
        step: String((start || row).step || ''),
        status,
        start,
        end: row,
        duration_ms: readDuration(start, row),
      };

      if (start && row) {
        span.diff = diffSummaries(start.input_summary || {}, row.output_summary || {});
      }

      spans.push(span);
    }
  }

  for (const stack of open.values()) {
    for (const start of stack) {
      spans.push({
        id: `span_${idx++}`,
        pipeline: String(start.pipeline || ''),
        step: String(start.step || ''),
        status: 'missing_end',
        start,
        end: null,
        duration_ms: null,
        diff: diffSummaries(start.input_summary || {}, {}),
      });
    }
  }

  return spans;
}

export function buildCallTree(rows: PipelineEventRow[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const stack: TreeNode[] = [];
  let idx = 0;

  const attachNode = (node: TreeNode): void => {
    if (stack.length === 0) {
      roots.push(node);
      return;
    }
    stack[stack.length - 1].children.push(node);
  };

  for (const row of rows) {
    const direction = asDirection(row);

    if (direction === 'start') {
      const node: TreeNode = {
        id: `node_${idx++}`,
        pipeline: String(row.pipeline || ''),
        step: String(row.step || ''),
        depth: stack.length,
        status: 'missing_end',
        start: row,
        end: null,
        duration_ms: null,
        children: [],
      };
      attachNode(node);
      stack.push(node);
      continue;
    }

    if (direction === 'end' || direction === 'error') {
      if (stack.length === 0) {
        roots.push({
          id: `node_${idx++}`,
          pipeline: String(row.pipeline || ''),
          step: String(row.step || ''),
          depth: 0,
          status: direction === 'error' ? 'orphan_error' : 'orphan_end',
          start: null,
          end: row,
          duration_ms: null,
          children: [],
        });
        continue;
      }

      let matchIndex = -1;
      const key = spanKey(row);
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (`${stack[i].pipeline}::${stack[i].step}` === key) {
          matchIndex = i;
          break;
        }
      }
      if (matchIndex === -1) matchIndex = stack.length - 1;

      for (let i = stack.length - 1; i > matchIndex; i -= 1) {
        const dangling = stack.pop();
        if (dangling) {
          dangling.status = 'missing_end';
        }
      }

      const node = stack.pop();
      if (!node) continue;
      node.end = row;
      node.status = direction === 'error' ? 'error' : 'ok';
      node.duration_ms = readDuration(node.start, row);
    }
  }

  while (stack.length > 0) {
    const dangling = stack.pop();
    if (!dangling) continue;
    dangling.status = 'missing_end';
  }

  return roots;
}

function collectNotes(rows: PipelineEventRow[]): string[] {
  const notes = new Set<string>();

  const walk = (value: unknown, path: string[] = []): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        walk(value[i], [...path, `[${i}]`]);
      }
      return;
    }

    const record = value as Record<string, unknown>;

    if (typeof record.boilerplate_heavy === 'boolean') {
      notes.add(`boilerplate_heavy=${record.boilerplate_heavy}`);
    }
    if (typeof record.link_count === 'number') {
      notes.add(`link_count=${record.link_count}`);
    }
    if (
      typeof record.char_count === 'number' &&
      path[path.length - 1] &&
      String(path[path.length - 1]).includes('clean_text')
    ) {
      notes.add(`clean_text=${record.char_count} chars`);
    }

    for (const key of Object.keys(record)) {
      walk(record[key], [...path, key]);
    }
  };

  for (const row of rows) {
    walk(row.input_summary, ['input_summary']);
    walk(row.output_summary, ['output_summary']);
  }

  return [...notes].sort();
}

export function computeRunSummary(run_id: string, rows: PipelineEventRow[], spans: PairedSpan[]): RunSummary {
  const tsValues = rows
    .map((row) => asTsMs(row.ts))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  const started = tsValues.length > 0 ? new Date(tsValues[0]).toISOString() : null;
  const ended = tsValues.length > 0 ? new Date(tsValues[tsValues.length - 1]).toISOString() : null;
  const total_ms = tsValues.length > 1 ? tsValues[tsValues.length - 1] - tsValues[0] : null;

  const error_count = spans.filter((span) => span.status === 'error' || span.status === 'orphan_error').length;
  const missing_end_count = spans.filter((span) => span.status === 'missing_end' || span.status === 'orphan_end').length;

  const slow_spans = spans
    .filter((span) => typeof span.duration_ms === 'number')
    .sort((a, b) => Number(b.duration_ms) - Number(a.duration_ms))
    .slice(0, 5)
    .map((span) => ({
      pipeline: span.pipeline,
      step: span.step,
      duration_ms: Number(span.duration_ms),
    }));

  let status: RunSummary['status'] = 'ok';
  if (error_count > 0) {
    status = 'error';
  } else if (missing_end_count > 0) {
    status = 'partial';
  }

  return {
    run_id,
    started_at: started,
    ended_at: ended,
    total_ms,
    status,
    error_count,
    missing_end_count,
    slow_spans,
    notes: collectNotes(rows),
  };
}
