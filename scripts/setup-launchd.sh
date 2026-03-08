#!/usr/bin/env bash
# ============================================================
# macOS LaunchAgent kurulum scripti
# Her saat basinda uptime-resilience-agent'i calistirir
# Kullanim: bash scripts/setup-launchd.sh
# ============================================================

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_NAME="com.uptime.resilience.agent"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
NODE_PATH="$(command -v node || echo '/usr/local/bin/node')"
NODE_BIN_DIR="$(dirname "$NODE_PATH")"
LOG_DIR="$HOME/Library/Logs/uptime-resilience-agent"

echo "Proje dizini: $AGENT_DIR"
echo "Node.js: $NODE_PATH"
echo ""

# .env dosyasi kontrolu
if [ ! -f "$AGENT_DIR/.env" ]; then
  echo "HATA: $AGENT_DIR/.env dosyasi bulunamadi!"
  echo "Lutfen: cp $AGENT_DIR/.env.example $AGENT_DIR/.env"
  echo "Lutfen .env dosyasini kontrol edin: TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID zorunludur."
  exit 1
fi

# node_modules kontrolu
if [ ! -d "$AGENT_DIR/node_modules" ]; then
  echo "Bagimlilıklar yukleniyor..."
  cd "$AGENT_DIR" && npm install
fi

# Log dizini olustur
mkdir -p "$LOG_DIR"

# LaunchAgent plist olustur
cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_NAME}</string>

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

echo "LaunchAgent olusturuldu: $PLIST_PATH"

# Mevcut servis varsa bootout et
if launchctl print "gui/$(id -u)/$PLIST_NAME" 2>/dev/null; then
  echo "Mevcut servis kaldiriliyor..."
  launchctl bootout "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || true
fi

# Servisi yukle ve baslat
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
echo "LaunchAgent yuklendi!"

echo ""
echo "=== KURULUM TAMAMLANDI ==="
echo ""
echo "Her saat basinda (XX:00) otomatik calisacak."
echo ""
echo "Kullanim komutlari:"
echo "  Durum kontrol:   launchctl print gui/$(id -u)/$PLIST_NAME"
echo "  Simdi calistir:  launchctl kickstart gui/$(id -u)/$PLIST_NAME"
echo "  Durdur:          launchctl kill SIGTERM gui/$(id -u)/$PLIST_NAME"
echo "  Kaldır:          launchctl bootout gui/$(id -u) $PLIST_PATH && rm $PLIST_PATH"
echo "  Loglar:          tail -f $LOG_DIR/stdout.log"
echo "  Hata logları:    tail -f $LOG_DIR/stderr.log"
echo ""
echo "Hemen test etmek icin:"
echo "  node $AGENT_DIR/src/index.js --dry"
