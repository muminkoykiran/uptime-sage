#!/usr/bin/env bash
# Align the interactive project config with the analyzer's ChatGPT-compatible default.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$ROOT_DIR/.codex/config.toml"

if [ ! -w "$CONFIG" ]; then
  echo "HATA: $CONFIG yazilabilir degil. Yazma izni olan bir terminalde yeniden calistirin."
  exit 1
fi

if grep -q '^model[[:space:]]*=' "$CONFIG"; then
  sed -i 's/^model[[:space:]]*=.*/model = "gpt-5.6-terra"/' "$CONFIG"
else
  sed -i '1imodel = "gpt-5.6-terra"' "$CONFIG"
fi

echo "Codex project model gpt-5.6-terra olarak guncellendi."
