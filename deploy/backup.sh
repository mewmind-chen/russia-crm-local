#!/usr/bin/env bash
set -euo pipefail
ROOT=/opt/tradepulse
BACKUP_DIR="${BACKUP_DIR:-/var/backups/tradepulse}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
sqlite3 "$ROOT/data/crm.db" ".backup '$BACKUP_DIR/crm-$STAMP.db'"
tar -czf "$BACKUP_DIR/artifacts-$STAMP.tar.gz" -C "$ROOT" reports recon-runs contact-recon-reports
find "$BACKUP_DIR" -type f -mtime +28 -delete
if [[ -n "${BACKUP_RCLONE_REMOTE:-}" ]]; then
  rclone copy "$BACKUP_DIR" "$BACKUP_RCLONE_REMOTE" --include "*$STAMP*"
fi
