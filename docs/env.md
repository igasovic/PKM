# env.md — PKM stack environment (Raspberry Pi)

**Purpose:** quick human review + enough context for agents to safely operate / extend the stack (what runs where, how to connect, what can break, and what not to touch).

**Last verified:** 2026-03-28  
**Host:** `pi` (LAN: `192.168.5.4`)  
**OS:** Debian GNU/Linux 13 (trixie) aarch64 • kernel `6.12.62+rpt-rpi-v8`  
**Docker:** 29.1.4 • **Docker Compose:** v5.0.1

**Related API docs:**
- Internal backend contracts: `docs/api.md`
- Public Custom GPT webhook contracts: `docs/external_api.md`

---

## 0) Quick start (most common ops)

```bash
# SSH in (LAN)
ssh pi

# SSH in (remote)
ssh pi-remote

# stack status
cd /home/igasovic/stack
docker compose ps
docker ps --format 'table {{.Names}}	{{.Image}}	{{.Ports}}	{{.Status}}'

# restart one service
docker compose restart n8n

# tail logs
docker logs -n 200 n8n
```

---

## 1) Access paths

### LAN entrypoints (Pi)
| Service | URL (LAN) | Notes |
|---|---|---|
| PKM server | http://192.168.5.4:3010 | Published on all interfaces |
| LiteLLM | http://192.168.5.4:4000/v1 | Published on all interfaces (auth via master key) |
| Home Assistant | http://192.168.5.4:8123 | Host networking |
| Matter Server UI | http://192.168.5.4:5580 | Host networking |
| n8n (local-only) | http://127.0.0.1:5678 | Bound to loopback on the Pi host |

### SSH access
SSH access is available in three modes:

| Mode | Command | Description |
|---|---|---|
| LAN direct | `ssh pi` | Direct SSH to the Pi over the home network |
| LAN port-forward | `ssh n8n` | SSH plus local port forward for the n8n UI |
| Remote tunnel | `ssh pi-remote` | Remote SSH through Cloudflare Tunnel + Access |

### Mac → Pi SSH configuration (`~/.ssh/config`)
Current config:

```ssh
Host pi
  HostName 192.168.5.4
  User igasovic
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes

Host n8n
  HostName 192.168.5.4
  User igasovic
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
  LocalForward 5680 127.0.0.1:5678

Host pi-remote
  HostName ssh.gasovic.com
  User igasovic
  ProxyCommand cloudflared access ssh --hostname %h
```

Usage:
- `ssh pi` → direct LAN SSH
- `ssh n8n` → forwards `localhost:5680` (Mac) to `127.0.0.1:5678` (Pi)
- `ssh pi-remote` → remote SSH through Cloudflare

Example:
```bash
ssh n8n
# then open on Mac: http://localhost:5680
```

### Public entrypoints (Cloudflare Tunnel)
Published application routes (Cloudflare Zero Trust → Tunnels → Public Hostnames):

| Hostname | Service (origin) | Notes |
|---|---|---|
| `ha.gasovic.com` | `http://localhost:8123` | Home Assistant |
| `n8n-hook.gasovic.com` | `http://localhost:5678` | n8n webhooks (base URL) |
| `n8n.gasovic.com` | `http://localhost:5678` | n8n editor/UI |
| `ssh.gasovic.com` | `ssh://localhost:22` | Remote SSH access |

### Remote SSH notes
Remote SSH uses **Cloudflare Tunnel + Cloudflare Access**. The client machine runs a normal `ssh` command and uses `cloudflared access ssh --hostname %h` as the transport layer.

Connection flow:
```
Mac → Cloudflare Access → Cloudflare Tunnel → Pi SSH
```

Properties:
- no router port forwarding
- port 22 is not publicly exposed
- authentication is enforced by Cloudflare Access before the SSH session starts
- this only works from client machines that have `cloudflared` installed and have authenticated to the Access app

### Replicating SSH access on another Mac
To set up another Mac for remote access:

1. Install `cloudflared`:
```bash
brew install cloudflared
```

2. Copy the SSH key used for Pi access, or generate a new key and add it to the Pi:
```bash
ssh-copy-id igasovic@192.168.5.4
```

3. Add the same `~/.ssh/config` entries shown above.

4. Authenticate once with Cloudflare Access:
```bash
cloudflared access login https://ssh.gasovic.com
```

5. Connect remotely:
```bash
ssh pi-remote
```


### Service dependency graph (overview)

> For the detailed version, see `Service_dependancy_graph.md`.

