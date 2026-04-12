import { useEffect, useMemo, useState } from 'react';
import { fmtTs } from '../lib/format';
import {
  todoistReviewAccept,
  todoistReviewOverride,
  todoistReviewQueue,
  todoistReviewReparse,
} from '../lib/todoistApi';
import type {
  TodoistReviewView,
  TodoistTaskCurrent,
  TodoistTaskEvent,
  TodoistTaskShape,
} from '../types';

const VIEW_OPTIONS: Array<{ value: TodoistReviewView; label: string }> = [
  { value: 'needs_review', label: 'Needs Review' },
  { value: 'unreviewed', label: 'Unreviewed' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'overridden', label: 'Overridden' },
  { value: 'all', label: 'All' },
];

const TASK_SHAPES: TodoistTaskShape[] = [
  'project',
  'next_action',
  'micro_task',
  'follow_up',
  'vague_note',
  'unknown',
];

function toPretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function parseLimit(raw: string): number {
  const n = Number(String(raw || '').trim());
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.max(1, Math.min(200, Math.trunc(n)));
}

function confidencePct(value: number): string {
  if (!Number.isFinite(value)) return '-';
  return `${Math.round(value * 100)}%`;
}

function badgeClass(reviewStatus: string | null): string {
  const status = String(reviewStatus || '').toLowerCase();
  if (status === 'needs_review') return 'border-amber-600/60 bg-amber-900/25 text-amber-300';
  if (status === 'accepted') return 'border-emerald-600/60 bg-emerald-900/25 text-emerald-300';
  if (status === 'overridden') return 'border-indigo-600/60 bg-indigo-900/25 text-indigo-300';
  return 'border-slate-700 bg-slate-900/60 text-slate-300';
}

function taskTitle(task: TodoistTaskCurrent): string {
  return task.normalized_title_en || task.raw_title || '(untitled task)';
}

function projectMeta(task: TodoistTaskCurrent): string {
  const project = task.todoist_project_name || task.project_key || 'unknown_project';
  const section = task.todoist_section_name || task.lifecycle_status || 'unknown_section';
  return `${project} / ${section}`;
}

function buildSelectedTaskJson(task: TodoistTaskCurrent, history: TodoistTaskEvent[]): string {
  const originalDataTodoist = {
    todoist_task_id: task.todoist_task_id,
    todoist_project_id: task.todoist_project_id,
    todoist_project_name: task.todoist_project_name,
    todoist_section_id: task.todoist_section_id,
    todoist_section_name: task.todoist_section_name,
    raw_title: task.raw_title,
    raw_description: task.raw_description,
    todoist_priority: task.todoist_priority,
    todoist_due_date: task.todoist_due_date,
    todoist_due_string: task.todoist_due_string,
    todoist_due_is_recurring: task.todoist_due_is_recurring,
    todoist_added_at: task.todoist_added_at,
  };

  const pkmData = {
    id: task.id,
    project_key: task.project_key,
    lifecycle_status: task.lifecycle_status,
    normalized_title_en: task.normalized_title_en,
    task_shape: task.task_shape,
    suggested_next_action: task.suggested_next_action,
    parse_confidence: task.parse_confidence,
    review_status: task.review_status,
    review_reasons: task.review_reasons,
    first_seen_at: task.first_seen_at,
    last_seen_at: task.last_seen_at,
    waiting_since_at: task.waiting_since_at,
    closed_at: task.closed_at,
    parsed_at: task.parsed_at,
    created_at: task.created_at,
    updated_at: task.updated_at,
  };

  const eventHistory = history.map((event) => ({
    id: event.id,
    task_id: event.task_id,
    event_at: event.event_at,
    event_type: event.event_type,
    changed_fields: event.changed_fields,
    reason: event.reason,
    before_json: event.before_json,
    after_json: event.after_json,
  }));

  return JSON.stringify({
    original_data_todoist: originalDataTodoist,
    pkm_data: pkmData,
    event_history: eventHistory,
  }, null, 2);
}

