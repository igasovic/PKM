# Configuration Operations

## Purpose
- define the authoritative config surface registry and operator apply workflow
- keep repo-authored config and runtime-applied state separate
- give agents one place to learn how config changes are reported and applied

## Authoritative For
- config surface ownership
- `checkcfg` / `updatecfg` operator workflow
- classification of repo-authored vs host-local config state

## Not Authoritative For
- service dependency topology; use `docs/service_dependancy_graph.md`
- business behavior requirements; use the relevant contract docs

## Read When
- touching Docker, runtime config, host-side config, env ownership, or apply flow
- reviewing whether a change introduced a new config surface

## Update When
- a new config surface is introduced
- ownership or apply behavior changes
- an existing surface changes class, owner, or target path

## Quick Decisions

| If you are changing... | Read / use |
|---|---|
| repo-authored non-secret config | this doc + `checkcfg` / `updatecfg` flow |
| runtime topology or access paths | `docs/service_dependancy_graph.md`, `docs/env.md` |
| business logic defaults | this doc plus the relevant contract or config-loader docs |

## Reporting Examples

Single-surface handoff:

```text
Config surfaces changed:
- docker

Run:
- checkcfg docker
- updatecfg docker --push
```

Multi-surface handoff:

```text
Config surfaces changed:
- docker
- litellm

Run:
- checkcfg docker
- updatecfg docker --push
- checkcfg litellm
- updatecfg litellm --push
```

## 1. Operator workflow
Rule: all non-secret config is repo-authored first. Host-local edits are for secrets, credentials, runtime-mutable state, and persistent service data only.

1. Agent changes repo-owned config and/or config-aware code.
2. Agent commits and pushes.
3. Agent reports changed surfaces explicitly.
4. Operator runs `checkcfg <surface>` for each reported surface.
5. Operator runs `updatecfg <surface> --push|--pull` only for approved direction/surface pairs.
6. Operator reruns `checkcfg <surface>` to confirm clean state.

## 2. Command interface (implemented)
Commands live under `scripts/cfg/`:
- `scripts/cfg/checkcfg`
- `scripts/cfg/updatecfg`
- `scripts/cfg/importcfg` (runtime->repo alias wrapper)
- `scripts/cfg/bootstrapcfg` (multi-surface bootstrap import helper)
- shared registry/adapters: `scripts/cfg/lib.sh`

Both commands accept exactly one surface and fail clearly for unknown/multi-surface input.

### `checkcfg <surface>`
Compares one repo-authored surface against one runtime/live target surface.

Output always includes:
- `Surface`
- `Status` (`clean`, `drifted`, `blocked`)
- repo source path(s)
- runtime target path(s)
- details
- exact next command

Exit codes:
- `0` clean
- `3` drifted
- `4` blocked (missing prerequisites)
- `2` usage/unknown surface

### `updatecfg <surface> --push|--pull`
Applies one surface in one direction.

Modes (same nomenclature as n8n sync):
- `push`: repo -> runtime (default)
- `pull`: runtime -> repo

Output always includes:
- `Mode`
- changed paths
- restarted/synced services
- details
- exact next command

Exit codes:
- `0` applied/ok
- `4` blocked
- `2` usage/unknown surface/mode

### `importcfg <surface>`
Convenience wrapper for runtime-to-repo import:
- equivalent to `updatecfg <surface> --pull`
- same surface adapters, report format, and exit codes as pull mode

### `bootstrapcfg`
Bootstrap helper for first-time runtime->repo import:
- default surfaces: `docker litellm postgres n8n`
- optional `--skip-n8n` to skip n8n import in the same run
- calls `importcfg <surface>` for each selected surface in sequence
- does not support `backend` (no runtime->repo import path)

## 3. Surface registry (authoritative map)

