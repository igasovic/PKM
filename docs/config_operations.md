# Configuration Operations

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
- default surfaces: `docker litellm postgres cloudflared n8n`
- optional `--skip-n8n` to skip n8n import in the same run
- calls `importcfg <surface>` for each selected surface in sequence
- does not support `backend` (no runtime->repo import path)

## 3. Surface registry (authoritative map)

| Surface | Repo source | Runtime target / live target | Class | Attributes | Owner | `checkcfg` | `updatecfg --push` | `updatecfg --pull` |
|---|---|---|---|---|---|---|---|---|
| `n8n` | `src/n8n/workflows/`, `src/n8n/nodes/` | live n8n workflow state | authoritative | versioned, non-secret | n8n | live export+normalize+externalize snapshot compare | `scripts/n8n/sync_workflows.sh --mode push` | `scripts/n8n/sync_workflows.sh --mode pull` |
| `docker` | `ops/stack/docker-compose.yml`, `ops/stack/env/*.env` | `/home/igasovic/stack/docker-compose.yml`, `/home/igasovic/stack/*.env` (managed non-secret env only) | authoritative | versioned, non-secret | infra | file drift compare + affected-service summary | copy managed files + targeted compose apply when scope is known (fallback full apply) | copy managed runtime files to repo |
| `litellm` | `ops/stack/litellm/config.yaml` | `/home/igasovic/stack/litellm/config.yaml` | authoritative | versioned, non-secret | infra | file drift compare | copy config + restart `litellm` | copy runtime config to repo |
| `postgres` | `ops/stack/postgres/init/*`, optional `ops/stack/postgres/postgresql.conf`, `ops/stack/postgres/pg_hba.conf` | `/home/igasovic/stack/postgres-init/*`, optional `/home/igasovic/stack/postgres/*.conf` | authoritative | versioned, non-secret, host-local runtime target | infra/db | dir+file drift compare (excludes live data dir) | copy init/config only; never touches live data | pull init/config only; never touches live data |
| `cloudflared` | `ops/stack/cloudflared/config.yml` | runtime cloudflared config path + host-local credentials JSON | authoritative | versioned config + host-local credential dependency | infra | file drift compare + credentials presence check | copy config + restart `cloudflared` (credentials required) | copy runtime config to repo |
| `backend` | `src/libs/config/`, compatibility entrypoint `src/libs/config.js`, related `src/server/**` config readers | backend deployment/runtime state | authoritative (partial) | versioned code/config | backend | readiness check (`scripts/cfg/backend_push.sh` present + executable) | run `scripts/cfg/backend_push.sh` (targeted `pkm-server` deploy) | blocked (no runtime-to-repo import path) |
| `smoke` | `test/smoke/config/defaults.json` | n8n runtime reads via `/data/test/smoke/config/defaults.json` mount path | authoritative | versioned, non-secret | n8n/smoke harness | blocked (no dedicated adapter yet) | blocked (repo-authored; no operator push step) | blocked |

Notes:
- Secrets and credentials are host-local and never copied from repo.
- Runtime mutable state (`pkm.runtime_config`) is out of `updatecfg` scope.
- Home Assistant/Matter remain out of this config program unless explicitly scoped in.

## 4. Current adapter behavior details

### n8n
- `checkcfg n8n` compares repo workflows/nodes against a fresh live snapshot built with a one-shot export fan-out (single n8n export reused for normalized + raw views).
- `updatecfg n8n --push|--pull` delegates to the same mode in `scripts/n8n/sync_workflows.sh`.

### docker
- `checkcfg docker` compares managed repo Compose/env files to stack runtime files and reports affected services when scope can be resolved.
- `updatecfg docker --push` applies managed files and resolves compose apply scope:
  - if only service-mapped env files changed (for example `pkm-server.env`), applies only those services
  - if compose/global/ambiguous changes are detected, falls back to full `docker compose up -d`
  - if no managed file changed, skips compose apply
- `updatecfg docker --pull` pulls managed runtime files into repo.
- Non-secret service config must be authored in repo-managed `ops/stack/env/<service>.env` files (for example `ops/stack/env/pkm-server.env`), not by ad hoc host `.env` edits.
  - Example calendar policy vars owned in repo: `CALENDAR_TELEGRAM_ENFORCE_ALLOWLIST`, `CALENDAR_TELEGRAM_ALLOWED_USER_IDS`, `CALENDAR_TELEGRAM_PKM_ALLOWED_USER_IDS`.
  - Example Telegram routing var owned in repo: `TELEGRAM_ADMIN_CHAT_ID` (in `ops/stack/env/n8n.env`).

### litellm
- `checkcfg litellm` compares one config file.
- `updatecfg litellm --push` restarts `litellm` after apply.
- `updatecfg litellm --pull` does not restart services.

### postgres
- `checkcfg postgres` compares init/config files only.
- push/pull operate on init/config files only and never DB data.

### cloudflared
- `checkcfg cloudflared` validates config drift and credential-file presence.
- `updatecfg cloudflared --push` requires credentials and restarts `cloudflared`.
- `updatecfg cloudflared --pull` does not restart services.
  - if runtime `config.yml` is missing and compose indicates token-based tunnel mode, pull is treated as no-op import (non-blocking).

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
Keep this list updated whenever a new surface is discovered or ownership changes.

- `/home/igasovic/stack/docker-compose.yml`
- `/home/igasovic/stack/.env` (secret, host-local)
- `/home/igasovic/stack/postgres/`
- `/home/igasovic/stack/postgres-init/`
- `/home/igasovic/stack/n8n/`
- `/home/igasovic/stack/litellm/config.yaml`
- `src/libs/config/` and compatibility entrypoint `src/libs/config.js`
- `src/server/**` direct env reads until removed
- `src/n8n/workflows/`
- `src/n8n/nodes/`
- `scripts/n8n/**`
- `scripts/db/**`
- `pkm.runtime_config` (runtime-mutable DB state)
- shell exports for `N8N_API_*`
- cloudflared local-managed config + host-local credentials JSON
- `test/smoke/config/defaults.json`
