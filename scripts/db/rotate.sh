#!/usr/bin/env bash
set -euo pipefail
BACKUP_ROOT="${BACKUP_ROOT:-/home/igasovic/backup/postgres}"

# nightly: 14 days, weekly: 8 weeks, monthly: 12 months
find "$BACKUP_ROOT/nightly" -type f -mtime +14 -delete
find "$BACKUP_ROOT/weekly"  -type f -mtime +56 -delete
find "$BACKUP_ROOT/monthly" -type f -mtime +365 -delete
