import { useMemo, useState } from 'react';
import { EntryStandardCard } from '../components/EntryStandardCard';
import { createUiRunId } from '../lib/runId';
import {
  patchTopicState,
  readWorkingMemory,
  type TopicPatchRequest,
  type WorkingMemoryEnvelope,
} from '../lib/workingMemoryApi';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

type TopicQuestion = {
  key: string;
  text: string;
  status: 'open' | 'closed';
};

type TopicAction = {
  key: string;
  text: string;
  status: 'open' | 'done';
};

function toQuestionList(value: unknown): TopicQuestion[] {
  const rows = asArray(value);
  return rows
    .map((row, index) => {
      const rec = asRecord(row);
      const key = String(rec.question_key || rec.id || `q-${index + 1}`).trim();
      const text = String(rec.question_text || rec.text || '').trim();
      const status = String(rec.status || 'open').toLowerCase() === 'closed' ? 'closed' : 'open';
      if (!key || !text) return null;
      return { key, text, status };
    })
    .filter((row): row is TopicQuestion => !!row);
}

function toActionList(value: unknown): TopicAction[] {
  const rows = asArray(value);
  return rows
    .map((row, index) => {
      const rec = asRecord(row);
      const key = String(rec.action_key || rec.id || `a-${index + 1}`).trim();
      const text = String(rec.action_text || rec.text || '').trim();
      const status = String(rec.status || 'open').toLowerCase() === 'done' ? 'done' : 'open';
      if (!key || !text) return null;
      return { key, text, status };
    })
    .filter((row): row is TopicAction => !!row);
}

function detectFound(payload: WorkingMemoryEnvelope): boolean {
  const result = asRecord(payload.result);
  const meta = asRecord(result.meta);
  if (Object.prototype.hasOwnProperty.call(meta, 'found')) {
    return Boolean(meta.found);
  }
  const row = asRecord(result.row);
  if (Object.prototype.hasOwnProperty.call(row, 'found')) {
    return Boolean(row.found);
  }
  return !!result.row;
}

