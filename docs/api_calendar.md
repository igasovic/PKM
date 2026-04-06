# Backend API: Calendar

## Purpose
- define the internal calendar routing, normalization, finalize, and observation contracts
- keep the calendar business-log and orchestration surface separate from generic PKM ingest

## Authoritative For
- admin-protected calendar endpoint contracts
- calendar normalization and clarification response shapes

## Not Authoritative For
- public webhook contracts
- Google Calendar external API behavior outside this backend boundary

## Read When
- changing calendar route, normalize, finalize, or observe behavior
- reviewing calendar business-log write semantics

## Update When
- any calendar endpoint shape, auth, or workflow expectation changes

## Related Docs
- `docs/api.md`
- `docs/database_schema.md`
- `docs/service_dependency_graph.md`

## Endpoint Map

| Endpoint family | Auth | Primary callers | Schema touched | Typical tests |
|---|---|---|---|---|
| Calendar route / normalize / finalize / observe | admin secret | n8n calendar workflows | `calendar_requests`, `calendar_event_observations` | `test/server/calendar.api-contract.test.js`, `test/server/calendar-service.test.js`, `test/server/n8n.calendar-router-create.test.js`, `test/server/n8n.calendar-read.test.js` |

## Calendar

All calendar endpoints are admin-protected and require:
- `x-pkm-admin-secret: <secret>`

These endpoints are intended for n8n calendar workflows and do not mutate Google Calendar directly.

### `POST /telegram/route`
Classifies non-command Telegram text into calendar vs PKM routing intents.

Body:
```json
{
  "text": "Mila dentist tomorrow at 3:00p",
  "actor_code": "igor",
  "source": { "chat_id": "1509032341", "message_id": "777", "user_id": "111111111" },
  "run_id": "tg-route-123"
}
```

Response:
```json
{
  "route": "calendar_create",
  "confidence": 0.93,
  "request_id": "9f678f95-8f9f-4f31-8e53-b97f1d9fafe4"
}
```

Possible routes:
- `pkm_capture`
- `calendar_create`
- `calendar_query`
- `ambiguous`

Continuation rule:
- for non-structured text (not starting with `/`, `cal:`, or `pkm:`), router checks latest open calendar clarification request in chat
- if one exists, router forces `calendar_create` and returns the existing `request_id`
- structured inputs are never continuation-overridden

For `ambiguous`, response may include:
- `clarification_question`
- `access_denied_reason` (when route was downgraded by Telegram allowlist policy)

When calendar Telegram allowlist enforcement is enabled, disallowed routes are downgraded to
`ambiguous` with an access clarification message instead of returning `pkm_capture`/calendar routes.

### `POST /calendar/normalize`
Normalizes calendar-create intent and drives clarification flow state.

Behavior:
- uses `request_id` when supplied
- otherwise creates/uses request row keyed by Telegram idempotency key (`tgcal:<chat_id>:<message_id>`)
- continuation without `request_id` is intentionally not inferred here; router endpoint owns continuation selection
- malformed normalize inputs return HTTP `200` with `status: "rejected"` and warning code `normalize_bad_request` so workflow branching can handle user-facing fallback without transport-level failure

Body:
```json
{
  "raw_text": "Mila dentist tomorrow at 3:00p for 60 min at home",
  "actor_code": "igor",
  "source": { "chat_id": "1509032341", "message_id": "777", "user_id": "111111111" },
  "run_id": "cal-norm-123",
  "include_trace": false
}
```

`include_trace`:
- optional boolean
- when `true`, response includes `normalize_trace` (graph metadata for eval/debug)

Response (`needs_clarification`):
```json
{
  "request_id": "f12556d4-c454-4885-a89c-d61dc28db3fd",
  "status": "needs_clarification",
  "missing_fields": ["start_time"],
  "clarification_question": "I can add this, but I still need the start time.",
  "normalized_event": null,
  "warning_codes": [],
  "message": null,
  "request_status": "needs_clarification",
  "normalize_trace": {
    "llm_used": false,
    "llm_reason": "litellm_not_configured",
    "parse_status": "skipped",
    "status": "needs_clarification"
  }
}
```

