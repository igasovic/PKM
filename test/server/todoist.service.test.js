'use strict';

jest.mock('../../src/server/db-pool.js', () => ({
  getPool: jest.fn(),
}));

jest.mock('../../src/server/db/todoist-store.js', () => ({
  listCurrentByTodoistIds: jest.fn(),
  upsertTaskCurrent: jest.fn(),
  insertTaskEvents: jest.fn(),
  closeMissingTasks: jest.fn(),
  listReviewQueue: jest.fn(),
  getTaskByTodoistTaskId: jest.fn(),
  listTaskEvents: jest.fn(),
  updateTaskForReviewAction: jest.fn(),
  listCurrentTasks: jest.fn(),
}));

jest.mock('../../src/server/todoist/normalization.graph.js', () => ({
  runTodoistNormalizationGraphWithTrace: jest.fn(),
}));

const { getPool } = require('../../src/server/db-pool.js');
const todoistStore = require('../../src/server/db/todoist-store.js');
const { runTodoistNormalizationGraphWithTrace } = require('../../src/server/todoist/normalization.graph.js');
const {
  syncTodoistSurface,
  acceptReview,
  evaluateTodoistNormalization,
} = require('../../src/server/todoist/service.js');

describe('todoist service safeguards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('syncTodoistSurface rejects missing tasks payload', async () => {
    await expect(syncTodoistSurface({ run_id: 'run-1' })).rejects.toMatchObject({
      message: 'tasks must be an array',
      statusCode: 400,
    });
    expect(getPool).not.toHaveBeenCalled();
  });

  test('syncTodoistSurface writes close event with prior lifecycle status', async () => {
    const client = {
      query: jest.fn(async () => ({})),
      release: jest.fn(),
    };
    getPool.mockReturnValue({
      connect: jest.fn(async () => client),
    });

    todoistStore.listCurrentByTodoistIds.mockResolvedValue([]);
    todoistStore.closeMissingTasks.mockResolvedValue([{
      id: 7,
      lifecycle_status: 'closed',
      previous_lifecycle_status: 'waiting',
      closed_at: '2026-04-11T10:00:00.000Z',
    }]);
    todoistStore.insertTaskEvents.mockResolvedValue({ rowCount: 1, rows: [] });

    const out = await syncTodoistSurface({ tasks: [] });

    expect(out.closed_count).toBe(1);
    expect(todoistStore.insertTaskEvents).toHaveBeenCalledWith(
      7,
      [expect.objectContaining({
        event_type: 'closed',
        before_json: { lifecycle_status: 'waiting' },
      })],
      { client }
    );
  });

  test('acceptReview event before-state uses persisted review status', async () => {
    todoistStore.getTaskByTodoistTaskId.mockResolvedValue({
      id: 22,
      todoist_task_id: 't2',
      review_status: 'needs_review',
    });
    todoistStore.updateTaskForReviewAction.mockResolvedValue({
      id: 22,
      todoist_task_id: 't2',
      review_status: 'accepted',
    });
    todoistStore.insertTaskEvents.mockResolvedValue({ rowCount: 1, rows: [] });

    await acceptReview({
      todoist_task_id: 't2',
      previous_review_status: 'overridden',
    });

    const insertedEvents = todoistStore.insertTaskEvents.mock.calls[0][1];
    expect(insertedEvents[0].before_json).toEqual({ review_status: 'needs_review' });
  });

  test('evaluateTodoistNormalization does not write todoist tables', async () => {
    runTodoistNormalizationGraphWithTrace.mockResolvedValue({
      result: {
        normalized_title_en: 'Follow up with vendor',
        task_shape: 'follow_up',
        suggested_next_action: 'Send reminder',
        parse_confidence: 0.9,
        parse_failed: false,
        parse_failure_reason: null,
      },
      trace: {
        llm_used: true,
        llm_reason: 'classification_required',
        parse_status: 'ok',
      },
    });

    const out = await evaluateTodoistNormalization({
      raw_title: 'follow up with vendor',
      project_key: 'work',
      lifecycle_status: 'open',
    });

    expect(out).toEqual(expect.objectContaining({
      status: 'ok',
      normalized_task: expect.objectContaining({
        task_shape: 'follow_up',
      }),
      normalize_trace: expect.objectContaining({
        parse_status: 'ok',
      }),
    }));
    expect(getPool).not.toHaveBeenCalled();
    expect(todoistStore.upsertTaskCurrent).not.toHaveBeenCalled();
    expect(todoistStore.insertTaskEvents).not.toHaveBeenCalled();
    expect(todoistStore.updateTaskForReviewAction).not.toHaveBeenCalled();
  });
});
