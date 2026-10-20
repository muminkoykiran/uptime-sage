#!/usr/bin/env bash
# Install a conservative rotation policy for the systemd setup logs.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "HATA: sudo bash scripts/setup-logrotate.sh ile calistirin."
  exit 1
fi

cat > /etc/logrotate.d/uptime-resilience-agent <<'EOF'
/var/log/uptime-resilience-agent/*.log {
  daily
  rotate 14
  compress
  delaycompress
  missingok
  notifempty
  copytruncate
  su root root
}
EOF

logrotate -d /etc/logrotate.d/uptime-resilience-agent
echo "Log rotation policy installed: /etc/logrotate.d/uptime-resilience-agent"
