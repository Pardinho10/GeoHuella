#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  trap - INT TERM EXIT
  if [[ -n "$BACKEND_PID" ]]; then kill "$BACKEND_PID" 2>/dev/null || true; fi
  if [[ -n "$FRONTEND_PID" ]]; then kill "$FRONTEND_PID" 2>/dev/null || true; fi
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

cd "$ROOT"
if curl -fsS --max-time 2 http://127.0.0.1:8001/api/salud/ >/dev/null 2>&1; then
  echo "Backend disponible en http://localhost:8001."
else
  if ! curl -sS --max-time 1 http://127.0.0.1:8001/api/salud/ >/dev/null 2>&1; then
    "$ROOT/backend/.venv/bin/python" "$ROOT/backend/manage.py" runserver localhost:8001 &
    BACKEND_PID=$!
  else
    echo "El puerto 8001 ya está ocupado, pero no responde la API de GeoHuella." >&2
    exit 1
  fi
fi

if curl -fsS --max-time 2 http://127.0.0.1:5174/ >/dev/null 2>&1; then
  echo "Frontend disponible en http://localhost:5174."
else
  if ! curl -sS --max-time 1 http://127.0.0.1:5174/ >/dev/null 2>&1; then
    "$ROOT/frontend/node_modules/.bin/vite" --host localhost --port 5174 &
    FRONTEND_PID=$!
  else
    echo "El puerto 5174 ya está ocupado, pero no responde Vite." >&2
    exit 1
  fi
fi

printf '\nGeoHuella en desarrollo\nFrontend: http://localhost:5174\nBackend:  http://localhost:8001\nCtrl+C detiene los procesos iniciados por este script.\n\n'

while true; do
  if [[ -n "$BACKEND_PID" ]] && ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "El backend finalizó. Revisa el error mostrado arriba." >&2
    exit 1
  fi
  if [[ -n "$FRONTEND_PID" ]] && ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "El frontend finalizó; revisa si el puerto 5174 está ocupado." >&2
    exit 1
  fi
  sleep 2
done
