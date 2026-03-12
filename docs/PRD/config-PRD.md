# PRD — Repository-Managed Configuration Sync

**Status:** In progress (WP1 baseline implemented; updatecfg push/pull implemented; n8n check-path export optimization implemented; WP11 importcfg wrapper implemented; bootstrapcfg helper implemented)  
**Owner:** TBD  
**Baseline date:** 2026-03-10

## 1. Summary
This PRD defines a simple operator workflow for configuration changes across the PKM stack. The repo is the authored source of truth for versioned, non-secret config; runtime locations under `/home/igasovic/stack` and live n8n state are deployment targets. Agents make config changes in the repo, commit them, and must tell the operator exactly which config surfaces require reconciliation. The operator then runs `checkcfg <surface>` to compare repo vs runtime, and `updatecfg <surface>` to apply only that surface.

## 2. Problem
Today config is spread across backend code, n8n, Docker Compose, LiteLLM, cloudflared, Postgres init/config, and host-local files. The missing piece is not just ownership; it is a predictable sync workflow. After an agent lands a change, the operator needs one short list of affected surfaces and one short command per surface. Anything more complex will drift or be skipped.

## 3. Goals
1. Make repo-driven config changes operationally simple.
2. Standardize on `checkcfg <surface>` and `updatecfg <surface>`.
3. Let agents state exactly which surfaces changed and what command the operator must run.
4. Limit each command to one surface at a time.
5. Keep secrets and persistent state out of repo sync.

## 4. Non-goals
1. No blind cron job that auto-applies config.
2. No attempt to sync secrets from Git.
3. No requirement that every surface uses the same low-level mechanism.
4. No Home Assistant or Matter Server work in this phase.

## 5. In-scope surfaces
- `backend` — backend loader-owned config and backend restart/build implications
- `n8n` — workflow JSON and externalized node sync through n8n API
- `docker` — repo Compose and non-secret stack env projected to `/home/igasovic/stack`
- `litellm` — repo LiteLLM config projected to stack runtime path
- `postgres` — repo init/config files projected to stack runtime path
- `cloudflared` — repo local-managed tunnel config projected to stack runtime path

## 6. Source-of-truth model
- **Repo authored source of truth:** versioned, non-secret config.
- **Runtime mirrors:** `/home/igasovic/stack/*` and live n8n workflow state.
- **Host-local only:** secrets, credentials, persistent state, and `pkm.runtime_config` runtime flags.
- **Rule:** `updatecfg <surface> --push` applies repo-authored config to runtime for that surface only.
- **Rule:** `updatecfg <surface> --pull` imports managed runtime config back into repo for that surface.
- **Rule:** `checkcfg <surface>` compares repo-authored config with the current runtime state for that surface only.

## 7. Required operator workflow
### 7.1 Agent workflow
When an agent changes config, it must:
1. commit the repo changes
2. list affected surfaces explicitly
3. tell the operator which commands to run

### 7.2 Required handoff text
Every agent response that changes config must include a block like:

```text
Config surfaces changed:
- n8n
- docker

Run:
- checkcfg n8n
- updatecfg n8n --push
- checkcfg docker
- updatecfg docker --push
```

If no operator action is needed, the agent must say so explicitly.

### 7.3 Operator workflow
1. pull latest repo changes
2. run `checkcfg <surface>` for each reported surface
3. review diff/result
4. run `updatecfg <surface> --push|--pull` for each approved surface/direction
5. rerun `checkcfg <surface>` if needed to confirm clean state

## 8. Command contract
### 8.1 `checkcfg <surface>`
Purpose: compare repo vs runtime for exactly one surface.  
Output must include:
- whether drift exists
- which files or live objects differ
- whether repo is ahead, runtime is ahead, or comparison is mixed
- exact next command

Example:
```bash
checkcfg n8n
checkcfg docker
checkcfg litellm
```

### 8.2 `updatecfg <surface> --push|--pull`
Purpose: apply one-surface reconciliation in a chosen direction.  
Mode semantics:
- `push`: repo -> runtime
- `pull`: runtime -> repo

