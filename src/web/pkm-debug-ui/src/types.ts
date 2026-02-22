export type Direction = 'start' | 'end' | 'error' | string;

export type JsonLike =
  | null
  | boolean
  | number
  | string
  | JsonLike[]
  | { [key: string]: JsonLike };

export interface PipelineEventRow {
  event_id?: string;
  ts?: string;
  run_id?: string;
  seq?: number;
  service?: string;
  pipeline?: string;
  step?: string;
  direction?: Direction;
  level?: string;
  duration_ms?: number;
  entry_id?: number | null;
  batch_id?: string | null;
  trace_id?: string | null;
  input_summary?: Record<string, unknown> | null;
  output_summary?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  artifact_path?: string | null;
  meta?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface RunBundle {
  run_id: string;
  rows: PipelineEventRow[];
}

export interface RecentRunSummary {
  run_id: string;
  started_at: string | null;
  ended_at: string | null;
  total_ms: number | null;
  event_count: number;
  error_count: number;
  missing_end_count: number;
}

export type SpanStatus = 'ok' | 'error' | 'missing_end' | 'orphan_end' | 'orphan_error';

export interface PairedSpan {
  id: string;
  pipeline: string;
  step: string;
  status: SpanStatus;
  start: PipelineEventRow | null;
  end: PipelineEventRow | null;
  duration_ms: number | null;
  diff?: SummaryDiff;
}

export interface SummaryDiff {
  added_paths: string[];
  removed_paths: string[];
  type_changed: string[];
  hash_changed: string[];
  size_changed: Array<{ path: string; before: number; after: number; delta: number }>;
  likely_signals: string[];
}

export interface TreeNode {
  id: string;
  pipeline: string;
  step: string;
  depth: number;
  status: SpanStatus;
  start: PipelineEventRow | null;
  end: PipelineEventRow | null;
  duration_ms: number | null;
  children: TreeNode[];
}

export interface RunSummary {
  run_id: string;
  started_at: string | null;
  ended_at: string | null;
  total_ms: number | null;
  status: 'ok' | 'error' | 'partial';
  error_count: number;
  missing_end_count: number;
  slow_spans: Array<{ pipeline: string; step: string; duration_ms: number }>;
  notes: string[];
}
