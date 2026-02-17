# env.md — PKM stack environment (Raspberry Pi)

**Purpose:** quick human review + enough context for agents to safely operate / extend the stack (what runs where, how to connect, what can break, and what not to touch).

**Last verified:** 2026-02-17  
**Host:** `pi` (LAN: `192.168.5.4`)  
**OS:** Debian GNU/Linux 13 (trixie) aarch64 • kernel `6.12.62+rpt-rpi-v8`  
**Docker:** 29.1.4 • **Docker Compose:** v5.0.1

---

## 0) Quick start (most common ops)

```bash
# SSH in
ssh pi

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

### Mac → Pi SSH shortcuts (current ~/.ssh/config)
- `ssh pi` connects directly to `igasovic@192.168.5.4`
- `ssh n8n` sets up a port forward:
  - `localhost:5680` (Mac) → `127.0.0.1:5678` (Pi)

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
- `internal` bridge network for: `postgres`, `n8n`, `litellm`, `pkm-server`
- host networking for: `homeassistant`, `matter-server`, `cloudflared`

### Containers (as observed)
| Container | Image | Restart | Published ports | Network mode |
|---|---|---|---|---|
| `postgres` | `postgres:16-alpine` | unless-stopped | none (internal only) | `stack_internal` |
| `n8n` | `docker.n8n.io/n8nio/n8n:latest` | unless-stopped | `127.0.0.1:5678->5678` | `stack_internal` |
| `litellm` | `docker.litellm.ai/berriai/litellm:main-stable` | unless-stopped | `0.0.0.0:4000->4000` | `stack_internal` |
| `stack-pkm-server-1` | `stack-pkm-server` (built) | unless-stopped | `0.0.0.0:3010->8080` | `stack_internal` |
| `homeassistant` | `ghcr.io/home-assistant/home-assistant:stable` | unless-stopped | `0.0.0.0:8123` | host |
| `matter-server` | `ghcr.io/home-assistant-libs/python-matter-server:stable` | unless-stopped | `0.0.0.0:5580` | host |
| `cloudflared` | `cloudflare/cloudflared:latest` | unless-stopped | (tunnel) | host |

### Volumes / persistence (confirmed)
- Postgres:
  - `/home/igasovic/stack/postgres` → `/var/lib/postgresql/data`
  - `/home/igasovic/stack/postgres-init` → `/docker-entrypoint-initdb.d`
- n8n:
  - `/home/igasovic/stack/n8n` → `/home/node/.n8n`
  - `/home/igasovic/repos/n8n-workflows` → `/data` (read-only)
  - `/home/igasovic/pkm-import` → `/files` (used for file imports/backfills)
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
docker exec -it postgres psql -U "${POSTGRES_ADMIN_USER}" -d postgres
docker exec -it postgres psql -U "${POSTGRES_ADMIN_USER}" -d pkm
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
**DB:** uses Postgres via `DB_TYPE=postgresdb` and `DB_POSTGRESDB_HOST=postgres`

**Security:**
- Basic Auth is enabled (`N8N_BASIC_AUTH_ACTIVE=true`)
- n8n UI is loopback-only on the Pi host (`127.0.0.1:5678`)
- Public access is through Cloudflare (`n8n.gasovic.com`, `n8n-hook.gasovic.com`)

**Key runtime env (observed):**
- `N8N_HOST=n8n.gasovic.com`
- `N8N_PROTOCOL=https`
- `N8N_EDITOR_BASE_URL=https://n8n.gasovic.com`
- `WEBHOOK_URL=https://n8n-hook.gasovic.com`
- `TZ=America/Chicago`

**Externalized workflow code & GitOps**
- Repo root: `/home/igasovic/repos/n8n-workflows`
- Mount: repo → `/data` (read-only)
- Canonical docs (in this project):
  - `n8n_to_git.md` (export workflow changes back to repo)
  - `git_to_n8n.md` (import changes from repo into n8n)

---

## 8) PKM server

**Purpose:** lightweight API service used by n8n and future clients.  
**Container:** `stack-pkm-server-1` (service `pkm-server`)  
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

---

## 12) Secrets / environment variables

All secrets live in:
- `/home/igasovic/stack/.env`  (**DO NOT COMMIT**)

Observed keys (names only):
- `OPENAI_API_KEY`, `LITELLM_MASTER_KEY`, `BRAINTRUST_API_KEY`
- n8n: `N8N_BASIC_AUTH_*`, `N8N_DB_*`, `N8N_HOST`, `N8N_PROTOCOL`, `N8N_EDITOR_BASE_URL`, `WEBHOOK_URL`
- PKM DB: `PKM_DB_*`, `PKM_INGEST_*`, `PKM_READ_*`
- Postgres admin: `POSTGRES_ADMIN_*`
- `TZ`

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
