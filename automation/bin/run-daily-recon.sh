#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/ylf/Desktop/projects/russia-crm-local"
cd "$ROOT"

echo "[daily-recon] cwd=$PWD"
echo "[daily-recon] starting: $(date '+%Y-%m-%d %H:%M:%S')"

npm run recon:hermes:daily

echo "[daily-recon] finished: $(date '+%Y-%m-%d %H:%M:%S')"
