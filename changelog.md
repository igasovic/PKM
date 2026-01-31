# changelog

## 2026-01-30 — Pi SD → SSD migration (with SD rollback)

### What we achieved
- Migrated Raspberry Pi OS + full Docker stack from SD card (`mmcblk0`) to SSD (`/dev/sda`) while keeping the SD card untouched for rollback.
- Verified services on SSD: Postgres, n8n, Home Assistant, cloudflared.
- Verified n8n external JS mount works inside container (`/data/js/workflows`).
- Verified Cloudflare tunnel routes to n8n and HA.

### Backups (stored on Mac)
- Postgres logical dump: `postgres_dumpall.sql.gz` (covers `n8n` + `pkm`, including n8n credentials such as Telegram).
- Filesystem bundle: `pi_backup_bundle.tgz` (stack, repo, SSH keys).

Mac copy commands used:
- `scp igasovic@192.168.5.4:/home/igasovic/backup/postgres_dumpall.sql.gz ~/pi-ssd-migration/backup/`
- `scp igasovic@192.168.5.4:/home/igasovic/backup/pi_backup_bundle.tgz    ~/pi-ssd-migration/backup/`

### Migration summary
- Identified disks:
  - SD: `mmcblk0` (boot: `mmcblk0p1`, root: `mmcblk0p2`)
  - SSD: `sda` (CT240BX500SSD1)
- Cloned SD → SSD:
  - SSD partitions created:
    - `/dev/sda1` (FAT32 boot)
    - `/dev/sda2` (EXT4 root)
  - Copied root and boot partitions to SSD.
  - Boot-tested with SD removed.
- Fixed post-boot issues on SSD:
  - Root initially mounted read-only (`ro`) and `/etc/fstab` was empty.
  - Remounted root RW.
  - Mounted `/dev/sda1` at `/boot/firmware`.
  - Rebuilt `/etc/fstab` using SSD PARTUUIDs and verified persistence after reboot.

SSD PARTUUIDs used:
- `/dev/sda1` PARTUUID: `22c916e3-aea2-4920-9080-ba0e5f51412d`
- `/dev/sda2` PARTUUID: `7cc91410-0a0e-43c7-a27b-f739c21dec3f`

Final verification commands (passed):
- `findmnt / -o SOURCE,FSTYPE,OPTIONS` → `/dev/sda2` mounted `rw`
- `findmnt /boot/firmware -o SOURCE,FSTYPE,OPTIONS` → `/dev/sda1` mounted `rw`
- `docker compose ps` → all services `Up`
- Postgres DBs present: `n8n`, `pkm`
- n8n JS mount present: `/data/js/workflows/*`
- `https://n8n.gasovic.com` → `302` to Cloudflare Access login (expected)
- `https://ha.gasovic.com` → `405` for HEAD; use GET to validate

