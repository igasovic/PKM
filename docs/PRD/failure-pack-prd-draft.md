# PRD Draft — Failure Pack Capture and Retrieval for n8n / PKM

Status: implemented-v1 (2026-03-28)  
Owner: TBD  
Baseline date: 2026-03-28  
Related surfaces: `wf99`, `pkm-server`, `docs/api.md`, `docs/database_schema.md`, `docs/env.md`, debug UI app

---

## 1. Problem

Today, workflow failures are visible in Telegram and raw execution data exists in n8n, but debugging still requires manual digging through n8n execution details and logs. The desired operator experience is:

- identify a failed node and approximate time,
- fetch a normalized failure record,
- inspect the failing node input,
- inspect the immediate parent context without duplicated payloads,
- follow the existing `run_id` into PKM backend trace,
- avoid manual log hunting for normal cases.

The current stack already provides important prerequisites:

- n8n saves executions.
- `run_id` already exists and is propagated.
- PKM already exposes `/debug/run/:run_id` over admin-protected endpoints.
- n8n and PKM already share a writable host-mounted data path (`/home/igasovic/pkm-import`) under `/files` in n8n and `/data` in PKM.

The missing capability is a durable, queryable **failure pack** artifact plus a narrow PKM read surface for agents and operators.

---

## 2. Goal

Add a first-class diagnostics path where:

1. `wf99` captures a normalized failure pack for each failed n8n-orchestrated workflow run.
2. Large payloads are preserved as sidecar artifacts rather than dropped.
3. PKM persists failure-pack metadata and serves retrieval endpoints.
4. Codex or other tools can fetch a failure bundle by `run_id` without directly querying n8n in the normal path.
5. Operators can browse recent failures in the existing debug UI via a new **Failures** page.

---

## 3. Scope boundary

In scope:

- paths orchestrated by n8n,
- `wf99` capture and normalization,
- PKM persistence,
- PKM read endpoints,
- sidecar storage on shared disk,
- debug UI Failures page,
- one persistence model that works for both test and production mode runs.

Out of scope:

- paths that execute outside of n8n orchestration,
- tier 1 / tier 2 workers or other non-n8n-only execution paths,
- making n8n the main query plane for failure investigation,
- broad raw-log search or generalized log ingestion,
- automatic fallback rehydration from n8n when a saved failure pack is insufficient,
- a full observability platform,
- exposing secrets to Codex,
- storing arbitrary heavy telemetry in `pipeline_events`,
- changing the existing `run_id` contract.

---

## 4. Key product decisions

### 4.1 Immediate-parent rule
- “Upstream node” means the **immediate parent node** connected to the failing node.
- If the failing node has multiple direct parents, capture **all direct parents**.

### 4.2 Payload policy
Store:
- full **failing node input**,
- **immediate parent input**,
- sidecar artifacts for large payloads.

Do **not** store immediate parent output by default.

Rationale:
- In a simple straight-through path, immediate parent output is usually redundant with failing node input.
- Immediate parent input gives one step earlier context, which is typically more useful.
- When immediate parent output is materially different, that usually happens because the parent rewrites, merges, aggregates, or otherwise transforms data; those cases remain available for manual investigation in raw execution data when needed.

### 4.3 Large payload policy
- Do not trim meaningful large blobs only because they are large.
- Do not inline every large blob into the main row payload.
- Preserve large JSON/text/binary-like payloads as **sidecar artifacts**.
- The failure pack must contain hashes and relative paths for sidecars.

### 4.4 Redaction policy
Apply default secret redaction to:
- auth headers,
- bearer tokens,
- cookies,
- API keys,
- passwords,
- credential-like fields discovered by allowlist/denylist rules.

Non-secret request/response bodies should be preserved.

### 4.5 Multi-item policy
For v1, store **all items** reaching the failing node and **all items** for the immediate parent input.

### 4.6 Persistence boundary
“PKM failure store” in this PRD means:

- PKM persists normalized failure-pack metadata in its own database.
- PKM serves retrieval endpoints for those records.
- Large sidecar artifacts live on the shared mounted disk path.

This is **not** a separate product or service.

