# env.md — PKM DEV Raspberry Pi stack environment
Version: 2026.02.08-backend-bootstrap
Updated: 2026-02-08
Host (SSH): igasovic@192.168.5.4

## Storage and boot
- Booted from SSD
  - SSD device: /dev/sda (Crucial BX500 240GB, model CT240BX500SSD1)
  - Boot partition: /dev/sda1 (vfat) mounted at /boot/firmware
  - Root partition: /dev/sda2 (ext4) mounted at /

SSD PARTUUIDs (for recovery/troubleshooting):
- /dev/sda1 PARTUUID: 22c916e3-aea2-4920-9080-ba0e5f51412d
- /dev/sda2 PARTUUID: 7cc91410-0a0e-43c7-a27b-f739c21dec3f

Expected mount state:
- / -> /dev/sda2 (rw, noatime)
- /boot/firmware -> /dev/sda1 (rw)

Baseline /etc/fstab (SSD):
proc            /proc           proc    defaults          0       0
PARTUUID=7cc91410-0a0e-43c7-a27b-f739c21dec3f  /               ext4    defaults,noatime  0       1
PARTUUID=22c916e3-aea2-4920-9080-ba0e5f51412d  /boot/firmware  vfat    defaults          0       2

cmdline root pointer:
- /boot/firmware/cmdline.txt must include:
  - root=PARTUUID=7cc91410-0a0e-43c7-a27b-f739c21dec3f
- Root must not be forced read-only (no standalone 'ro' flag).

## Docker stack
Stack directory:
- /home/igasovic/stack
Compose file:
- /home/igasovic/stack/docker-compose.yml

Services (current):
- postgres: postgres:16-alpine
  - Container name: postgres
  - Container init env:
    - POSTGRES_USER=pgadmin
    - POSTGRES_DB=postgres
  - Connect from host (example):
    - docker exec -it postgres psql -U pgadmin -d postgres
- n8n: docker.n8n.io/n8nio/n8n:latest
- homeassistant: ghcr.io/home-assistant/home-assistant:stable
- cloudflared: cloudflare/cloudflared:latest
- matter-server: ghcr.io/home-assistant-libs/python-matter-server:stable
- pkm-server: custom Node.js backend (Docker build)
  - Purpose: backend bootstrap for PKM API (currently basic health/echo endpoints; later will host Postgres + OpenAI endpoints)
  - Source code (repo): /home/igasovic/repos/n8n-workflows/src/server
  - Built/managed via compose from: /home/igasovic/stack/docker-compose.yml
  - Runtime port:
    - Container listens on: 8080 (default in code: `process.env.PORT || 8080`)
    - Host port mapping (current): 3010 -> 8080
      - Base URL (LAN/host): http://192.168.5.4:3010
  - Endpoints (validated):
    - GET  /health  -> 200 OK
    - GET  /ready   -> 200 OK
    - GET  /version -> 200 OK
    - POST /echo    -> 200 OK (expects JSON body)

### Matter (Home Assistant Container)
Context:
- Home Assistant is running as a Docker container (not HA OS / not Add-ons).
- Matter support requires a separate **Matter Server** container.
- The Matter integration in HA should point to the server via WebSocket URL (do NOT rely on `localhost` inside the HA container unless you intentionally share network namespaces).

Expected compose service (minimal):
- service name: `matter-server`
- image: `ghcr.io/home-assistant-libs/python-matter-server:stable`
- `network_mode: host` (recommended on Pi for discovery / mDNS stability)

Endpoints (LAN):
- Matter Server UI: http://192.168.5.4:5580
- Matter Server WebSocket: ws://192.168.5.4:5580/ws
- Home Assistant Matter integration should use: ws://192.168.5.4:5580/ws

Pairing rule of thumb:
- Pair Matter devices in **Home Assistant** (controller).
- Matter Server is a backend; you generally don’t “add devices” in the Matter Server UI.

Thread / Eero note:
- Eero 6 can act as a Thread Border Router (infrastructure). You typically **do not** add Eero itself to HA/Matter.
- If pairing/discovery is flaky, suspect multicast/mDNS handling; host networking for Matter Server is the first lever.

Persistence (bind mounts):
- Postgres data (host): /home/igasovic/stack/postgres  -> /var/lib/postgresql/data
- n8n home (host): /home/igasovic/stack/n8n          -> /home/node/.n8n

n8n external JS mount:
- Host repo path: /home/igasovic/repos/n8n-workflows/js
- Container mount path: /data/js
- Expected inside container: /data/js/workflows/* exists

Databases validated:
- n8n (owner: n8n)
- pkm (owner: pgadmin)
Roles validated (examples): pgadmin (superuser), n8n, pkm_ingest, pkm_read

## Cloudflared (observed)
Ingress targets observed in logs:
- ha.gasovic.com -> http://localhost:8123
- n8n.gasovic.com -> http://localhost:5678
- n8n-hook.gasovic.com -> http://localhost:5678

Notes:
- pkm-server is currently exposed on LAN at http://192.168.5.4:3010.
- If remote access is desired later, add a new Cloudflared ingress mapping (example):
  - pkm-api.gasovic.com -> http://localhost:3010

External checks:
- n8n.gasovic.com returns 302 to Cloudflare Access login (expected)
- ha.gasovic.com may return 405 for HEAD; validate with GET.

## Migration backups (created)
Pi backup dir:
- /home/igasovic/backup
Mac backup dir:
- ~/pi-ssd-migration/backup

Files copied to Mac:
- postgres_dumpall.sql.gz (pg_dumpall of cluster)
- pi_backup_bundle.tgz (includes /home/igasovic/stack, repo, and /home/igasovic/.ssh)

## PKM Test Mode (Global)
PKM supports a **global test mode** for safe experimentation.

- Test mode is controlled by the **`PKM Config`** sub-workflow in n8n.
- When enabled, all workflows write to and read from:
  - `pkm_test.entries`
- When disabled (default), workflows use:
  - `pkm.entries`

### Operational rules
- Test mode is **off by default**.
- Test mode must only be enabled intentionally (via workflow toggle).
- Telegram and email responses visibly display a **TEST MODE banner** when active.
- Test data can be wiped safely using:
  ```sql
  TRUNCATE TABLE pkm_test.entries RESTART IDENTITY;
  ```

## Idempotency migration notes (2026-02)

Applied migration adds:
- `pkm.idempotency_policies`
- `pkm_test.idempotency_policies`
- `entries` columns in both schemas:
  - `idempotency_policy_key`
  - `idempotency_key_primary`
  - `idempotency_key_secondary`
- partial unique indexes for primary/secondary idempotency keys in both schemas.

`pkm_ingest` privileges now include CRUD on policy tables plus sequence usage:
- `GRANT SELECT, INSERT, UPDATE, DELETE ON ...idempotency_policies TO pkm_ingest`
- `GRANT USAGE, SELECT ON SEQUENCE ...idempotency_policies_policy_id_seq TO pkm_ingest`
- `ALTER DEFAULT PRIVILEGES IN SCHEMA pkm GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pkm_ingest`
- `ALTER DEFAULT PRIVILEGES IN SCHEMA pkm_test GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pkm_ingest`
