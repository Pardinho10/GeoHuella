#!/usr/bin/env bash
set -uo pipefail

for name in frontend backend; do
  if [[ "$name" == frontend ]]; then
    url="http://localhost:5174/"
  else
    url="http://localhost:8001/api/salud/"
  fi
  result="$(curl -sS --max-time 3 -o /tmp/geohuella-status-body.$$ -w '%{http_code}' "$url" 2>/dev/null || true)"
  if [[ "$result" == "200" ]]; then
    printf '%-8s OK (%s) ' "$name" "$result"
    if [[ "$name" == backend ]]; then cat "/tmp/geohuella-status-body.$$"; else echo "$url"; fi
  else
    printf '%-8s NO DISPONIBLE (%s) %s\n' "$name" "${result:-000}" "$url"
  fi
done
rm -f "/tmp/geohuella-status-body.$$"

if command -v systemctl >/dev/null 2>&1 && systemctl --user is-enabled geohuella-backend.service >/dev/null 2>&1; then
  printf 'servicio  %s\n' "$(systemctl --user is-active geohuella-backend.service 2>/dev/null || echo unknown)"
fi