| Surface | Repo source | Runtime target / live target | Class | Attributes | Owner | `checkcfg` | `updatecfg --push` | `updatecfg --pull` |
|---|---|---|---|---|---|---|---|---|
| `n8n` | `src/n8n/workflows/`, `src/n8n/nodes/`, `src/n8n/package.manifest.json`, `ops/stack/n8n-runners/Dockerfile` | live n8n workflow state + local `pkm-n8n-runners:2.10.3` build definition | authoritative | versioned, non-secret | n8n | build generated runtime package, then compare live export+normalize snapshot + validate live wrapper targets against repo nodes | `scripts/n8n/sync_workflows.sh --mode push` | `scripts/n8n/sync_workflows.sh --mode pull` |
| `docker` | `ops/stack/docker-compose.yml`, `ops/stack/env/*.env`, `ops/stack/n8n-runners/n8n-task-runners.json` | `/home/igasovic/stack/docker-compose.yml`, `/home/igasovic/stack/*.env` (managed non-secret env only), `/home/igasovic/stack/n8n-task-runners.json` | authoritative | versioned, non-secret | infra | file drift compare + affected-service summary | copy managed files + targeted compose apply when scope is known (fallback full apply) | copy managed runtime files to repo |
| `litellm` | `ops/stack/litellm/config.yaml` | `/home/igasovic/stack/litellm/config.yaml` | authoritative | versioned, non-secret | infra | file drift compare | copy config + restart `litellm` | copy runtime config to repo |
| `postgres` | `ops/stack/postgres/init/*`, optional `ops/stack/postgres/postgresql.conf`, `ops/stack/postgres/pg_hba.conf` | `/home/igasovic/stack/postgres-init/*`, optional `/home/igasovic/stack/postgres/*.conf` | authoritative | versioned, non-secret, host-local runtime target | infra/db | dir+file drift compare (excludes live data dir) | copy init/config only; never touches live data | pull init/config only; never touches live data |
| `backend` | `src/libs/config/`, compatibility entrypoint `src/libs/config.js`, `src/server/runtime-env.js`, related config-aware backend modules | backend deployment/runtime state | authoritative (partial) | versioned code/config | backend | readiness check (`scripts/cfg/backend_push.sh` present + executable) | run `scripts/cfg/backend_push.sh` (targeted `pkm-server` deploy) | blocked (no runtime-to-repo import path) |

Notes:
- Secrets and credentials are host-local and never copied from repo.
- Runtime mutable state (`pkm.runtime_config`) is out of `updatecfg` scope.
- Home Assistant/Matter remain out of this config program unless explicitly scoped in.
- `cloudflared` currently runs in token-based compose mode and is not part of the active repo-managed config surface set.
- `test/smoke/config/defaults.json` is repo-owned test input consumed by smoke workflows, but it is not part of the active `checkcfg` / `updatecfg` surface set.

## 4. Current adapter behavior details

### n8n
- `checkcfg n8n` first builds the generated runtime package from `src/n8n/package.manifest.json`, validates live wrapper targets against repo canonical nodes, then compares repo workflows against a fresh live snapshot built with a one-shot export fan-out (single n8n export reused for normalized + raw views).
- `updatecfg n8n --push` builds the generated runtime package, builds the local `pkm-n8n-runners:2.10.3` image from `ops/stack/n8n-runners/Dockerfile`, recreates `n8n` + `n8n-runners`, patches workflows in-place via API, and validates the live workflow export.
- `updatecfg n8n --pull` exports live workflows, normalizes them, and resynchronizes externalized node sources.
- Canonical n8n workflow/node runtime imports are package-based (`@igasovic/n8n-blocks/...`). `/data/src/...` runtime imports are forbidden after the migration.

### docker
- `checkcfg docker` compares managed repo Compose/env files to stack runtime files and reports affected services when scope can be resolved.
- `updatecfg docker --push` applies managed files and resolves compose apply scope:
  - if only service-mapped env files changed (for example `pkm-server.env`), applies only those services
  - if compose/global/ambiguous changes are detected, falls back to full `docker compose up -d`
  - if no managed file changed, skips compose apply
