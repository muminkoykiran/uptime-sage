#!/usr/bin/env bash
# ============================================================
# Cron job kurulum scripti (Linux veya macOS)
# Her saat basinda calistirir
# Kullanim: bash scripts/setup-cron.sh
# ============================================================

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_PATH="$(command -v node || echo '/usr/local/bin/node')"
LOG_FILE="$HOME/.uptime-resilience-agent.log"
CODEX_DEFAULT_PATH=$(command -v codex || echo "codex")

CRON_TAG="uptime-resilience-agent"
CRON_LINE="0 * * * * cd \"${AGENT_DIR}\" && CODEX_BIN=${CODEX_DEFAULT_PATH} ${NODE_PATH} src/index.js >> ${LOG_FILE} 2>&1 # ${CRON_TAG}"

echo "Proje dizini: $AGENT_DIR"
echo "Node.js: $NODE_PATH"
echo "Log dosyası: $LOG_FILE"
echo ""

# Mevcut crontab'a ekle (tekrar eklememek icin kontrol et)
CURRENT_CRONTAB=$(crontab -l 2>/dev/null || echo "")

if echo "$CURRENT_CRONTAB" | grep -qF "# ${CRON_TAG}"; then
  echo "Cron job zaten mevcut:"
  echo "$CURRENT_CRONTAB" | grep -F "# ${CRON_TAG}"
  echo ""
  read -rp "Guncellemek istiyor musunuz? (e/H): " answer
  if [[ "${answer,,}" != "e" && "${answer,,}" != "y" ]]; then
    echo "Iptal edildi."
    exit 0
  fi
  # Eskisini kaldir
  CURRENT_CRONTAB=$(echo "$CURRENT_CRONTAB" | grep -vF "# ${CRON_TAG}")
fi

# Yeni cron job ekle
NEW_CRONTAB=$(printf '%s\n%s\n' "${CURRENT_CRONTAB}" "${CRON_LINE}" | sed '/^[[:space:]]*$/d')

echo "$NEW_CRONTAB" | crontab -
echo "Cron job eklendi!"

echo ""
echo "=== KURULUM TAMAMLANDI ==="
echo ""
echo "Mevcut cron jobs:"
crontab -l | grep -v "^#" | grep -v "^$"
echo ""
echo "Kullanim:"
echo "  Cron listesi:   crontab -l"
echo "  Cron kaldır:    crontab -e (ilgili satiri sil)"
echo "  Loglar:         tail -f $LOG_FILE"
echo "  Test:           node $AGENT_DIR/src/index.js --dry"
