#!/usr/bin/env bash
# Installs TF2 Scout as a systemd user service (starts on login, restarts if it crashes).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="$(command -v node)"
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/tf2-scout.service" <<UNIT
[Unit]
Description=TF2 Scout - TF2 trading-opportunity finder
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$DIR
ExecStart=$NODE src/index.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PATH=$(dirname "$NODE"):/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now tf2-scout.service
# Keep the service alive even when no graphical session is open:
loginctl enable-linger "$USER" 2>/dev/null || true
echo "Service installed. Status:"
systemctl --user --no-pager status tf2-scout.service | head -5
echo "Logs: journalctl --user -u tf2-scout -f"
