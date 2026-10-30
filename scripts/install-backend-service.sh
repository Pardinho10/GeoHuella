#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
LINK="$HOME/.local/share/geohuella"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/geohuella-backend.service"

mkdir -p "$(dirname "$LINK")" "$UNIT_DIR"
ln -sfn "$ROOT" "$LINK"

cat > "$UNIT" <<'EOF'
[Unit]
Description=GeoHuella Django backend development server
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/.local/share/geohuella
ExecStart=%h/.local/share/geohuella/scripts/backend-service.sh
Restart=on-failure
RestartSec=3
KillSignal=SIGINT
TimeoutStopSec=10

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now geohuella-backend.service

if command -v loginctl >/dev/null 2>&1; then
  loginctl enable-linger "$USER" 2>/dev/null || true
fi

printf 'Backend GeoHuella instalado y activado.\n'
printf 'Estado: systemctl --user status geohuella-backend.service\n'
printf 'Logs:   journalctl --user -u geohuella-backend.service -f\n'