export function WorkingMemoryPage() {
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [patchBusy, setPatchBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);
  const [lastRunId, setLastRunId] = useState('');
  const [payload, setPayload] = useState<WorkingMemoryEnvelope | null>(null);
  const [questionEdits, setQuestionEdits] = useState<Record<string, string>>({});
  const [actionEdits, setActionEdits] = useState<Record<string, string>>({});
  const [newQuestionText, setNewQuestionText] = useState('');
  const [newActionText, setNewActionText] = useState('');

  const found = useMemo(() => (payload ? detectFound(payload) : false), [payload]);
  const row = useMemo(() => {
    if (!payload) return null;
    const result = asRecord(payload.result);
    const value = result.row;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }, [payload]);

  const topicStateDebug = useMemo(() => {
    if (!payload) return null;
    const result = asRecord(payload.result);
    const debug = asRecord(result.debug);
    const topicState = debug.topic_state;
    if (!topicState || typeof topicState !== 'object' || Array.isArray(topicState)) return null;
    return topicState as Record<string, unknown>;
  }, [payload]);

  const topicStateSummary = useMemo(() => {
    if (!topicStateDebug) return null;
    const state = asRecord(topicStateDebug.state);
    const openQuestions = asArray(topicStateDebug.open_questions);
    const actionItems = asArray(topicStateDebug.action_items);
    const relatedEntries = asArray(topicStateDebug.related_entries);
    return {
      stateVersion: Number(state.state_version || 0) || null,
      openQuestions: openQuestions.length,
      actionItems: actionItems.length,
      relatedEntries: relatedEntries.length,
      lastSessionId: String(state.last_session_id || '').trim() || null,
    };
  }, [topicStateDebug]);

  const openQuestions = useMemo(() => (
    topicStateDebug ? toQuestionList(topicStateDebug.open_questions) : []
  ), [topicStateDebug]);

  const actionItems = useMemo(() => (
    topicStateDebug ? toActionList(topicStateDebug.action_items) : []
  ), [topicStateDebug]);

  const loadWorkingMemory = async (forcedTopic?: string) => {
    const inputTopic = String(forcedTopic ?? topic).trim();
    if (!inputTopic) return;
    setBusy(true);
    setError(null);

    const runId = createUiRunId('ui-working-memory');
    try {
      const out = await readWorkingMemory(inputTopic, { runId, view: 'debug' });
      setPayload(out.payload);
      setLastRunId(out.run_id || runId);
      setQuestionEdits({});
      setActionEdits({});
    } catch (err) {
      setPayload(null);
      setLastRunId(runId);
      setError(err instanceof Error ? err.message : 'working memory read failed');
    } finally {
      setBusy(false);
    }
  };

  const applyPatch = async (topicPatch: TopicPatchRequest) => {
    const inputTopic = topic.trim();
    if (!inputTopic) return;
    setPatchBusy(true);
    setPatchError(null);
    const runId = createUiRunId('ui-topic-patch');
    try {
      await patchTopicState(inputTopic, topicPatch, { runId });
      const refreshed = await readWorkingMemory(inputTopic, {
        runId: createUiRunId('ui-working-memory'),
        view: 'debug',
      });
      setPayload(refreshed.payload);
      setLastRunId(refreshed.run_id || runId);
      setQuestionEdits({});
      setActionEdits({});
    } catch (err) {
      setPatchError(err instanceof Error ? err.message : 'topic patch failed');
    } finally {
      setPatchBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
        <h1 className="text-lg font-semibold text-slate-100">Working Memory</h1>
        <p className="mt-1 text-sm text-slate-400">
          Load topic-keyed working memory using the same backend route used by Telegram/ChatGPT flows.
        </p>

        <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
          <input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="topic (required)"
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 placeholder:text-slate-500 focus:ring"
          />
          <button
            type="button"
            className="rounded border border-emerald-500 bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
            onClick={() => { void loadWorkingMemory(); }}
            disabled={busy || patchBusy || !topic.trim()}
          >
            {busy ? 'Loading...' : 'Load Working Memory'}
          </button>
        </div>

        {(payload || lastRunId) && (
          <div className="mt-3 text-xs text-slate-400">
            <span className="mr-3">run_id: {lastRunId || '-'}</span>
            <span className="mr-3">outcome: {payload?.outcome || '-'}</span>
            <span>found: {payload ? (found ? 'true' : 'false') : '-'}</span>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded border border-rose-700/50 bg-rose-900/20 px-3 py-2 text-sm text-rose-300">
            {error}
          </div>
        )}
        {patchError && (
          <div className="mt-3 rounded border border-rose-700/50 bg-rose-900/20 px-3 py-2 text-sm text-rose-300">
            {patchError}
          </div>
        )}
      </section>

      {!payload && !error && (
        <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
          <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-6 text-sm text-slate-400">
            Load a topic to inspect current working memory.
          </div>
        </section>
      )}

      {payload && !row && (
        <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
          <div className="rounded border border-amber-700/50 bg-amber-900/20 px-3 py-3 text-sm text-amber-300">
            No working memory row found for this topic.
          </div>
          <details className="mt-3 rounded border border-slate-800 bg-slate-950/60">
            <summary className="cursor-pointer px-2 py-1 text-xs text-slate-300">Full JSON payload</summary>
            <pre className="max-h-64 overflow-auto border-t border-slate-800 p-2 text-[11px] text-slate-300">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </details>
        </section>
      )}

      {payload && row && (
        <section className="space-y-4">
          {topicStateSummary && (
            <div className="rounded-xl border border-sky-800/50 bg-sky-950/30 p-4 text-sm text-sky-100 shadow-glow">
              <div className="font-semibold">Topic State Debug</div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div>state_version: {topicStateSummary.stateVersion ?? '-'}</div>
                <div>last_session_id: {topicStateSummary.lastSessionId ?? '-'}</div>
                <div>open_questions: {topicStateSummary.openQuestions}</div>
                <div>action_items: {topicStateSummary.actionItems}</div>
                <div>related_entries: {topicStateSummary.relatedEntries}</div>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
            <div className="text-sm font-semibold text-slate-100">Open Questions</div>
            <div className="mt-3 space-y-2">
              {openQuestions.map((item) => {
                const editValue = questionEdits[item.key] ?? item.text;
                return (
                  <div key={item.key} className="rounded border border-slate-800 bg-slate-950/60 p-2">
                    <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                      <span>{item.key}</span>
                      <span>status: {item.status}</span>
                    </div>
                    <input
                      value={editValue}
                      onChange={(event) => setQuestionEdits((prev) => ({ ...prev, [item.key]: event.target.value }))}
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 outline-none focus:ring focus:ring-sky-500"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded border border-sky-700 px-2 py-1 text-xs text-sky-300 hover:bg-sky-900/40 disabled:opacity-50"
                        disabled={patchBusy || !editValue.trim() || editValue.trim() === item.text}
                        onClick={() => {
                          void applyPatch({
                            open_questions: {
                              upsert: [{ id: item.key, text: editValue.trim(), status: item.status }],
                            },
                          });
                        }}
                      >
                        Save Text
                      </button>
                      {item.status === 'open' ? (
                        <button
                          type="button"
                          className="rounded border border-amber-700 px-2 py-1 text-xs text-amber-300 hover:bg-amber-900/40 disabled:opacity-50"
                          disabled={patchBusy}
                          onClick={() => {
                            void applyPatch({ open_questions: { close: [item.key] } });
                          }}
                        >
                          Close
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="rounded border border-emerald-700 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-50"
                          disabled={patchBusy}
                          onClick={() => {
                            void applyPatch({ open_questions: { reopen: [item.key] } });
                          }}
                        >
                          Reopen
                        </button>
                      )}
                      <button
                        type="button"
                        className="rounded border border-rose-700 px-2 py-1 text-xs text-rose-300 hover:bg-rose-900/40 disabled:opacity-50"
                        disabled={patchBusy}
                        onClick={() => {
                          void applyPatch({ open_questions: { delete: [item.key] } });
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
              <div className="rounded border border-slate-800 bg-slate-950/40 p-2">
                <div className="mb-1 text-xs text-slate-400">Add Open Question</div>
                <div className="flex gap-2">
                  <input
                    value={newQuestionText}
                    onChange={(event) => setNewQuestionText(event.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 outline-none focus:ring focus:ring-sky-500"
                    placeholder="Question text"
                  />
                  <button
                    type="button"
                    className="rounded border border-emerald-700 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-50"
                    disabled={patchBusy || !newQuestionText.trim()}
                    onClick={() => {
                      const text = newQuestionText.trim();
                      if (!text) return;
                      setNewQuestionText('');
                      void applyPatch({
                        open_questions: {
                          upsert: [{ text, status: 'open' }],
                        },
                      });
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
            <div className="text-sm font-semibold text-slate-100">Action Items</div>
            <div className="mt-3 space-y-2">
              {actionItems.map((item) => {
                const editValue = actionEdits[item.key] ?? item.text;
                return (
                  <div key={item.key} className="rounded border border-slate-800 bg-slate-950/60 p-2">
                    <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                      <span>{item.key}</span>
                      <span>status: {item.status}</span>
                    </div>
                    <input
                      value={editValue}
                      onChange={(event) => setActionEdits((prev) => ({ ...prev, [item.key]: event.target.value }))}
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 outline-none focus:ring focus:ring-sky-500"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded border border-sky-700 px-2 py-1 text-xs text-sky-300 hover:bg-sky-900/40 disabled:opacity-50"
                        disabled={patchBusy || !editValue.trim() || editValue.trim() === item.text}
                        onClick={() => {
                          void applyPatch({
                            action_items: {
                              upsert: [{ id: item.key, text: editValue.trim(), status: item.status }],
                            },
                          });
                        }}
                      >
                        Save Text
                      </button>
                      {item.status === 'open' ? (
                        <button
                          type="button"
                          className="rounded border border-amber-700 px-2 py-1 text-xs text-amber-300 hover:bg-amber-900/40 disabled:opacity-50"
                          disabled={patchBusy}
                          onClick={() => {
                            void applyPatch({ action_items: { done: [item.key] } });
                          }}
                        >
                          Done
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="rounded border border-emerald-700 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-50"
                          disabled={patchBusy}
                          onClick={() => {
                            void applyPatch({ action_items: { reopen: [item.key] } });
                          }}
                        >
                          Reopen
                        </button>
                      )}
                      <button
                        type="button"
                        className="rounded border border-rose-700 px-2 py-1 text-xs text-rose-300 hover:bg-rose-900/40 disabled:opacity-50"
                        disabled={patchBusy}
                        onClick={() => {
                          void applyPatch({ action_items: { delete: [item.key] } });
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
              <div className="rounded border border-slate-800 bg-slate-950/40 p-2">
                <div className="mb-1 text-xs text-slate-400">Add Action Item</div>
                <div className="flex gap-2">
                  <input
                    value={newActionText}
                    onChange={(event) => setNewActionText(event.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 outline-none focus:ring focus:ring-sky-500"
                    placeholder="Action item text"
                  />
                  <button
                    type="button"
                    className="rounded border border-emerald-700 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-50"
                    disabled={patchBusy || !newActionText.trim()}
                    onClick={() => {
                      const text = newActionText.trim();
                      if (!text) return;
                      setNewActionText('');
                      void applyPatch({
                        action_items: {
                          upsert: [{ text, status: 'open' }],
                        },
                      });
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>

          <EntryStandardCard
            title="Working Memory Entry"
            payload={{ ...row, found }}
            fullPayload={payload}
          />
        </section>
      )}
    </div>
  );
}
