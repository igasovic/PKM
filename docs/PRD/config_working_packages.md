# Work Packages — Configuration Sync

Status: active companion  
Companion to: `docs/PRD/config-PRD.md`  
Last verified: 2026-03-30

## Current implementation snapshot
Implemented today:
- command interface:
  - `scripts/cfg/checkcfg`
  - `scripts/cfg/updatecfg`
  - `scripts/cfg/importcfg`
  - `scripts/cfg/bootstrapcfg`
- active surfaces:
  - `n8n`
  - `docker`
  - `litellm`
  - `postgres`
  - `backend`
- bootstrap defaults:
  - `docker litellm postgres n8n`
- `backend` push deploy path:
  - `scripts/cfg/backend_push.sh`

Explicitly out of the active work-package set now:
- `cloudflared`
  - planned repo-managed move never happened
  - current runtime is token-based compose state, not an active repo-managed config surface

## WP1 — Command interface
Goal:
- keep one operator interface: `checkcfg <surface>` and `updatecfg <surface> --push|--pull`

Deliverables:
- shared surface registry/adapters
- clear per-surface compare/apply output
- single-surface enforcement

## WP2 — Agent handoff contract
Goal:
- keep config-related operator actions mandatory in agent output

Deliverables:
- `AGENTS.md` handoff requirement
- examples for no-op and multi-surface handoff

## WP3 — n8n surface adapter
Goal:
- keep `n8n` compare/apply aligned with the repo sync tooling and package-manifest workflow

Acceptance:
- one-shot export reuse for compare
- push and pull remain available

## WP4 — docker surface adapter
Goal:
- keep compose/env projection explicit and service-targeted when possible

Acceptance:
- drift reporting includes affected services when resolvable
- push falls back to full compose apply only when scope is ambiguous

## WP5 — litellm surface adapter
Goal:
- keep LiteLLM config projection and restart behavior explicit

Acceptance:
- compare/apply scope is limited to LiteLLM config
- restart behavior is called out clearly

## WP6 — postgres surface adapter
Goal:
- keep init/config projection separate from live data ownership

Acceptance:
- compare/apply never touches live DB data
- restart/reload implications remain explicit

## WP7 — backend surface adapter
Goal:
- keep backend-only deploy behavior reviewable while backend remains an active surface

Acceptance:
- push path stays explicit through `scripts/cfg/backend_push.sh`
- pull remains intentionally blocked unless a future design changes the ownership model

## WP8 — repo layout normalization
Goal:
- keep repo-owned config surfaces and runtime targets easy to discover

Acceptance:
- `docs/config_operations.md`, `docs/env.md`, and surface adapters stay aligned

## WP9 — operational docs
Goal:
- keep one short operator-facing explanation of compare/apply behavior

Acceptance:
- `docs/config_operations.md` remains the authoritative registry and apply playbook

## Remaining review items
- `REVIEW_REQUIRED: if `backend` stops behaving like a config surface and becomes purely a deploy concern, re-scope this companion doc and the canonical PRD together rather than letting the surface drift by convention.`