export function TodoistPage() {
  const [view, setView] = useState<TodoistReviewView>('needs_review');
  const [limitInput, setLimitInput] = useState('50');

  const [rows, setRows] = useState<TodoistTaskCurrent[]>([]);
  const [selected, setSelected] = useState<TodoistTaskCurrent | null>(null);
  const [events, setEvents] = useState<TodoistTaskEvent[]>([]);

  const [editTitle, setEditTitle] = useState('');
  const [editShape, setEditShape] = useState<TodoistTaskShape>('unknown');
  const [editNextAction, setEditNextAction] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const selectedIndex = useMemo(() => {
    if (!selected) return -1;
    return rows.findIndex((row) => row.todoist_task_id === selected.todoist_task_id);
  }, [rows, selected]);

  const selectedId = selected?.todoist_task_id || null;

  function syncEditor(task: TodoistTaskCurrent | null) {
    if (!task) {
      setEditTitle('');
      setEditShape('unknown');
      setEditNextAction('');
      return;
    }
    setEditTitle(task.normalized_title_en || task.raw_title || '');
    const shape = TASK_SHAPES.includes((task.task_shape || '') as TodoistTaskShape)
      ? (task.task_shape as TodoistTaskShape)
      : 'unknown';
    setEditShape(shape);
    setEditNextAction(task.suggested_next_action || '');
  }

  async function loadQueue(next: {
    nextView?: TodoistReviewView;
    nextSelectedId?: string | null;
  } = {}) {
    const targetView = next.nextView || view;
    const targetSelectedId = next.nextSelectedId === undefined ? selectedId : next.nextSelectedId;

    setBusy(true);
    setError(null);

    try {
      const result = await todoistReviewQueue({
        view: targetView,
        limit: parseLimit(limitInput),
        offset: 0,
        todoist_task_id: targetSelectedId,
        events_limit: 120,
      });

      const queueRows = Array.isArray(result.rows) ? result.rows : [];
      const selectedRow = result.selected
        || (targetSelectedId ? queueRows.find((row) => row.todoist_task_id === targetSelectedId) || null : null)
        || (queueRows[0] || null);

      setRows(queueRows);
      setSelected(selectedRow);
      syncEditor(selectedRow);

      if (selectedRow && result.selected && result.selected.todoist_task_id === selectedRow.todoist_task_id) {
        setEvents(Array.isArray(result.events) ? result.events : []);
      } else {
        setEvents([]);
      }

      if (!selectedRow) {
        setInfo('No matching review rows for this view.');
      }
    } catch (err) {
      setRows([]);
      setSelected(null);
      setEvents([]);
      syncEditor(null);
      setError(err instanceof Error ? err.message : 'failed to load queue');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadQueue({ nextView: view, nextSelectedId: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  async function selectTask(todoistTaskId: string) {
    setInfo(null);
    await loadQueue({ nextSelectedId: todoistTaskId });
  }

  async function runAccept() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await todoistReviewAccept(selected.todoist_task_id);
      const nextRow = rows[selectedIndex + 1] || rows[selectedIndex - 1] || null;
      setInfo(`Accepted ${selected.todoist_task_id}`);
      await loadQueue({ nextSelectedId: nextRow ? nextRow.todoist_task_id : null });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'accept failed');
    } finally {
      setBusy(false);
    }
  }

  async function runOverride() {
    if (!selected) return;
    const normalizedTitle = editTitle.trim();
    if (!normalizedTitle) {
      setError('normalized_title_en is required for override');
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await todoistReviewOverride({
        todoist_task_id: selected.todoist_task_id,
        normalized_title_en: normalizedTitle,
        task_shape: editShape,
        suggested_next_action: editNextAction.trim() || null,
      });
      setInfo(`Overrode ${selected.todoist_task_id}`);
      await loadQueue({ nextSelectedId: selected.todoist_task_id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'override failed');
    } finally {
      setBusy(false);
    }
  }

  async function runReparse() {
    if (!selected) return;

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const out = await todoistReviewReparse(selected.todoist_task_id);
      setSelected(out.task);
      setEvents(out.events);
      syncEditor(out.task);
      setInfo(`Re-ran parse for ${selected.todoist_task_id}`);
      await loadQueue({ nextSelectedId: selected.todoist_task_id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'reparse failed');
    } finally {
      setBusy(false);
    }
  }

  async function nextItem() {
    if (!rows.length) return;
    const nextRow = selectedIndex >= 0 && selectedIndex + 1 < rows.length
      ? rows[selectedIndex + 1]
      : rows[0];
    await selectTask(nextRow.todoist_task_id);
  }

  async function copySelectedAsJson() {
    if (!selected) return;
    setError(null);
    setInfo(null);
    try {
      const json = buildSelectedTaskJson(selected, events);
      await navigator.clipboard.writeText(json);
      setInfo(`Copied JSON for ${selected.todoist_task_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'copy to clipboard failed');
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
        <h1 className="text-lg font-semibold text-slate-100">Todoist Review</h1>
        <p className="mt-1 text-sm text-slate-400">Review Todoist normalization and apply accept/override/reparse actions.</p>

        <div className="mt-4 flex flex-wrap gap-2">
          {VIEW_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setInfo(null);
                setView(option.value);
              }}
              className={`rounded border px-3 py-2 text-xs ${
                view === option.value
                  ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                  : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-[100px_auto_auto_auto_auto]">
          <input
            value={limitInput}
            onChange={(event) => setLimitInput(event.target.value)}
            inputMode="numeric"
            placeholder="limit"
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 placeholder:text-slate-500 focus:ring"
          />
          <button
            type="button"
            className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            onClick={() => { void loadQueue(); }}
            disabled={busy}
          >
            Refresh
          </button>
          <button
            type="button"
            className="rounded border border-emerald-600 bg-emerald-600/15 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-600/25 disabled:opacity-50"
            onClick={() => { void runAccept(); }}
            disabled={busy || !selected}
          >
            Accept
          </button>
          <button
            type="button"
            className="rounded border border-indigo-600 bg-indigo-600/15 px-3 py-2 text-sm text-indigo-300 hover:bg-indigo-600/25 disabled:opacity-50"
            onClick={() => { void runOverride(); }}
            disabled={busy || !selected}
          >
            Override
          </button>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded border border-amber-600 bg-amber-600/15 px-3 py-2 text-sm text-amber-300 hover:bg-amber-600/25 disabled:opacity-50"
              onClick={() => { void runReparse(); }}
              disabled={busy || !selected}
            >
              Re-run Parse
            </button>
            <button
              type="button"
              className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              onClick={() => { void nextItem(); }}
              disabled={busy || rows.length === 0}
            >
              Next Item
            </button>
            <button
              type="button"
              className="rounded border border-sky-600 bg-sky-600/15 px-3 py-2 text-sm text-sky-300 hover:bg-sky-600/25 disabled:opacity-50"
              onClick={() => { void copySelectedAsJson(); }}
              disabled={busy || !selected}
            >
              Copy JSON
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded border border-rose-700/50 bg-rose-900/20 px-3 py-2 text-sm text-rose-300">
            {error}
          </div>
        )}

        {info && (
          <div className="mt-3 rounded border border-emerald-700/50 bg-emerald-900/20 px-3 py-2 text-sm text-emerald-300">
            {info}
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <section className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
          <h2 className="text-sm font-semibold text-slate-100">Queue ({rows.length})</h2>

          {rows.length === 0 && (
            <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-6 text-sm text-slate-400">
              No rows in this view.
            </div>
          )}

          <div className="max-h-[68vh] space-y-2 overflow-y-auto pr-1">
            {rows.map((row) => {
              const isSelected = selected?.todoist_task_id === row.todoist_task_id;
              return (
                <button
                  key={row.todoist_task_id}
                  type="button"
                  onClick={() => { void selectTask(row.todoist_task_id); }}
                  className={`w-full rounded border p-3 text-left ${
                    isSelected
                      ? 'border-sky-500 bg-sky-500/10'
                      : 'border-slate-800 bg-slate-950/40 hover:bg-slate-900/70'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-slate-100">{taskTitle(row)}</div>
                    <span className={`rounded border px-2 py-0.5 text-[11px] ${badgeClass(row.review_status)}`}>
                      {row.review_status || 'unknown'}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-300">{projectMeta(row)}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    confidence: {confidencePct(row.parse_confidence)} | shape: {row.task_shape || '-'}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
          <h2 className="text-sm font-semibold text-slate-100">Selected Item</h2>

          {!selected && (
            <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-6 text-sm text-slate-400">
              Select a queue item to inspect and edit.
            </div>
          )}

          {selected && (
            <>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-300">
                  <div>todoist_task_id: {selected.todoist_task_id}</div>
                  <div>project/section: {projectMeta(selected)}</div>
                  <div>lifecycle: {selected.lifecycle_status || '-'}</div>
                  <div>priority: {selected.todoist_priority}</div>
                  <div>due: {selected.todoist_due_date || '-'}</div>
                </div>
                <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-300">
                  <div>review_status: {selected.review_status || '-'}</div>
                  <div>review_reasons: {(selected.review_reasons || []).join(', ') || '-'}</div>
                  <div>first_seen: {fmtTs(selected.first_seen_at)}</div>
                  <div>last_seen: {fmtTs(selected.last_seen_at)}</div>
                  <div>parsed_at: {fmtTs(selected.parsed_at)}</div>
                </div>
              </div>

              <div className="space-y-2 rounded border border-slate-800 bg-slate-950/40 p-3">
                <div className="text-xs text-slate-300">raw_title</div>
                <div className="text-sm text-slate-100">{selected.raw_title || '-'}</div>
                <div className="text-xs text-slate-300">raw_description</div>
                <div className="whitespace-pre-wrap text-xs text-slate-300">{selected.raw_description || '-'}</div>
              </div>

              <div className="space-y-2 rounded border border-slate-800 bg-slate-950/40 p-3">
                <div className="text-xs text-slate-300">normalized_title_en</div>
                <input
                  value={editTitle}
                  onChange={(event) => setEditTitle(event.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 placeholder:text-slate-500 focus:ring"
                />

                <div className="text-xs text-slate-300">task_shape</div>
                <select
                  value={editShape}
                  onChange={(event) => setEditShape(event.target.value as TodoistTaskShape)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 focus:ring"
                >
                  {TASK_SHAPES.map((shape) => (
                    <option key={shape} value={shape}>{shape}</option>
                  ))}
                </select>

                <div className="text-xs text-slate-300">suggested_next_action</div>
                <textarea
                  value={editNextAction}
                  onChange={(event) => setEditNextAction(event.target.value)}
                  rows={3}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 placeholder:text-slate-500 focus:ring"
                />
              </div>

              <div className="space-y-2 rounded border border-slate-800 bg-slate-950/40 p-3">
                <div className="text-xs font-semibold text-slate-200">Event History ({events.length})</div>
                {events.length === 0 && (
                  <div className="text-xs text-slate-400">No events loaded for this item.</div>
                )}
                <div className="max-h-[40vh] space-y-2 overflow-y-auto pr-1">
                  {events.map((event) => (
                    <article key={`${event.id}-${event.event_at || ''}`} className="rounded border border-slate-800 bg-slate-950 p-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-300">
                        <span className="rounded border border-slate-700 px-1.5 py-0.5">{event.event_type}</span>
                        <span>{fmtTs(event.event_at)}</span>
                        <span>fields: {event.changed_fields.join(', ') || '-'}</span>
                      </div>
                      {event.reason && (
                        <div className="mt-1 text-xs text-slate-400">reason: {event.reason}</div>
                      )}
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-slate-300">before / after</summary>
                        <div className="mt-1 grid gap-2 md:grid-cols-2">
                          <pre className="overflow-auto rounded border border-slate-800 bg-slate-950 p-2 text-[11px] text-slate-300">{toPretty(event.before_json)}</pre>
                          <pre className="overflow-auto rounded border border-slate-800 bg-slate-950 p-2 text-[11px] text-slate-300">{toPretty(event.after_json)}</pre>
                        </div>
                      </details>
                    </article>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
