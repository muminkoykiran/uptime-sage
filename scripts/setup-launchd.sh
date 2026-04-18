#!/usr/bin/env bash
# ============================================================
# macOS LaunchDaemon setup script
# System-level kurulum — login gerektirmez, boot'ta baslar.
# Kullanim: sudo bash scripts/setup-launchd.sh
# ============================================================

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "HATA: Bu script sudo ile calistirilmalidir."
  echo "  sudo bash scripts/setup-launchd.sh"
  exit 1
fi

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_NAME="com.uptime.resilience.agent"
PLIST_PATH="/Library/LaunchDaemons/${PLIST_NAME}.plist"
NODE_PATH="$(command -v node || echo '/usr/local/bin/node')"
NODE_BIN_DIR="$(dirname "$NODE_PATH")"
# Servisi proje dosyalarinin sahibi olan kullanici olarak calistir
SERVICE_USER="$(stat -f '%Su' "$AGENT_DIR")"
LOG_DIR="/var/log/uptime-resilience-agent"

echo "Proje dizini: $AGENT_DIR"
echo "Node.js:      $NODE_PATH"
echo "Servis kullanicisi: $SERVICE_USER"
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

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_NAME}</string>

  <key>UserName</key>
  <string>${SERVICE_USER}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${NODE_PATH}</string>
    <string>${AGENT_DIR}/src/index.js</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${AGENT_DIR}</string>

  <key>StartCalendarInterval</key>
  <dict>
    <key>Minute</key>
    <integer>0</integer>
  </dict>

  <key>StandardOutPath</key>
  <string>${LOG_DIR}/stdout.log</string>

  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/stderr.log</string>

  <key>RunAtLoad</key>
  <false/>

  <key>KeepAlive</key>
  <false/>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${NODE_BIN_DIR}:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
</dict>
</plist>
EOF

chown root:wheel "$PLIST_PATH"
chmod 644 "$PLIST_PATH"

# Mevcut daemon varsa kaldır
if launchctl print "system/$PLIST_NAME" 2>/dev/null; then
  echo "Mevcut daemon kaldiriliyor..."
  launchctl bootout system "$PLIST_PATH" 2>/dev/null || true
fi

launchctl bootstrap system "$PLIST_PATH"
echo "LaunchDaemon yuklendi!"

echo ""
echo "=== KURULUM TAMAMLANDI ==="
echo ""
echo "Her saat basinda (XX:00) otomatik calisacak. Login gerektirmez."
echo ""
echo "Kullanim komutlari:"
echo "  Durum:          sudo launchctl print system/$PLIST_NAME"
echo "  Simdi calistir: sudo launchctl kickstart system/$PLIST_NAME"
echo "  Durdur:         sudo launchctl kill SIGTERM system/$PLIST_NAME"
echo "  Kaldir:         sudo launchctl bootout system $PLIST_PATH && sudo rm $PLIST_PATH"
echo "  Loglar:         tail -f $LOG_DIR/stdout.log"
echo "  Hata loglari:   tail -f $LOG_DIR/stderr.log"
echo ""
echo "Hemen test etmek icin:"
echo "  sudo -u ${SERVICE_USER} node ${AGENT_DIR}/src/index.js --dry"
