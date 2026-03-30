# PRD — Repository-Managed Configuration Sync

Status: active  
Surface owner: operator config reconciliation workflow  
Scope type: canonical surface  
Last verified: 2026-03-30  
Related authoritative docs: `docs/config_operations.md`, `docs/env.md`, `docs/service_dependancy_graph.md`  
Related work-package doc: `docs/PRD/config-work-packages.md`

## Purpose
Define the repo-first operator workflow for reconciling versioned, non-secret configuration between this repository and the runtime stack.

## Use this PRD when
- changing repo-managed config ownership or operator sync workflow
- changing `checkcfg` / `updatecfg` expectations or active config-surface boundaries
- deciding whether a setting belongs in repo-managed config, host-local state, or runtime-persistent storage

## Fast path by agent
- Coding agent: read `Status and scope boundary`, `Control plane / execution flow`, `Active surfaces`, and `API / operational surfaces`.
- Planning agent: read `Goals`, `Boundaries and callers`, `Active surfaces`, and `Risks / open questions`.
- Reviewing agent: read `Status and scope boundary`, `Active surfaces`, `Validation / acceptance criteria`, and `Risks / open questions`.
- Architect agent: read `Boundaries and callers`, `Active surfaces`, `Config / runtime / topology implications`, and `TBD`.

## Status and scope boundary
This PRD owns:
- the operator interface `checkcfg <surface>` and `updatecfg <surface> --push|--pull`
- the expectation that agents report changed config surfaces explicitly
- the active repo-managed config surfaces:
  - `n8n`
  - `docker`
  - `litellm`
  - `postgres`
  - `backend`
- bootstrap/import workflow through `importcfg` and `bootstrapcfg`

This PRD does not own:
- runtime topology facts themselves
- secrets and host-local credentials
- `pkm.runtime_config` as a mutable feature store
- `cloudflared` as an active repo-managed config surface

## Current behavior / baseline
Current repo behavior is:
- non-secret config is authored in repo first and applied explicitly by the operator
- `checkcfg` compares one surface at a time and reports clean, drifted, or blocked state
- `updatecfg` applies one surface at a time in `push` or `pull` mode
- `importcfg` is a thin alias for `updatecfg <surface> --pull`
- `bootstrapcfg` imports default surfaces `docker litellm postgres n8n`
- `backend` supports push-only deploy through `scripts/cfg/backend_push.sh`
- `cloudflared` currently runs in token-based compose mode and is not part of the active repo-managed config program

## Goals
- keep config changes reviewable, diffable, and rollbackable
- keep the operator handoff explicit and short
- prevent ad hoc host edits from becoming the primary authored source for versioned config
- let agents update repo/docs while operators keep runtime apply control

## Non-goals
- blind cron-based auto-apply
- syncing secrets from git
- forcing every surface into the same low-level apply mechanism
- treating runtime-mutable service state as repo-managed config

## Boundaries and callers
Primary callers:
- agents preparing config changes and operator handoff text
- operator commands under `scripts/cfg/`
- repo docs that define config surface ownership

Boundary rule:
- config behavior and ownership live in `docs/config_operations.md`
- this PRD owns why the config program exists, which surfaces are in scope, and how changes are handed off and sequenced

## Control plane / execution flow
1. agent changes repo-owned config or config-aware code.
2. agent updates any coupled docs/PRDs.
3. agent reports changed config surfaces in the mandatory final-response block.
4. operator runs `checkcfg <surface>`.
5. operator runs `updatecfg <surface> --push|--pull` only for approved surfaces.
6. operator reruns `checkcfg` if needed to verify clean state.

## Active surfaces
| Surface | Purpose | Direction support |
|---|---|---|
| `n8n` | workflow + externalized node reconciliation | push + pull |
| `docker` | compose/env/runtime file projection | push + pull |
| `litellm` | LiteLLM config file projection | push + pull |
| `postgres` | init/config file projection only | push + pull |
| `backend` | backend-only deploy path | push only |

`cloudflared` is intentionally excluded from this table because the planned repo-managed migration never happened and the current runtime uses token-based compose state instead.

## API / operational surfaces
Owned operator commands:
- `scripts/cfg/checkcfg`
- `scripts/cfg/updatecfg`
- `scripts/cfg/importcfg`
- `scripts/cfg/bootstrapcfg`

Coupled docs:
- `docs/config_operations.md`
- `AGENTS.md`
- any PRD that introduces a new config surface or changes ownership

## Config / runtime / topology implications
Relevant runtime targets are documented in `docs/config_operations.md` and `docs/env.md`.

Hard rules for this PRD:
- secrets stay host-local
- runtime-mutable state stays out of repo sync unless a future PRD says otherwise
- new config surfaces must be added to `docs/config_operations.md` in the same change set

## Validation / acceptance criteria
This PRD remains accurate if:
- `checkcfg` and `updatecfg` remain the operator entrypoints
- agents continue to include the mandatory config handoff block when config changes
- active surfaces and bootstrap defaults stay aligned with `docs/config_operations.md` and `scripts/cfg/*`
- `cloudflared` stays out of the active surface registry unless a future change actually implements the repo-managed move

## Risks / open questions
- backend is only partially a config surface and partially a deploy surface
- operators still need to understand the difference between versioned repo config and runtime-mutable state
- `REVIEW_REQUIRED: decide whether `backend` should remain a first-class config surface long-term or move to a pure deploy/runbook surface. The current implementation is deliberate, but the ownership line is still softer than the other surfaces.`

## TBD
- whether a read-only periodic `checkcfg` automation should exist later
- whether backend should ever support a runtime-to-repo import path