Behavior by surface:
- `n8n`: delegates to n8n sync script mode
- `docker`: push applies managed Compose/env to stack runtime; pull imports managed runtime files to repo
- `litellm`: push applies + restarts service; pull imports runtime config to repo
- `postgres`: push/pull apply only init/config files; never live data
- `cloudflared`: push applies + restarts service (credentials required); pull imports runtime config to repo
- `backend`: push runs `scripts/cfg/backend_push.sh` (optional git pull + targeted `pkm-server` compose deploy + readiness check); pull is intentionally blocked

Example:
```bash
updatecfg n8n --push
updatecfg n8n --pull
updatecfg docker --push
```

### 8.3 Optional later extensions
Not required in this PRD:
- `checkcfg all`
- `updatecfg all`
- `updatecfg --full`
- `updatecfg <surface> --dry-run`

`importcfg <surface>` is implemented as a convenience wrapper equivalent to `updatecfg <surface> --pull`.
`bootstrapcfg` is implemented as a first-time multi-surface import helper (sequential `importcfg` wrapper).
Current default bootstrap surface set is `docker litellm postgres cloudflared n8n`; `--skip-n8n` opts out.

## 9. Why auto-apply is out of scope
There should not be a cron job that blindly applies repo changes to runtime. Config updates may require validation, restart ordering, human review, or secret readiness. A timer may run `checkcfg` or health checks later, but `updatecfg` remains an explicit operator action in this phase.

## 10. Surface-specific sync rules
### 10.1 n8n
Repo is authoritative for `src/n8n/workflows/` and `src/n8n/nodes/`. Runtime reconciliation uses the n8n API sync path, not direct DB edits. `checkcfg n8n` should minimize runtime cost by exporting live workflows once and reusing that snapshot for both normalized and raw comparison paths.

### 10.2 docker
Repo is authoritative for `ops/stack/docker-compose.yml` and committed non-secret stack env files. Runtime target is `/home/igasovic/stack`.
`updatecfg docker --push` should restart only affected services when changed env files map clearly to compose services, and fall back to full compose apply when scope is ambiguous or compose-level changes are present.

### 10.3 litellm
Repo is authoritative for `ops/stack/litellm/config.yaml`. Runtime target is `/home/igasovic/stack/litellm/config.yaml`.

### 10.4 postgres
Repo is authoritative for init and optional config files under `ops/stack/postgres/`. Live data remains host-local and is never part of `updatecfg postgres`.

### 10.5 cloudflared
Repo is authoritative for local-managed tunnel config under `ops/stack/cloudflared/config.yml`. Credentials JSON remains host-local and is never part of repo sync.

### 10.6 backend
Repo is authoritative for backend config code under `src/libs/config/` (with compatibility entrypoint `src/libs/config.js`) and related backend sources. `updatecfg backend` applies backend-only deployment via `scripts/cfg/backend_push.sh` and must avoid full-stack restarts when backend-only changes are applied.

## 11. Repository organization target
```text
ops/
  stack/
    docker-compose.yml
    env/
      base.env
      pi.env
      secrets.example.env
    litellm/
      config.yaml
    postgres/
      init/
      postgresql.conf
      pg_hba.conf
    cloudflared/
      config.yml
scripts/
  cfg/
    checkcfg
    updatecfg
src/
  libs/
    config/
src/
  n8n/
    workflows/
    nodes/
```

## 12. Acceptance criteria
1. PRD defines `checkcfg <surface>` and `updatecfg <surface>` as the operator interface.
2. `AGENTS.md` requires agents to report affected config surfaces and commands.
3. Each in-scope surface has a documented repo source and runtime target.
4. `config_operations.md` specifies exact behavior for each surface.
5. Working packages exist for command implementation and per-surface adapters.

## 13. TBD
1. Whether `backend` should remain a first-class `updatecfg` surface or stay under normal code deploy commands.
2. Whether `checkcfg all` should be added later.
3. Whether a read-only periodic `checkcfg` timer should be added later.
