#!/usr/bin/env bash
# Бэкап SQLite через VACUUM INTO (консистентно при WAL). Хранит 30 копий. Cron: 0 3 * * * DB_PATH=... BACKUP_DIR=... <app>/tools/backup.sh
set -euo pipefail
DB="${DB_PATH:-./data/crm.db}"
DIR="${BACKUP_DIR:-$(dirname "$DB")/backups}"
mkdir -p "$DIR"
OUT="$DIR/crm-$(date +%Y%m%d-%H%M%S).db"
sqlite3 "$DB" "VACUUM INTO '$OUT'"
gzip -f "$OUT"
ls -1t "$DIR"/crm-*.db.gz | tail -n +31 | xargs -r rm -f
echo "backup: $OUT.gz"