### 4.7 Sidecar writer boundary
- `wf99` writes sidecars first to shared storage.
- `wf99` then posts the normalized envelope to PKM.
- PKM persists metadata only and does not write sidecars on behalf of `wf99`.
- If sidecar writes are unavailable at runtime, `wf99` falls back to inline payloads and marks the stored pack as `partial`.

### 4.8 Test-mode agnostic design
- One table covers both production and test-mode failure packs.
- The stored pack must preserve execution mode in the JSON and projected summary fields.
- There is no separate `pkm_test` failure-pack table.

---

## 5. Why parent output is usually redundant

For a normal one-edge flow, the immediate parent node’s output is usually the same business payload the failing node receives. Differences become important mainly when:

- the parent node combines multiple items,
- the parent has multiple inputs,
- the parent rewrites or synthesizes new items,
- a Code/custom node changes item structure or pairing metadata,
- Merge/Aggregate/Summarize-style behavior creates one downstream item from multiple upstream items.

Because of that, this design stores:

- failing node input,
- immediate parent input,
- parent identity and type,

instead of duplicating immediate parent output in the normal case.

---

## 6. Target operator experience

Primary path:

1. A workflow fails.
2. `wf99` captures failure context and writes sidecar artifacts if needed.
3. `wf99` posts the normalized pack to PKM.
4. PKM stores the pack and exposes it by `run_id` and `failure_id`.
5. Agent calls one PKM read endpoint and gets:
   - failure summary,
   - failure pack,
   - PKM backend trace from existing `/debug/run/:run_id` data,
   - artifact references.
6. Operator can also browse recent failures in the debug UI **Failures** page.

Manual path remains available:
- operator can still inspect the raw n8n execution manually when needed.

---

## 7. Control plane and execution flow

### 7.1 Write path

1. n8n workflow fails.
2. Shared error workflow routes to `wf99`.
3. `wf99` reads the failure event and extracts:
   - `run_id`,
   - `execution_id`,
   - workflow metadata,
   - execution mode,
   - failing node metadata,
   - failing node input,
   - immediate parent node metadata,
   - immediate parent input.
4. `wf99` writes large payloads to sidecar files under shared storage.
5. `wf99` builds normalized JSON envelope.
6. `wf99` `POST`s envelope to PKM admin endpoint.
7. PKM upserts the failure-pack record keyed by `run_id`.

### 7.2 Read path

1. Agent or UI queries PKM by `run_id`, `failure_id`, or recent filters.
2. PKM returns stored failure-pack metadata and JSON.
3. PKM resolves run trace from existing `pipeline_events` using the same `run_id`.
4. PKM returns a merged failure bundle or summary list.

---

## 8. Data model

### 8.1 New shared table: `pkm.failure_packs`

Purpose:
- durable summary + lookup surface for failure artifacts captured from n8n.

Proposed columns:

- `failure_id` uuid PK default `gen_random_uuid()`
- `created_at` timestamptz not null default `now()`
- `updated_at` timestamptz not null default `now()`
- `run_id` text not null unique
- `execution_id` text
- `workflow_id` text
- `workflow_name` text not null
- `mode` text
- `failed_at` timestamptz
- `node_name` text not null
- `node_type` text
- `error_name` text
- `error_message` text
- `status` text not null default `'captured'`
- `has_sidecars` boolean not null default `false`
- `sidecar_root` text
- `pack` jsonb not null

Recommended indexes:

- unique `(run_id)`
- `(failed_at desc)`
- `(workflow_name, failed_at desc)`
- `(node_name, failed_at desc)`
- `(mode, failed_at desc)`
- partial `(failed_at desc) where status = 'captured'`

Notes:
- `pack` is the authoritative stored JSON envelope.
- top-level projected columns exist for fast filtering and summaries.
- one table covers both test and production runs.

### 8.2 Sidecar artifact root

Host root:
- `/home/igasovic/pkm-import/debug/failures/`

Container views:
- n8n writes under `/files/debug/failures/...`
- PKM reads under `/data/debug/failures/...`

Proposed layout:

