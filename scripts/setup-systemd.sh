#!/usr/bin/env bash
# ============================================================
# systemd timer setup script (Ubuntu / Debian / Linux)
# Runs uptime-resilience-agent at the top of every hour
# Usage: bash scripts/setup-systemd.sh
# ============================================================

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_PATH="$(command -v node || echo '/usr/bin/node')"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_NAME="uptime-resilience-agent"
LOG_DIR="$HOME/.local/log/uptime-resilience-agent"

echo "Proje dizini: $AGENT_DIR"
echo "Node.js:      $NODE_PATH"
echo "Servis:       $SERVICE_DIR/$SERVICE_NAME"
echo ""

# .env dosyasi kontrolu
if [ ! -f "$AGENT_DIR/.env" ]; then
  echo "HATA: $AGENT_DIR/.env dosyasi bulunamadi!"
  echo "Lutfen: cp $AGENT_DIR/.env.example $AGENT_DIR/.env"
  exit 1
fi

# node_modules kontrolu
if [ ! -d "$AGENT_DIR/node_modules" ]; then
  echo "Bagimliliklar yukleniyor..."
  cd "$AGENT_DIR" && npm install
fi

# Dizinleri olustur
mkdir -p "$SERVICE_DIR" "$LOG_DIR"

# systemd .service unit
cat > "$SERVICE_DIR/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Uptime Resilience Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${AGENT_DIR}
ExecStart=${NODE_PATH} ${AGENT_DIR}/src/index.js
StandardOutput=append:${LOG_DIR}/stdout.log
StandardError=append:${LOG_DIR}/stderr.log
SuccessExitStatus=0 1 2 3
EOF

# systemd .timer unit (her saat basinda)
cat > "$SERVICE_DIR/${SERVICE_NAME}.timer" <<EOF
[Unit]
Description=Uptime Resilience Agent — saatlik zamanlama

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
EOF

# systemd reload ve enable
systemctl --user daemon-reload
systemctl --user enable --now "${SERVICE_NAME}.timer"

echo "systemd timer yuklendi ve baslatildi!"
echo ""
echo "=== KURULUM TAMAMLANDI ==="
echo ""
echo "Her saat basinda (XX:00) otomatik calisacak."
echo ""
echo "Kullanim komutlari:"
echo "  Durum:          systemctl --user status ${SERVICE_NAME}.timer"
echo "  Simdi calistir: systemctl --user start ${SERVICE_NAME}.service"
echo "  Durdur:         systemctl --user stop ${SERVICE_NAME}.timer"
echo "  Kaldir:         systemctl --user disable --now ${SERVICE_NAME}.timer && rm ${SERVICE_DIR}/${SERVICE_NAME}.{service,timer}"
echo "  Loglar:         tail -f ${LOG_DIR}/stdout.log"
echo "  Hata loglari:   tail -f ${LOG_DIR}/stderr.log"
echo ""
echo "Hemen test etmek icin:"
echo "  node ${AGENT_DIR}/src/index.js --dry"
