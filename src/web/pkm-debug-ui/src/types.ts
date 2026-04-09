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

export interface FailurePackSummary {
  failure_id: string;
  created_at: string | null;
  updated_at: string | null;
  run_id: string;
  execution_id: string | null;
  workflow_id: string | null;
  workflow_name: string | null;
  mode: string | null;
  failed_at: string | null;
  node_name: string | null;
  node_type: string | null;
  error_name: string | null;
  error_message: string | null;
  status: string | null;
  has_sidecars: boolean;
  sidecar_root: string | null;
}

export interface FailurePackDetail extends FailurePackSummary {
  pack: unknown;
}

export interface FailureBundle {
  run_id: string;
  failure: {
    failure_id: string | null;
    workflow_name: string | null;
    node_name: string | null;
    error_message: string | null;
    failed_at: string | null;
    mode: string | null;
    status: string | null;
  } | null;
  pack: unknown;
  run_trace: RunBundle | null;
}

export type ReadOperation = 'continue' | 'find' | 'last';

export interface ReadItem {
  id: string;
  index: number;
  entry_id: string | null;
  title: string | null;
  author: string | null;
  source: string | null;
  created_at: string | null;
  url: string | null;
  clean_char_count: number | null;
  excerpt: string;
  raw: Record<string, unknown>;
}

export interface EntityListRow {
  entry_id: string | null;
  id: string | null;
  created_at: string | null;
  source: string | null;
  intent: string | null;
  content_type: string | null;
  title: string | null;
  author: string | null;
  url: string | null;
  topic_primary: string | null;
  topic_secondary: string | null;
  gist: string | null;
  excerpt: string | null;
  distill_status: string | null;
  low_signal: boolean;
  boilerplate_heavy: boolean;
  raw: Record<string, unknown>;
}

export interface EntitiesListMeta {
  page: number;
  page_size: number;
  total_count: number;
  total_pages: number;
  schema: string;
  is_test_mode: boolean;
  topic_primary_options: string[];
}

export interface RecipeUpsertPayload {
  id: number;
  public_id: string;
  created_at: string;
  updated_at: string;
  title: string;
  title_normalized: string;
  servings: number;
  ingredients: string[];
  instructions: string[];
  notes: string | null;
  search_text: string;
  status: 'active' | 'needs_review' | 'archived' | string;
  metadata: Record<string, unknown> | null;
  source: string | null;
  cuisine: string | null;
  protein: string | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  total_time_minutes: number | null;
  difficulty: string | null;
  tags: string[] | null;
  url_canonical: string | null;
  capture_text: string;
  overnight: boolean;
  review_reasons: string[];
  linked_recipes?: RecipeLinkedItem[];
}

export interface RecipeLinkedItem {
  public_id: string;
  title: string;
  status: string;
}

export interface RecipeAlternative {
  public_id: string;
  title: string;
  status: string;
  review_reasons: string[];
  cuisine: string | null;
  protein: string | null;
  difficulty: string | null;
  total_time_minutes: number | null;
  tags: string[] | null;
  updated_at: string | null;
}

export interface RecipeSearchResult {
  query: string;
  top_hit: RecipeUpsertPayload | null;
  alternatives: RecipeAlternative[];
  total_candidates: number;
}

export interface RecipeReviewQueueItem {
  id: number;
  public_id: string;
  title: string;
  status: string;
  review_reasons: string[];
  created_at: string;
}

export interface RecipeReviewQueueResult {
  rows: RecipeReviewQueueItem[];
  limit: number;
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
