#!/usr/bin/env bash
# ============================================================
# systemd timer setup script (Ubuntu / Debian / Linux)
# System-level kurulum — login gerektirmez, boot'ta baslar.
# Kullanim: sudo bash scripts/setup-systemd.sh
# ============================================================

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "HATA: Bu script sudo ile calistirilmalidir."
  echo "  sudo bash scripts/setup-systemd.sh"
  exit 1
fi

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_PATH="$(command -v node || echo '/usr/bin/node')"
# Servisi proje dosyalarinin sahibi olan kullanici olarak calistir
SERVICE_USER="$(stat -c '%U' "$AGENT_DIR")"
SERVICE_DIR="/etc/systemd/system"
SERVICE_NAME="uptime-resilience-agent"
LOG_DIR="/var/log/${SERVICE_NAME}"

echo "Proje dizini: $AGENT_DIR"
echo "Node.js:      $NODE_PATH"
echo "Servis kullanicisi: $SERVICE_USER"
echo "Servis:       $SERVICE_DIR/$SERVICE_NAME"
echo ""

if [ ! -f "$AGENT_DIR/.env" ]; then
  echo "HATA: $AGENT_DIR/.env dosyasi bulunamadi!"
  echo "  cp $AGENT_DIR/.env.example $AGENT_DIR/.env"
  exit 1
fi

if [ ! -d "$AGENT_DIR/node_modules" ]; then
  echo "Bagimliliklar yukleniyor..."
  su - "$SERVICE_USER" -c "cd '$AGENT_DIR' && npm install"
fi

mkdir -p "$LOG_DIR"
chown "$SERVICE_USER" "$LOG_DIR"

cat > "$SERVICE_DIR/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Uptime Resilience Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=${SERVICE_USER}
WorkingDirectory=${AGENT_DIR}
ExecStart=${NODE_PATH} ${AGENT_DIR}/src/index.js
StandardOutput=append:${LOG_DIR}/stdout.log
StandardError=append:${LOG_DIR}/stderr.log
SuccessExitStatus=0 1 2 3

[Install]
WantedBy=multi-user.target
EOF

cat > "$SERVICE_DIR/${SERVICE_NAME}.timer" <<EOF
[Unit]
Description=Uptime Resilience Agent — saatlik zamanlama

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.timer"

echo "systemd timer yuklendi ve baslatildi!"
echo ""
echo "=== KURULUM TAMAMLANDI ==="
echo ""
echo "Her saat basinda (XX:00) otomatik calisacak. Login gerektirmez."
echo ""
echo "Kullanim komutlari:"
echo "  Durum:          systemctl status ${SERVICE_NAME}.timer"
echo "  Simdi calistir: systemctl start ${SERVICE_NAME}.service"
echo "  Durdur:         systemctl stop ${SERVICE_NAME}.timer"
echo "  Kaldir:         systemctl disable --now ${SERVICE_NAME}.timer && rm ${SERVICE_DIR}/${SERVICE_NAME}.{service,timer}"
echo "  Loglar:         tail -f ${LOG_DIR}/stdout.log"
echo "  Hata loglari:   tail -f ${LOG_DIR}/stderr.log"
echo ""
echo "Hemen test etmek icin:"
echo "  sudo -u ${SERVICE_USER} node ${AGENT_DIR}/src/index.js --dry"