Response (`ready_to_create`):
```json
{
  "request_id": "f12556d4-c454-4885-a89c-d61dc28db3fd",
  "status": "ready_to_create",
  "missing_fields": [],
  "clarification_question": null,
  "normalized_event": {
    "timezone": "America/Chicago",
    "title": "Mila dentist",
    "date_local": "2026-03-13",
    "start_time_local": "15:00",
    "end_date_local": "2026-03-13",
    "end_time_local": "16:00",
    "duration_minutes": 60,
    "people_codes": ["M"],
    "category_code": "MED",
    "location": "home",
    "subject_code": "[M][MED] 3:00p Mila dentist",
    "color_choice": {
      "logical_color": "purple",
      "google_color_id": "3",
      "telegram_marker": "purple"
    },
    "original_start": { "date_local": "2026-03-13", "time_local": "15:00" },
    "block_window": {
      "start_date_local": "2026-03-13",
      "start_time_local": "15:00",
      "end_date_local": "2026-03-13",
      "end_time_local": "16:00",
      "padded": false,
      "pad_before_minutes": 0,
      "pad_after_minutes": 0
    }
  },
  "warning_codes": [],
  "message": null,
  "request_status": "normalized"
}
```

Response (`rejected`):
```json
{
  "request_id": "f12556d4-c454-4885-a89c-d61dc28db3fd",
  "status": "rejected",
  "reason_code": "all_day_not_supported",
  "missing_fields": [],
  "clarification_question": null,
  "normalized_event": null,
  "warning_codes": [],
  "message": "All-day event creation is not supported in v1. Please provide a start time and duration.",
  "request_status": "ignored"
}
```

`rejected` may also be returned for access policy reasons (for example, sender not in calendar allowlist).
When available, `reason_code` is included to support deterministic branching in workflows/evals.

### `POST /calendar/finalize`
Persists final create outcome after n8n Google Calendar write.

Body:
```json
{
  "request_id": "3243fcdd-e81c-4c94-aa79-d8d8f99bb9dd",
  "success": true,
  "google_calendar_id": "family@group.calendar.google.com",
  "google_event_id": "abc123",
  "run_id": "cal-finalize-123"
}
```

Rules:
- `request_id` is required.
- status is taken from `status` / `final_status`, or mapped from `success`:
  - `success=true` -> `calendar_created`
  - `success=false` -> `calendar_failed`

Response:
```json
{
  "request_id": "3243fcdd-e81c-4c94-aa79-d8d8f99bb9dd",
  "status": "calendar_created",
  "google_calendar_id": "family@group.calendar.google.com",
  "google_event_id": "abc123",
  "finalize_action": "updated"
}
```

If request is missing:
```json
{ "error": "not_found", "message": "request not found" }
```

### `POST /calendar/observe`
Logs externally visible events observed by read/report workflows.

Body:
```json
{
  "run_id": "run-1",
  "items": [
    {
      "google_calendar_id": "family@group.calendar.google.com",
      "google_event_id": "evt-1",
      "observation_kind": "daily_report_seen",
      "source_type": "external_unknown",
      "event_snapshot": { "title": "External event" },
      "resolved_people": ["M"],
      "resolved_color": "purple",
      "was_reported": true
    }
  ]
}
```

Response:
```json
{
  "inserted": 1,
  "rows": [
    {
      "observation_id": "8f31011e-df9a-4ddf-b597-21eb14502b86",
      "run_id": "run-1",
      "google_calendar_id": "family@group.calendar.google.com",
      "google_event_id": "evt-1",
      "observation_kind": "daily_report_seen",
      "source_type": "external_unknown",
      "was_reported": true,
      "created_at": "2026-03-12T12:00:00.000Z"
    }
  ]
}
```
