#!/usr/bin/env bash
set -euo pipefail
systemctl --user disable --now tf2-scout.service 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/tf2-scout.service"
systemctl --user daemon-reload
echo "tf2-scout service removed."