```mermaid
flowchart LR
  %% Public publishing (only HA + n8n)
  CF[Cloudflare Edge] --> CFT[cloudflared]
  CFT --> HAHost[ha.gasovic.com]
  CFT --> N8NUI[n8n.gasovic.com]
  CFT --> N8NHook[n8n-hook.gasovic.com]

  HAHost --> HA[Home Assistant :8123]
  N8NUI --> N8NPort[localhost:5678]
  N8NHook --> N8NPort
  N8NPort --> N8N[n8n]

  %% n8n integrations
  TG[Telegram] --> N8N
  IMAP[Gmail IMAP] --> N8N
  N8N --> TR[Trafilatura (HTTP)]
  N8N --> OD[OneDrive (backups)]

  %% PKM path
  N8N --> PKM[pkm-server :3010]
  PKM --> PG[(Postgres)]
  PKM --> LLM[LiteLLM :4000]
  LLM --> OAI[(OpenAI API)]
  PKM --> BT[Braintrust]

  %% Note: PKM + LiteLLM are LAN-only (not published via Cloudflare)
```

---

## 2) Host baseline

### Hardware + capacity (current)
- **CPU:** 4× ARM Cortex-A72 @ 1.5GHz  
- **RAM:** 3.7GiB total; ~2.0GiB available at time of capture  
- **Swap:** 2.0GiB zram swap in use (plus a loop swap device may exist)  
- **Disk:** 219G ext4 root (`/dev/sda2`); ~190G free

### Boot / storage assumptions (SSD)
This stack expects root filesystem on `/dev/sda2`.

Expected mount state:
- `/` on `/dev/sda2` (ext4, `rw`, typically `noatime`)
- `/boot/firmware` on `/dev/sda1` (vfat)

(Keep these in env.md so an agent can recover a broken boot quickly.)

---

## 3) Stack layout on disk

**Compose project:** `stack`  
**Stack root:** `/home/igasovic/stack`  
- `docker-compose.yml`
- `.env` (secrets; not committed)
- `postgres/` (data dir)
- `postgres-init/` (init scripts)
- `n8n/` (n8n home)
- `litellm/config.yaml`
- `homeassistant/` (HA config)

**Source repos (Pi):**
- n8n workflows repo: `/home/igasovic/repos/n8n-workflows`
  - includes `src/server` (PKM server code + Dockerfile)

---

## 4) How the stack starts

There is **no separate systemd unit** that runs `docker compose up` at boot.

Instead:
- `docker.service` is enabled
- each container uses `restart: unless-stopped`
- on reboot, Docker brings containers back automatically.

---

## 5) Docker services (what runs, ports, networks, mounts)

### Networks
- `internal` bridge network for: `postgres`, `n8n`, `n8n-runners`, `litellm`, `pkm-server`
- host networking for: `homeassistant`, `matter-server`, `cloudflared`

### Containers (as observed)
| Container | Image | Restart | Published ports | Network mode |
|---|---|---|---|---|
| `postgres` | `postgres:16-alpine` | unless-stopped | none (internal only) | `stack_internal` |
| `n8n` | `docker.n8n.io/n8nio/n8n:2.10.3` | unless-stopped | `127.0.0.1:5678->5678` | `stack_internal` |
| `n8n-runners` | `pkm-n8n-runners:2.10.3` (built from repo) | unless-stopped | none (internal only) | `stack_internal` |
| `litellm` | `docker.litellm.ai/berriai/litellm:main-stable` | unless-stopped | `0.0.0.0:4000->4000` | `stack_internal` |
| `pkm-server` | `pkm-server` (built) | unless-stopped | `0.0.0.0:3010->8080` | `stack_internal` |
| `homeassistant` | `ghcr.io/home-assistant/home-assistant:stable` | unless-stopped | `0.0.0.0:8123` | host |
| `matter-server` | `ghcr.io/home-assistant-libs/python-matter-server:stable` | unless-stopped | `0.0.0.0:5580` | host |
| `cloudflared` | `cloudflare/cloudflared:latest` | unless-stopped | (tunnel) | host |

### Volumes / persistence (confirmed)
- Postgres:
  - `/home/igasovic/stack/postgres` → `/var/lib/postgresql/data`
  - `/home/igasovic/stack/postgres-init` → `/docker-entrypoint-initdb.d`
- n8n:
  - `/home/igasovic/stack/n8n` → `/home/node/.n8n`
  - `/home/igasovic/repos/n8n-workflows` → `/data` (read-only; not part of the runtime import contract)
  - `/home/igasovic/pkm-import` → `/files` (read-write; shared failure-pack sidecar path)
  - `/home/igasovic/backup/postgres` → `/home/node/.n8n-files/backup-postgres` (read-only)