- `updatecfg docker --pull` pulls managed runtime files into repo.
- Non-secret service config must be authored in repo-managed `ops/stack/env/<service>.env` files (for example `ops/stack/env/pkm-server.env`), not by ad hoc host `.env` edits.
  - Example calendar policy vars owned in repo: `CALENDAR_TELEGRAM_ENFORCE_ALLOWLIST`, `CALENDAR_TELEGRAM_ALLOWED_USER_IDS`, `CALENDAR_TELEGRAM_PKM_ALLOWED_USER_IDS`.
  - Example Telegram/n8n runtime vars owned in repo: `TELEGRAM_ADMIN_CHAT_ID`, `N8N_EDITOR_BASE_URL`, `WEBHOOK_URL`, `N8N_PROXY_HOPS`, `NODE_FUNCTION_ALLOW_EXTERNAL`, `NODE_FUNCTION_ALLOW_BUILTIN` (in `ops/stack/env/n8n.env`).
  - Failure-pack sidecar support depends on repo-managed n8n settings:
    - compose mount: `/home/igasovic/pkm-import` -> `/files` (in `ops/stack/docker-compose.yml`)
    - builtin allowlist includes `node:fs` and `node:fs/promises` (in `ops/stack/env/n8n.env`)
  - The `n8n-runners` launcher is additionally configured by repo-managed `ops/stack/n8n-runners/n8n-task-runners.json`, copied to `/home/igasovic/stack/n8n-task-runners.json`, and mounted into the container as `/etc/n8n-task-runners.json`.
  - Current JS allowlist includes both the canonical scoped runtime package and an unscoped compatibility fallback alias: `@igasovic/n8n-blocks,igasovic-n8n-blocks`.

### litellm
- `checkcfg litellm` compares one config file.
- `updatecfg litellm --push` restarts `litellm` after apply.
- `updatecfg litellm --pull` does not restart services.

### postgres
- `checkcfg postgres` compares init/config files only.
- push/pull operate on init/config files only and never DB data.

### backend
- `checkcfg backend` is readiness-only (deploy script check), not runtime parity.
- `updatecfg backend --push` runs `scripts/cfg/backend_push.sh` (optional git pull + targeted compose build/up for `pkm-server` + readiness check).
- `updatecfg backend --pull` is intentionally blocked.

## 5. Not implemented yet
- `updatecfg --full` is not implemented.

## 6. First-time import from Pi
Run this on the Pi host after pulling latest repo changes:

```bash
./scripts/cfg/bootstrapcfg
```

This default run already includes n8n.

If you want to run only n8n import:

```bash
./scripts/cfg/bootstrapcfg --surface n8n
```

If you want to skip n8n in the bootstrap run:

```bash
./scripts/cfg/bootstrapcfg --skip-n8n
```

## 7. Why there is no auto-apply cron
`updatecfg` remains explicit operator action in this phase. Config apply may require validation order, restart sequencing, or secret readiness. Read-only automation may run `checkcfg` later, but blind auto-apply is out of scope.

## 8. Living config inventory
Keep this list updated whenever a new config-adjacent surface is discovered or ownership changes. This inventory is broader than the active `checkcfg` / `updatecfg` registry above.

- `/home/igasovic/stack/docker-compose.yml`
- `/home/igasovic/stack/.env` (secret, host-local)
- `/home/igasovic/stack/postgres/`
- `/home/igasovic/stack/postgres-init/`
- `/home/igasovic/stack/n8n/`
- `/home/igasovic/stack/litellm/config.yaml`
- `src/libs/config/` and compatibility entrypoint `src/libs/config.js`
- `src/server/runtime-env.js` as the approved backend runtime env loader
- `src/server/**` direct env reads until removed
- `src/n8n/workflows/`
- `src/n8n/nodes/`
- `src/n8n/package.manifest.json`
- `scripts/n8n/**`
- `ops/stack/n8n-runners/Dockerfile`
- `ops/stack/n8n-runners/n8n-task-runners.json`
- `scripts/db/**`
- `pkm.runtime_config` (runtime-mutable DB state)
- shell exports for `N8N_API_*`
- `test/smoke/config/defaults.json` (repo-owned smoke input; outside active `checkcfg` / `updatecfg` surfaces)