```text
/home/igasovic/pkm-import/debug/failures/
  YYYY/
    MM/
      DD/
        <run_id>/
          pack-sidecars/
            failing-node-input-item-000.json
            parent-input-node-<slug>-item-000.json
            ...
```

Artifact paths stored in JSON should be **relative** to the shared root, not host-absolute paths.

---

## 9. JSON envelope contract

Canonical schema version:
- `failure-pack.v1`

Proposed shape:

```json
{
  "schema_version": "failure-pack.v1",
  "failure_id": "11111111-1111-4111-8111-111111111111",
  "created_at": "2026-03-28T14:21:11.000-05:00",
  "run_id": "existing-run-id",
  "correlation": {
    "execution_id": "231",
    "workflow_id": "99",
    "workflow_name": "WF 99 Error Capture",
    "execution_url": "https://n8n.gasovic.com/execution/231",
    "mode": "production",
    "retry_of": null
  },
  "failure": {
    "node_name": "Normalize article",
    "node_type": "n8n-nodes-base.httpRequest",
    "error_name": "AxiosError",
    "error_message": "Request failed with status 500",
    "stack": "full stack if available",
    "timestamp": "2026-03-28T14:21:09.000-05:00"
  },
  "graph": {
    "failing_node": "Normalize article",
    "direct_parents": [
      {
        "node_name": "Prepare request",
        "node_type": "n8n-nodes-base.code",
        "branch_index": 0
      }
    ]
  },
  "payloads": {
    "failing_node_input": {
      "item_count": 1,
      "items": [
        {
          "json": {},
          "binary_refs": [],
          "paired_item": null,
          "sidecar_ref": null,
          "sha256": null
        }
      ]
    },
    "upstream_context": {
      "basis": "direct-parent-input",
      "nodes": [
        {
          "node_name": "Prepare request",
          "node_type": "n8n-nodes-base.code",
          "item_count": 1,
          "items": [
            {
              "json_delta": {},
              "duplicate_paths_omitted": [],
              "binary_refs": [],
              "sidecar_ref": null,
              "sha256": null
            }
          ]
        }
      ]
    }
  },
  "artifacts": [
    {
      "kind": "payload-sidecar",
      "relative_path": "debug/failures/2026/03/28/run-123/pack-sidecars/failing-node-input-item-000.json",
      "sha256": "...",
      "content_type": "application/json"
    }
  ],
  "redaction": {
    "applied": true,
    "ruleset_version": "v1"
  }
}
```

### 9.1 Envelope rules

- `run_id` is the stable retrieval key.
- `failure_id` is the stable record key.
- `payloads.failing_node_input` stores full input for the failing node.
- `payloads.upstream_context` stores **immediate parent input**, not output.
- `json_delta` omits fields already present unchanged in failing node input.
- `duplicate_paths_omitted` must make the omission explicit.
- sidecars are allowed for either failing input or parent input.
- binary-like content should never be embedded raw in the main row JSON.
- `failure.stack` is stored in the main JSON, not sidecar-only.

---

## 10. PKM API surface

All failure-pack endpoints are admin-protected.

### 10.1 `POST /debug/failures`

Purpose:
- write or upsert a failure pack from `wf99`.

Headers:
- `x-pkm-admin-secret: <secret>`
- `X-PKM-Run-Id: <run_id>`

Body:
- full `failure-pack.v1` envelope

Behavior:
- validate schema version,
- validate `run_id`,
- upsert by `run_id`,
- project summary columns,
- persist `pack` jsonb,
- return stored identifiers.

Response:

```json
{
  "failure_id": "uuid",
  "run_id": "existing-run-id",
  "status": "captured",
  "upsert_action": "inserted"
}
```

### 10.2 `GET /debug/failures/:failure_id`

Purpose:
- retrieve one stored failure pack.

Response:
- projected summary + full `pack`

### 10.3 `GET /debug/failures/by-run/:run_id`

Purpose:
- retrieve one stored failure pack by `run_id`.

Response:
- projected summary + full `pack`

### 10.4 `GET /debug/failures`

Purpose:
- recent failure search for operator or agent lookup.

