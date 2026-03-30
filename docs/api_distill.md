# Backend API: Tier-2 Distillation

## Purpose
- define the internal Tier-2 planning, sync, and run contracts
- keep control-plane and execution semantics together for review and rollout work

## Authoritative For
- Tier-2 sync, plan, and run endpoint contracts
- batch execution semantics and normalized failure responses for Tier-2 HTTP APIs

## Not Authoritative For
- Tier-2 table schema details; use `docs/database_schema.md`
- backend env var ownership; use `docs/backend_runtime_env.md`

## Read When
- changing Tier-2 control-plane or execution API behavior
- reviewing planning, enqueue, or normalized failure semantics

## Update When
- Tier-2 sync/plan/run shapes or execution semantics change

## Related Docs
- `docs/api.md`
- `docs/api_ingest.md`
- `docs/database_schema.md`
- `docs/backend_runtime_env.md`

## Endpoint Map

| Endpoint family | Auth | Primary callers | Schema touched | Typical tests |
|---|---|---|---|---|
| Tier-2 sync / plan / run | admin secret | operators, n8n, backend control plane | `entries`, `t2_*` tables | `test/server/tier2.api-contract.test.js`, `test/server/tier2.control-plane.test.js`, `test/server/tier2.status.test.js`, `test/server/tier2.service.test.js` |

## Tier-2 Distillation

### `POST /distill/sync`
Runs Tier‑2 distillation synchronously for one existing entry in production schema (`pkm`) and persists the validated artifact on success.

Headers:
- `x-pkm-admin-secret: <secret>` (required)

Body:
```json
{
  "entry_id": 12345
}
```

Notes:
- This endpoint is sync-only and does not enqueue async batch work.
- It requires existing usable `clean_text` on the target row.
- It applies Tier‑2 route selection (`direct` vs `chunked`) from backend config.
- On validation failure, response returns `status = "failed"` and artifact fields are `null`.
- Final persistence is guarded by currentness (`content_hash` must still match the generated artifact source hash).
  - If source content changed mid-run, response returns `error_code = "currentness_mismatch"` and no write is applied.
- If the row already has a current completed artifact (`distill_status=completed` and matching `distill_created_from_hash`),
  sync failures do not overwrite it; failure response includes `preserved_current_artifact: true`.

Response (success):
```json
{
  "entry_id": 12345,
  "status": "completed",
  "summary": "One-paragraph Tier-2 summary",
  "excerpt": "Optional grounded excerpt",
  "why_it_matters": "Why this should matter later.",
  "stance": "analytical"
}
```

Response (validation or generation failure):
```json
{
  "entry_id": 12345,
  "status": "failed",
  "summary": null,
  "excerpt": null,
  "why_it_matters": null,
  "stance": null,
  "error_code": "excerpt_not_grounded",
  "message": "Optional failure message (present for generation/runtime errors)."
}
```

### `POST /distill/plan`
Runs Tier‑2 control-plane selection for the active schema, persists eligibility outcomes (`skipped` / `not_eligible`) when enabled, and returns the selected workset.

Headers:
- `x-pkm-admin-secret: <secret>` (required)

Body (all fields optional):
```json
{
  "candidate_limit": 250,
  "persist_eligibility": true,
  "include_details": false
}
```

Notes:
- `candidate_limit` must be a positive integer when provided.
- `persist_eligibility` defaults to `true`.
- `include_details=true` runs the second pre-dispatch detail query and returns selected rows projected without `clean_text`.

Response:
```json
{
  "target_schema": "active",
  "candidate_count": 120,
  "decision_counts": {
    "proceed": 42,
    "skipped": 55,
    "not_eligible": 23
  },
  "persisted_eligibility": {
    "updated": 78,
    "groups": [
      { "status": "skipped", "reason_code": "missing_clean_text", "count": 55, "updated": 55 },
      { "status": "not_eligible", "reason_code": "wrong_content_type", "count": 23, "updated": 23 }
    ]
  },
  "selected_count": 25,
  "selected": [
    {
      "id": "00000000-0000-4000-8000-000000000000",
      "entry_id": 12345,
      "route": "direct",
      "chunking_strategy": "direct",
      "priority_score": 74,
      "clean_word_count": 1800,
      "distill_status": "pending",
      "created_at": "2026-03-01T00:00:00.000Z"
    }
  ]
}
```

### `POST /distill/run`
Runs one Tier‑2 batch cycle for production schema (`pkm`): control-plane planning plus async provider-batch enqueue (or planning-only in dry-run mode).

Headers:
- `x-pkm-admin-secret: <secret>` (required)

Body (all fields optional):
```json
{
  "execution_mode": "batch",
  "candidate_limit": 250,
  "max_sync_items": 25,
  "persist_eligibility": true,
  "dry_run": false
}
```

Notes:
- `execution_mode` supports:
  - `batch` (default): standard `/distill/run` execution path.
  - `sync`: explicit synchronous mode (use only when intentionally requested).
- `candidate_limit` and `max_sync_items` must be positive integers when provided.
- `dry_run=true` runs planning only and does not call Tier‑2 generation.
- This endpoint always targets production schema for execution.
- In non-dry-run mode, selected entries are enqueued into LiteLLM batch processing and marked `distill_status = queued` only after successful dispatch.
- Per-entry generation/validation/persistence runs asynchronously during collect cycles; inspect outcomes via `GET /status/batch?stage=t2` and `GET /status/batch/:batch_id?stage=t2`.
- Non-busy responses include `batch_id` for `/status/batch` lookup.
- If a run is requested while the Tier‑2 batch worker loop is already active, the response is:
  - `mode = "skipped"`
  - `reason = "worker_busy"`
  - no batch-history record is written for that skipped call.

Response:
```json
{
  "mode": "run",
  "execution_mode": "batch",
  "target_schema": "pkm",
  "batch_id": "t2_1739420000000_ab12cd",
  "batch_status": "validating",
  "processing_limit": 25,
  "candidate_count": 120,
  "decision_counts": {
    "proceed": 42,
    "skipped": 55,
    "not_eligible": 23
  },
  "persisted_eligibility": {
    "updated": 78,
    "groups": []
  },
  "planned_selected_count": 25,
  "processed_count": 0,
  "completed_count": 0,
  "failed_count": 0,
  "preserved_current_count": 0,
  "error_code_counts": {},
  "results": []
}
```

Notes:
- Batch-mode `processed_count` / `completed_count` / `failed_count` in `/distill/run` are enqueue-cycle counters, not final per-item completion.
- Final per-item outcomes are surfaced through status endpoints and include `error_code`, optional `message`, and `preserved_current_artifact` where applicable.

Response (worker busy):
```json
{
  "mode": "skipped",
  "target_schema": "pkm",
  "skipped": true,
  "reason": "worker_busy",
  "message": "Tier-2 batch worker is busy. Try again shortly."
}
```

Response (runtime failure, normalized):
```json
{
  "mode": "run",
  "execution_mode": "batch",
  "target_schema": "pkm",
  "batch_id": "t2_1739420000000_ab12cd",
  "processing_limit": 25,
  "candidate_count": 0,
  "decision_counts": {
    "proceed": 0,
    "skipped": 0,
    "not_eligible": 0
  },
  "persisted_eligibility": {
    "updated": 0,
    "groups": []
  },
  "planned_selected_count": 0,
  "processed_count": 0,
  "completed_count": 0,
  "failed_count": 1,
  "preserved_current_count": 0,
  "results": [],
  "error": "planner unavailable"
}
```
