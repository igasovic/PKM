# env.md — PKM DEV Raspberry Pi stack environment
Version: 2026.01.31-ssd-migration
Updated: 2026-01-31
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
- n8n: docker.n8n.io/n8nio/n8n:latest
- homeassistant: ghcr.io/home-assistant/home-assistant:stable
- cloudflared: cloudflare/cloudflared:latest

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