Query params:
- `limit` default `20`, max `100`
- `before_ts` optional
- `workflow_name` optional
- `node_name` optional
- `mode` optional

Response:
- summary rows only

### 10.5 `GET /debug/failure-bundle/:run_id`

Purpose:
- one-call diagnostic retrieval for agents.

Behavior:
- load stored failure pack by `run_id`
- load backend run trace via existing pipeline-event lookup
- return merged response

Response:

```json
{
  "run_id": "existing-run-id",
  "failure": {
    "failure_id": "uuid",
    "workflow_name": "10 Read",
    "node_name": "Normalize article",
    "error_message": "Request failed with status 500",
    "failed_at": "2026-03-28T14:21:09.000-05:00"
  },
  "pack": {},
  "run_trace": {
    "rows": []
  }
}
```

---

## 11. Operator UI

Add a new **Failures** page to the existing debug UI app.

Minimum v1 behaviors:
- side-menu entry: `Failures`
- recent failures list backed by `GET /debug/failures`
- filters for `workflow_name`, `node_name`, and `mode`
- click into a failure detail view using `failure_id` or `run_id`
- detail view surfaces:
  - failure summary,
  - stored failure pack,
  - sidecar references,
  - existing PKM run trace

Out of scope for v1 UI:
- editing,
- bulk actions,
- retention management,
- artifact preview beyond basic links/paths.

---

## 12. Security and access model

- Secrets stay off-repo.
- PKM admin secret remains server-side only.
- Codex should never receive `PKM_ADMIN_SECRET` or n8n API credentials directly.
- Failure-pack endpoints are admin-only.
- Sidecar artifact paths are relative and resolved server-side.
- Sidecar reads must not allow path traversal.
- Redaction runs before persistence.

---

## 13. Logging and observability boundary

This feature intentionally creates a **separate diagnostic artifact path** rather than sending heavy payloads into:

- backend application logs,
- `pipeline_events` summaries,
- Braintrust telemetry.

Boundary rule:
- `pipeline_events` remains lightweight transition telemetry.
- Failure packs are durable debug artifacts captured only for failed n8n-orchestrated runs.
- Failure packs may contain large payloads, but only within the dedicated failure-pack store and sidecar path.

This exception is narrow, deliberate, and owned by this PRD.

---

## 14. Retention and cleanup

V1 policy:
- failure-pack DB rows are retained indefinitely,
- sidecar artifacts are retained indefinitely,
- no automated cleanup is required for v1.

Future note:
- cleanup and retention management are a future concern and should be designed later once real storage growth is understood.

---

## 15. Success criteria

A normal failure investigation should require:

- zero raw log digging,
- zero manual n8n execution browsing for first-pass diagnosis,
- one lookup by `run_id` or recent-failure search,
- one response containing failing input, parent context, and PKM trace.

Operational success metrics:

- `>= 95%` of failed n8n-orchestrated runs generate a persisted failure pack,
- `>= 95%` of persisted failure packs are retrievable by `run_id`,
- pack capture does not materially delay alert delivery,
- no secrets are leaked into persisted artifacts.

---

## 16. Risks

- sidecar payloads may grow quickly if failure volume spikes,
- indefinite retention may create storage growth pressure,
- insufficient redaction could leak secrets,
- parent-input deltas may be too lossy for some investigations,
- some failure modes may not provide enough context for `wf99` to assemble a complete pack,
- write path failures in `wf99` could produce Telegram alert without stored pack.

Mitigations:

- schema validation,
- redaction tests,
- partial-pack support with capture-status metadata,
- alert text should state whether failure-pack persistence succeeded,
- storage growth should be observed and cleanup designed later based on real usage.

---

## 17. Open questions / resolved notes

Resolved for v1:

1. Retention window: retain rows and sidecars indefinitely; cleanup is future work.
2. Failure list filtering: workflow-name filter is sufficient; workflow-id filter is not required.
3. `stack` is stored in the main JSON.
4. Sidecar write order: `wf99` writes sidecars first, then PKM persists metadata.
5. Operator UI is in scope now via a Failures page in the existing debug UI.
6. Scope covers n8n-orchestrated paths only.
7. One table covers both test and production modes.
