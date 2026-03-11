# Working Packages — Configuration Sync

## Status (2026-03-11)
- WP1 baseline implementation is in repo:
  - `scripts/cfg/checkcfg`
  - `scripts/cfg/updatecfg`
  - `scripts/cfg/lib.sh`
- `updatecfg` now supports direction modes: `--mode push|pull` (default `push`).
- WP8 is partially implemented:
  - `checkcfg backend` readiness checks deploy script prerequisites
  - `updatecfg backend --mode push` runs `scripts/redeploy`
  - `updatecfg backend --mode pull` remains intentionally blocked

## WP1 — Command interface
**Goal:** implement one operator interface: `checkcfg <surface>` and `updatecfg <surface>`.  
**Deliverables:**
- `scripts/cfg/checkcfg`
- `scripts/cfg/updatecfg`
- shared surface registry used by both commands

**Acceptance:**
- unknown surfaces fail clearly
- each command operates on one surface only
- `updatecfg` supports explicit direction via `--mode push|pull`
- output tells the operator what happened and what to do next

**Implementation status:** baseline complete (single-surface enforcement, push/pull modes, clear output, exit codes, shared surface registry).

## WP2 — Agent handoff contract
**Goal:** make config-related operator actions mandatory in agent output.  
**Deliverables:**
- `AGENTS.md` rule requiring a “Config surfaces changed” block
- examples for no-op and multi-surface handoff

**Acceptance:**
- every config-changing implementation task instructs the operator what `checkcfg` and `updatecfg` commands to run

## WP3 — n8n surface adapter
**Goal:** wire `checkcfg n8n` and `updatecfg n8n`.  
**Scope:** compare repo workflows/nodes against live n8n workflow state using current sync tooling; apply via the documented n8n API sync path.  
**Acceptance:**
- `checkcfg n8n` detects drift
- `updatecfg n8n` updates only n8n

## WP4 — docker surface adapter
**Goal:** wire `checkcfg docker` and `updatecfg docker`.  
**Scope:** compare repo Compose and committed non-secret env against `/home/igasovic/stack`; apply only stack file projection and Docker restart steps required for Docker surface changes.  
**Acceptance:**
- `checkcfg docker` shows file drift and affected services
- `updatecfg docker` updates only Docker surface files and restarts only affected services

## WP5 — litellm surface adapter
**Goal:** wire `checkcfg litellm` and `updatecfg litellm`.  
**Scope:** compare repo `ops/stack/litellm/config.yaml` with runtime config file; apply and restart `litellm`.  
**Acceptance:**
- no other services are updated
- output is explicit about restart

## WP6 — postgres surface adapter
**Goal:** wire `checkcfg postgres` and `updatecfg postgres`.  
**Scope:** compare repo init/config files with runtime copies only; exclude live data dir.  
**Acceptance:**
- `updatecfg postgres` never touches live DB data
- restart/reload implications are reported clearly

## WP7 — cloudflared surface adapter
**Goal:** wire `checkcfg cloudflared` and `updatecfg cloudflared`.  
**Scope:** compare repo local-managed config with runtime file; verify host-local credentials presence; apply config and restart `cloudflared`.  
**Acceptance:**
- credentials are never copied from repo
- failure is explicit if credentials are missing

## WP8 — backend surface adapter
**Goal:** decide and implement `checkcfg backend` and `updatecfg backend`.  
**Scope:** compare backend config/code surface state relevant to deployment; apply backend-only restart or rebuild flow.  
**Acceptance:**
- behavior is documented and intentionally separate from Docker surface actions

**Current state:** implemented with readiness-check + push deploy (`scripts/redeploy`); pull/import is intentionally blocked.

## WP9 — repo layout normalization
**Goal:** normalize repo-owned config layout under `ops/stack/` and `src/libs/config/`.  
**Acceptance:**
- every in-scope surface has a clear repo source path and runtime target path

## WP10 — operational docs
**Goal:** document surface registry, compare/apply behavior, and operator commands in `config_operations.md`.  
**Acceptance:**
- operator can follow one short playbook without reading code

## WP11 — importcfg command (planned, no implementation yet)
**Goal:** define future runtime-to-repo import command separate from `updatecfg`.  
**Scope:** document command contract and boundaries only; no script implementation in this package.  
**Acceptance:**
- work package exists and is tracked in PRD/docs
- no production code changes for `importcfg` in this package