- LiteLLM:
  - `/home/igasovic/stack/litellm/config.yaml` → `/app/config.yaml` (read-only)
- PKM server:
  - `/home/igasovic/pkm-import` → `/data` (read-write)
- Home Assistant:
  - `/home/igasovic/stack/homeassistant` → `/config`
  - `/etc/localtime` → `/etc/localtime` (read-only)
- Matter server:
  - docker named volume mapped to `/data` (not a bind mount)

---

## 6) Postgres (DB roles, schemas, prod/test)

**Primary app DB used by PKM:** `pkm`  
**n8n DB:** separate `n8n` database.

**Where DB lives (host):**
- `/home/igasovic/stack/postgres`

**Connecting (host → container):**
```bash
PGUSER="${POSTGRES_ADMIN_USER:-$(grep -E '^POSTGRES_ADMIN_USER=' /home/igasovic/stack/.env | tail -n1 | cut -d= -f2-)}"
PGUSER="${PGUSER:-postgres}"
docker exec -it postgres psql -U "$PGUSER" -d postgres
docker exec -it postgres psql -U "$PGUSER" -d pkm
```

**Applying a repo migration file from host path:**
```bash
PGUSER="${POSTGRES_ADMIN_USER:-$(grep -E '^POSTGRES_ADMIN_USER=' /home/igasovic/stack/.env | tail -n1 | cut -d= -f2-)}"
PGUSER="${PGUSER:-postgres}"
MIGRATION="/home/igasovic/repos/n8n-workflows/scripts/db/migrations/2026-03-28_failure_packs.sql"
cat "$MIGRATION" | docker exec -i postgres psql -U "$PGUSER" -d pkm -v ON_ERROR_STOP=1
```

### Prod vs test
- Production schema: `pkm`
- Test schema: `pkm_test`
- Global “test mode” flag lives in `pkm.runtime_config` (`key=is_test_mode`, JSON boolean).

**Authoritative schema details**
- See: `database_schema.md` (repo / docs). It documents:
  - tables in each schema
  - roles and grants
  - idempotency policies
  - batch tables used for LLM batch processing

---

## 7) n8n

**Container:** `n8n`  
**Task runners:** external sidecar `n8n-runners`  
**DB:** uses Postgres via `DB_TYPE=postgresdb` and `DB_POSTGRESDB_HOST=postgres`

**Security:**
- Basic Auth is enabled (`N8N_BASIC_AUTH_ACTIVE=true`)
- n8n UI is loopback-only on the Pi host (`127.0.0.1:5678`)
- Public access is through Cloudflare (`n8n.gasovic.com`, `n8n-hook.gasovic.com`)

**Public webhook surface for Custom GPT (via `n8n-hook.gasovic.com`):**
- `POST /webhook/pkm/chatgpt/read`
- `POST /webhook/pkm/chatgpt/wrap-commit`
- Full external contract: `docs/external_api.md`

**Key runtime env (observed):**
- `N8N_HOST=n8n.gasovic.com`
- `N8N_PROTOCOL=https`
- `N8N_EDITOR_BASE_URL=https://n8n.gasovic.com`
- `WEBHOOK_URL=https://n8n-hook.gasovic.com/`
- `N8N_PROXY_HOPS=1`
- `TZ=America/Chicago`
- `N8N_RUNNERS_MODE=external`
- `NODE_FUNCTION_ALLOW_EXTERNAL=@igasovic/n8n-blocks,igasovic-n8n-blocks`
- `NODE_FUNCTION_ALLOW_BUILTIN=crypto,node:path,node:process,node:fs,node:fs/promises`
- external runner launcher config is copied to `/home/igasovic/stack/n8n-task-runners.json` and mounted to `/etc/n8n-task-runners.json`

**Externalized workflow code & GitOps**
- Repo root: `/home/igasovic/repos/n8n-workflows`
- Canonical runtime package: `@igasovic/n8n-blocks`
- Compatibility alias (fallback only): `igasovic-n8n-blocks`
- Generated package output: `src/n8n/package/` (repo build output, ignored)
- Custom runners image source: `ops/stack/n8n-runners/Dockerfile`
- Custom runners launcher config: `ops/stack/n8n-runners/n8n-task-runners.json`
- Mount: repo → `/data` (read-only, kept for non-runtime reasons only)
- Wrapper import convention: package-root exports with `wf<NN><NodeName>` naming (for example `wf10CommandParser`)
- Canonical docs (in this project):
  - `n8n_sync.md` (canonical n8n<->Git sync flow)
