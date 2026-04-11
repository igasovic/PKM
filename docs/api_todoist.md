# Backend API: Todoist Planning

## Purpose
- define internal backend contracts for the Todoist planning surface
- keep sync, review, and brief semantics explicit for n8n workflows and PKM debug UI

## Authoritative For
- `/todoist/*` request and response contracts
- review-queue behavior, manual accept/override/reparse behavior, and brief output shapes

## Not Authoritative For
- Todoist table DDL and grants; use `docs/database_schema.md`
- Telegram webhook router behavior; use `docs/external_api.md` and n8n workflow docs

## Read When
- adding or changing Todoist planning endpoints
- reviewing Todoist review/brief behavior and response shape

## Update When
- any `/todoist/*` endpoint shape changes
- review precedence, manual-action behavior, or brief contracts change

## Related Docs
- `docs/api.md`
- `docs/database_schema.md`
- `docs/PRD/todoist-llm-planning-prd.md`
- `docs/n8n_backend_contract_map.md`

## Endpoint Map

| Endpoint | Auth | Primary callers | Notes |
|---|---|---|---|
| `POST /todoist/sync` | internal | `34 Todoist Sync`, `35/36/37` (via sync call) | upserts current task state + emits lifecycle/parse events |
| `GET /todoist/review` | internal | PKM debug UI `/todoist` | review queue list + optional selected row/events |
| `POST /todoist/review/accept` | internal | PKM debug UI `/todoist` | manual accept of current parsed fields |
| `POST /todoist/review/override` | internal | PKM debug UI `/todoist` | manual override of parsed fields |
| `POST /todoist/review/reparse` | internal | PKM debug UI `/todoist` | re-run parser for one task and recompute review state |
| `POST /todoist/brief/daily` | internal | `35 Todoist Daily Focus` | deterministic shortlist + rationale text |
| `POST /todoist/brief/waiting` | internal | `36 Todoist Waiting Radar`, `10 Read /waiting` | waiting-only deterministic shortlist + rationale text |
| `POST /todoist/brief/weekly` | internal | `37 Todoist Weekly Pruning` | deterministic prune recommendations + rationale text |

## Shared Rules

- Auth pattern: `internal`.
- Todoist planning tables are prod-pinned (`pkm.todoist_task_current`, `pkm.todoist_task_events`).
- `POST /todoist/sync` treats active-fetch disappearance as `closed` and reappearance as `reopened`.
- Brief-selection logic is deterministic; LLM output is rationale text only.

## `POST /todoist/sync`

Sync active Todoist tasks into backend current/event tables.

Request:
```json
{
  "run_id": "n8n-run-123",
  "fetched_at": "2026-04-11T10:05:00.000Z",
  "tasks": [
    {
      "todoist_task_id": "12345",
      "todoist_project_id": "proj-1",
      "todoist_project_name": "work",
      "todoist_section_id": "sec-1",
      "todoist_section_name": "Waiting",
      "raw_title": "follow up with Alex",
      "raw_description": "invoice",
      "todoist_priority": 4,
      "todoist_due_date": "2026-04-11",
      "todoist_due_string": "today",
      "todoist_due_is_recurring": false,
      "project_key": "work",
      "todoist_added_at": "2026-04-10T09:00:00.000Z"
    }
  ]
}
```

Response `200`:
```json
{
  "run_id": "n8n-run-123",
  "synced_count": 1,
  "inserted_count": 1,
  "updated_count": 0,
  "closed_count": 0,
  "parse_trigger_count": 1,
  "parse_failed_count": 0,
  "review_needs_count": 1,
  "accepted_preserved_count": 0,
  "overridden_preserved_count": 0,
  "tasks": [
    {
      "todoist_task_id": "12345",
      "review_status": "needs_review",
      "parse_triggered": true
    }
  ]
}
```

## `GET /todoist/review`

List review rows and optionally return selected-item history.

Query params:
- `view`: `needs_review | unreviewed | accepted | overridden | all`
- `limit` (default `50`, max `200`)
- `offset` (default `0`)
- `todoist_task_id` (optional)
- `events_limit` (default `100`, max `500`)

Response `200`:
```json
{
  "view": "needs_review",
  "limit": 50,
  "offset": 0,
  "rows": [
    {
      "todoist_task_id": "12345",
      "normalized_title_en": "Follow up with Alex",
      "task_shape": "follow_up",
      "review_status": "needs_review"
    }
  ],
  "selected": {
    "todoist_task_id": "12345",
    "review_status": "needs_review"
  },
  "events": [
    {
      "event_type": "parse_updated",
      "reason": "title_changed"
    }
  ]
}
```

## `POST /todoist/review/accept`

Mark the current parsed state as accepted.

Request:
```json
{
  "todoist_task_id": "12345",
  "reason": "manual_accept"
}
```

Response `200`: updated task row.

Response `404`:
```json
{
  "error": "not_found",
  "message": "todoist task not found"
}
```

## `POST /todoist/review/override`

Override parsed fields and mark row as overridden.

Request:
```json
{
  "todoist_task_id": "12345",
  "normalized_title_en": "Follow up with Alex",
  "task_shape": "follow_up",
  "suggested_next_action": "Send reminder email",
  "reason": "manual_override"
}
```

Response `200`: updated task row.

Response `404`: not found.

## `POST /todoist/review/reparse`

Re-run parser for one task and recompute review state.

Request:
```json
{
  "todoist_task_id": "12345",
  "reason": "manual_reparse"
}
```

Response `200`:
```json
{
  "todoist_task_id": "12345",
  "review_status": "needs_review",
  "events": [
    {
      "event_type": "parse_updated",
      "reason": "manual_reparse"
    }
  ]
}
```

Response `404`: not found.

## `POST /todoist/brief/daily`

Build daily focus brief for Telegram delivery.

Request:
```json
{
  "run_id": "n8n-run-123",
  "now": "2026-04-11T10:00:00.000Z",
  "telegram_chat_id": "1509032341"
}
```

Response `200` includes:
- `brief_kind: "daily_focus"`
- `top_3`, `overdue_now`, `waiting_nudges`, `quick_win`
- `summary`
- `telegram_message`

## `POST /todoist/brief/waiting`

Build waiting radar brief for Telegram delivery.

Request shape matches daily brief request.

Response `200` includes:
- `brief_kind: "waiting_radar"`
- `nudges`, `groups`, `summary`
- `telegram_message`

## `POST /todoist/brief/weekly`

Build weekly pruning brief for Telegram delivery.

Request shape matches daily brief request.

Response `200` includes:
- `brief_kind: "weekly_pruning"`
- `suggestions`, `summary`
- `telegram_message`

## Telegram Command Mapping

- `/waiting` -> `36 Todoist Waiting Radar` -> `POST /todoist/brief/waiting`
