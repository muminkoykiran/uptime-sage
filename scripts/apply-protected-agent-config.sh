#!/usr/bin/env bash
# Applies repository-managed Codex hook policy when the caller has write access
# to .codex. This script is intentionally separate from production setup.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH_FILE="$ROOT_DIR/docs/protected-config.patch"

if [ ! -w "$ROOT_DIR/.codex/hooks.json" ]; then
  echo "HATA: .codex/hooks.json yazilabilir degil. Bu komutu yazma izni olan bir Codex veya shell oturumunda calistirin."
  exit 1
fi

git -C "$ROOT_DIR" apply --check "$PATCH_FILE"
git -C "$ROOT_DIR" apply "$PATCH_FILE"
node --check "$ROOT_DIR/.codex/hooks.json" 2>/dev/null || true
echo "Codex lifecycle hooks devre disi birakildi. Telegram bildirimleri yalnizca src/index.js tarafindan gonderilir."
