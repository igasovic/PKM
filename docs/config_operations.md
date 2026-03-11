# Configuration Operations

## 1. Operator workflow
This is the intended flow:
1. agent changes code and config in repo
2. agent commits and pushes
3. agent tells operator which config surfaces changed
4. operator runs `checkcfg <surface>`
5. operator runs `updatecfg <surface>` for approved surfaces only

## 2. Command semantics
### `checkcfg <surface>`
Compare repo and runtime for one surface only. Output must say:
- clean or drifted
- repo source path(s)
- runtime target path(s) or live object(s)
- exact next command

### `updatecfg <surface>`
Apply repo-authored config to runtime for one surface only. Output must say:
- what changed
- which services were restarted or synced
- whether follow-up verification is recommended

## 3. Surface map
| Surface | Repo source | Runtime target / live target | Update behavior |
|---|---|---|---|
| `n8n` | `src/n8n/workflows/`, `src/n8n/nodes/` | live n8n workflow state + repo mount at `/data` | use n8n sync tooling/API only |
| `docker` | `ops/stack/docker-compose.yml`, `ops/stack/env/*.env` | `/home/igasovic/stack/docker-compose.yml` and stack env files | project files to stack root, then run targeted Docker update |
| `litellm` | `ops/stack/litellm/config.yaml` | `/home/igasovic/stack/litellm/config.yaml` | copy config, restart `litellm` |
| `postgres` | `ops/stack/postgres/init/*`, optional config files | `/home/igasovic/stack/postgres-init/*` and stack config targets | copy files only; never touch live data |
| `cloudflared` | `ops/stack/cloudflared/config.yml` | stack runtime config path for cloudflared | copy config, verify credentials, restart `cloudflared` |
| `backend` | `src/libs/config/`, related backend sources | backend deployment/runtime | backend-only rebuild/restart flow |

## 4. Concrete examples
### Example: n8n
```bash
checkcfg n8n
updatecfg n8n
```
Expected behavior:
- compare repo workflow JSON and externalized code references against live n8n state
- push only n8n changes

### Example: docker
```bash
checkcfg docker
updatecfg docker
```
Expected behavior:
- compare repo Compose/env files with `/home/igasovic/stack`
- project only Docker surface changes
- restart only affected services

### Example: cloudflared
```bash
checkcfg cloudflared
updatecfg cloudflared
```
Expected behavior:
- compare repo local-managed config to runtime file
- verify host-local tunnel credentials exist
- restart only `cloudflared`

## 5. Why there is no auto-apply cron
`updatecfg` is intentionally manual in this phase because config changes may require validation, restart ordering, human review, or secret readiness. A read-only timer may run health checks or `checkcfg` later, but there must not be a blind job that auto-applies repo config to runtime.

## 6. Minimum implementation notes
### `checkcfg`
- should exit non-zero on drift or validation failure only if that behavior is useful in automation
- should support machine-readable output later, but human-readable output is enough for v1

### `updatecfg`
- must fail fast if required runtime prerequisites are missing
- must never copy secrets from repo
- must never operate on more than one surface per invocation

## 7. Living config inventory
Keep this list updated when new surfaces are discovered:
- `/home/igasovic/stack/docker-compose.yml`
- `/home/igasovic/stack/.env` or future secret-only replacement
- `/home/igasovic/stack/postgres/`
- `/home/igasovic/stack/postgres-init/`
- `/home/igasovic/stack/n8n/`
- `/home/igasovic/stack/litellm/config.yaml`
- `src/libs/config.js` or future `src/libs/config/`
- `src/server/**` direct env reads until removed
- `src/n8n/workflows/`
- `src/n8n/nodes/`
- `js/workflows/`
- `scripts/n8n/**`
- `scripts/db/**`
- `pkm.runtime_config`
- shell exports for `N8N_API_*`
- local-managed cloudflared config and host-local credentials JSON