- Local shell env for n8n API automation (recommended in `~/.zshrc`):
  - `N8N_API_BASE_URL` (typically `http://127.0.0.1:5678` on Pi host)
  - `N8N_API_KEY` (user-scoped API key from n8n)

---

## 8) PKM server

**Purpose:** lightweight API service used by n8n and future clients.  
**Container:** `pkm-server`  
**LAN URL:** http://192.168.5.4:3010

**Health endpoints (validated):**
- `GET /health` → `{"status":"ok"}`
- `GET /ready` → `{"status":"ready"}`

**Build context / Dockerfile**
- Context: `/home/igasovic/repos/n8n-workflows`
- Dockerfile: `src/server/Dockerfile`

**DB connectivity**
- `PKM_DB_HOST=postgres`
- `PKM_DB_PORT=5432`
- `PKM_DB_NAME=pkm`
- `PKM_DB_SCHEMA=pkm`
- `PKM_DB_SSL=false`

**LLM routing**
Current compose passes `OPENAI_API_KEY` into the service.
Recommended wiring (so **pkm-server never calls OpenAI directly**):
- `OPENAI_BASE_URL=http://litellm:4000/v1`
- `OPENAI_API_KEY=${LITELLM_MASTER_KEY}`
- `T1_DEFAULT_MODEL=t1-default`
- Tier-2 model routes (recommended):
  - `T2_MODEL_DIRECT=t2-direct`
  - `T2_MODEL_CHUNK_NOTE=t2-chunk-note`
  - `T2_MODEL_SYNTHESIS=t2-synthesis`
  - `T2_MODEL_BATCH_DIRECT=t2-sync-direct` (batch direct alias)
  - `T2_MODEL_SYNC_DIRECT=t2-sync-direct`
- Tier-2 retry controls:
  - `T2_RETRY_ENABLED=true`
  - `T2_RETRY_MAX_ATTEMPTS=2`
- Tier-2 stale detection controls:
  - `T2_STALE_MARK_ENABLED=true` (default)
  - `T2_STALE_MARK_INTERVAL_MS=86400000` (default 24h)
- Tier-2 batch worker controls:
  - `T2_BATCH_WORKER_ENABLED=false` (default)
  - `T2_BATCH_SYNC_INTERVAL_MS=600000` (default 10m)
  - `T2_BATCH_SYNC_LIMIT=25` (default from `distill.max_entries_per_run`)
  - `T2_BATCH_COLLECT_LIMIT=20` (max pending batches reconciled per cycle)
  - `T2_BATCH_REQUEST_MODEL=<provider model>` (optional override for JSONL request model; falls back to `T1_BATCH_REQUEST_MODEL`)

**Notion ingest**
- `NOTION_API_TOKEN=<notion integration token>` (required for server-side Notion block collection in `POST /normalize/notion` when only page id is provided)
- optional:
  - `NOTION_API_BASE=https://api.notion.com/v1`
  - `NOTION_API_VERSION=2022-06-28`
  - `NOTION_DATABASE_ID=<uuid>` (fallback database id when page parent metadata is unavailable)
  - `NOTION_DATABASE_URL=https://www.notion.so/<db_id>?v=...` (database id can be extracted from URL)

**Admin-protected debug endpoints**
- `/debug/*` currently requires header `x-pkm-admin-secret: <PKM_ADMIN_SECRET>`.
- If the header is missing or wrong, PKM returns `403 forbidden`.

---

## 9) LiteLLM (OpenAI-compatible proxy/router)

**Container:** `litellm`  
**LAN URL:** http://192.168.5.4:4000/v1  
**Internal URL for other containers:** http://litellm:4000/v1

**Auth model**
- Clients call LiteLLM with: `Authorization: Bearer ${LITELLM_MASTER_KEY}`
- LiteLLM uses `OPENAI_API_KEY` only to talk to upstream OpenAI.

**Config**
- File: `/home/igasovic/stack/litellm/config.yaml`
- Observed routing:
  - `t1-default` → `gpt-5-nano` with `reasoning_effort: minimal` and `allowed_openai_params: ["reasoning_effort"]`
  - `t1-cheap` → `gpt-5-nano`
  - `t1-batch` → `gpt-5-nano`

---

## 10) Home Assistant + Matter

**Home Assistant**
- Container: `homeassistant`
- Host networking
- URL: http://192.168.5.4:8123
- Persistence: `/home/igasovic/stack/homeassistant` → `/config`

