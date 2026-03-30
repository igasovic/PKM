# PRD — GPT Actions Integration

Status: active  
Surface owner: public ChatGPT -> n8n webhook boundary  
Scope type: canonical surface  
Last verified: 2026-03-30  
Related authoritative docs: `docs/external_api.md`, `docs/api_control.md`, `docs/service_dependancy_graph.md`, `chatgpt/action_schema.yaml`  
Related work-package doc: `docs/PRD/archive/MCP-transition-work-packages-v2.md`

## Purpose
Keep the public ChatGPT integration boundary narrow, stable, and clearly separated from the internal domain surfaces it calls.

## Status and scope boundary
This PRD owns:
- public ChatGPT-facing webhook endpoints
- the decision that n8n is the only public ChatGPT integration boundary
- webhook request validation and response-envelope normalization in n8n
- workflow responsibilities for `05 ChatGPT Wrap Commit` and `11 ChatGPT Read Router`
- public action schema ownership

This PRD does not own:
- working-memory artifact semantics
- generic read semantics
- backend domain logic behind `/chatgpt/*` or `/db/read/*`
- prompt/instruction content as a PRD surface

## Current behavior / baseline
Current repo behavior is:
- `POST /mcp` is legacy-disabled and returns `410 legacy_disabled`
- public ChatGPT access is through n8n webhooks only
- public webhook endpoints are:
  - `POST /webhook/pkm/chatgpt/read`
  - `POST /webhook/pkm/chatgpt/wrap-commit`
- `05 ChatGPT Wrap Commit` validates public write payloads and calls internal `POST /chatgpt/wrap-commit`
- `11 ChatGPT Read Router` resolves semantic read intent in n8n and calls exactly one internal backend route per request
- public action schema is maintained in `chatgpt/action_schema.yaml`
- working-memory method is available through the public read action, but its internal semantics are owned by `docs/PRD/working-memory-PRD.md`
- read/write action calls emit structured observability tied to action, method, request metadata, outcome, and compact error summaries through the existing backend/n8n logging surfaces

## Goals
- keep the public ChatGPT boundary limited to n8n webhooks
- keep backend generic APIs internal-only
- keep failure states explicit and observable
- preserve a stable public contract even if internal routing evolves

## Non-goals
- reintroducing public MCP as an active integration path
- documenting internal working-memory semantics here
- moving semantic read routing back into ChatGPT prompt logic
- making the GPT Actions PRD the owner of assistant instruction text

## Boundaries and callers
Public caller:
- ChatGPT custom actions using `chatgpt/action_schema.yaml`

Boundary rule:
- ChatGPT chooses semantic intent
- n8n owns public input validation, routing, and response normalization
- backend remains internal and domain PRDs own internal semantics

## Control plane / execution flow
### Public read
1. ChatGPT calls the read webhook.
2. n8n validates the request and resolves the semantic method.
3. n8n calls exactly one internal backend route.
4. n8n builds the public response envelope.
5. ChatGPT receives an explicit `success`, `no_result`, or `failure` outcome.

### Public wrap commit
1. ChatGPT calls the wrap-commit webhook.
2. n8n validates required fields.
3. n8n calls internal `POST /chatgpt/wrap-commit`.
4. n8n returns a normalized public action result.

## API / contract surfaces
Public surface owned here:
- `docs/external_api.md`
- `chatgpt/action_schema.yaml`

Internal routes used by the public workflows:
- `POST /db/read/pull`
- `POST /db/read/last`
- `POST /db/read/continue`
- `POST /db/read/find`
- `POST /chatgpt/working_memory`
- `POST /chatgpt/wrap-commit`

Internal-domain ownership lives in:
- `docs/PRD/read-PRD.md`
- `docs/PRD/working-memory-PRD.md`

## Contract delta table
| Surface | Changes? | Baseline known? | Notes |
|---|---|---|---|
| Internal backend API | no | yes | internal routes remain backend-only |
| Public webhook API | no | yes | owned by `docs/external_api.md` + action schema |
| Database schema | no | yes | no public-boundary schema ownership here |
| Config / infra | no | yes | uses existing n8n/webhook runtime |
| n8n workflows / nodes | no | yes | `05` and `11` are the active public workflows |
| Runtime topology | no | yes | n8n remains the public edge |
| Docs | yes | yes | this PRD is the public-boundary owner |
| Tests | REVIEW_REQUIRED | REVIEW_REQUIRED | see open evidence gaps below |

## Config / runtime / topology implications
Relevant surfaces:
- public webhook ingress through n8n
- action schema consumed by ChatGPT builder
- internal backend admin-secret protected routes

## Historical context
The public MCP -> n8n-first pivot is complete. Historical implementation sequencing lives in:
- `docs/PRD/archive/MCP-transition-work-packages-v2.md`

## Validation / acceptance criteria
This PRD remains accurate if:
- n8n remains the only public ChatGPT integration boundary
- `/mcp` remains disabled for active use
- public read and write flows continue to surface explicit outcomes
- public contract changes update both `docs/external_api.md` and `chatgpt/action_schema.yaml`

## Risks / open questions
- this boundary is easy to overstuff; internal domain behavior should stay in the owning PRDs instead of drifting back here
- silent tool failure remains a release blocker for this surface
- `REVIEW_REQUIRED: a single versioned eval artifact proving the full public read/write matrix was not clearly located during this pass. If you want this PRD to act as a release gate, add or recover one canonical eval report path and link it here.`

## TBD
- whether public read aliases should be narrowed further once action usage stabilizes