**Matter Server**
- Container: `matter-server`
- Host networking (recommended for discovery/mDNS on Pi)
- UI: http://192.168.5.4:5580
- WebSocket: ws://192.168.5.4:5580/ws
- In HA: Matter integration should point to `ws://192.168.5.4:5580/ws`

Rule of thumb:
- pair devices via Home Assistant (controller)
- Matter Server is a backend; you generally do not “add devices” in the Matter Server UI

---

## 11) Cloudflared (Cloudflare Tunnel)

**Container:** `cloudflared`  
**Network mode:** host  
**How it runs:** token-based `tunnel run`

Important:
- The image is minimal and **does not include a shell** (`sh`/`bash`); use:
  - `docker exec cloudflared cloudflared ...`
- No bind-mounted `/etc/cloudflared/config.yml`; routing is managed in Cloudflare UI.
- The tunnel token is currently embedded in `docker-compose.yml` (move it to `.env` or secrets).

Observed version:
- `cloudflared version 2025.11.1` (logs recommend upgrading)


### Remote SSH operational notes
- The SSH origin route is managed in the Cloudflare UI as `ssh.gasovic.com` → `ssh://localhost:22`.
- Access from a client machine is expected to work via `ssh pi-remote`, not by running `cloudflared access ssh --hostname ssh.gasovic.com` interactively by itself.
- On a new Mac, install `cloudflared`, add the `pi-remote` SSH config entry, then run `cloudflared access login https://ssh.gasovic.com` once before the first connection.

---

## 12) Secrets / environment variables

All secrets live in:
- `/home/igasovic/stack/.env`  (**DO NOT COMMIT**)

Observed keys (names only):
- `OPENAI_API_KEY`, `LITELLM_MASTER_KEY`, `BRAINTRUST_API_KEY`
- n8n: `N8N_BASIC_AUTH_*`, `N8N_DB_*`, `N8N_HOST`, `N8N_PROTOCOL`, `N8N_EDITOR_BASE_URL`, `WEBHOOK_URL`
- PKM DB: `PKM_DB_*`, `PKM_INGEST_*`, `PKM_READ_*`
- PKM admin: `PKM_ADMIN_SECRET` (used by `/debug/*`, `/db/delete`, `/db/move`)
- Postgres admin: `POSTGRES_ADMIN_*`
- `TZ`

### Mac debug UI access (fixes `forbidden`)
1. On Pi, ensure `PKM_ADMIN_SECRET` is set in `/home/igasovic/stack/.env`.
2. Ensure `pkm-server` gets that env (via compose), then restart:
   - `cd /home/igasovic/stack && docker compose up -d pkm-server`
3. Verify inside container:
   - `docker exec -it stack-pkm-server-1 sh -lc 'echo ${PKM_ADMIN_SECRET:+set}'`
4. On Mac UI (`src/web/pkm-debug-ui/.env`), set:
   - `VITE_PKM_ORIGIN=http://192.168.5.4:3010`
   - `PKM_ADMIN_SECRET=<same secret>`
5. Start UI with `npm run dev`.

Notes:
- The UI does not send admin secret from browser code.
- Vite dev proxy injects `x-pkm-admin-secret` server-side for `/debug/*`.

---

## 13) Backups

Currently present (created during SSD migration / snapshotting):
- `/home/igasovic/backup/pi_backup_bundle.tgz` (root-owned bundle)
- `/home/igasovic/backup/postgres_dumpall.sql.gz`

Scheduled timers observed: only default system timers (apt, logrotate, fstrim, etc.).  
**No dedicated backup timer** is currently configured.

Recommendation (future):
- add a simple scheduled job (systemd timer) to produce:
  - `pg_dumpall` (or per-db dumps), plus
  - tar of `/home/igasovic/stack` *excluding* secrets (or storing secrets separately)

---

## 14) Open questions / TODOs (for agents)

These are the remaining decisions/gaps that should be made explicit to avoid “agent guessing”:

1) **Exposure intent**
   - Is LiteLLM (`:4000`) intended to be reachable on the LAN, or should it be internal-only?
   - Is PKM server (`:3010`) intended to be reachable on the LAN, or should it be internal-only / tunnel-only?

2) **Cloudflare Access posture**
   - Which of the public hostnames are protected by Cloudflare Access policies (and which aren’t)?
   - Document expected auth layers for each public hostname.

3) **Tighten secrets hygiene**
   - Move the Cloudflared tunnel token out of `docker-compose.yml` and into `.env` (or Docker secrets).
