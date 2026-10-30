#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="$ROOT/backend/.venv/bin/python"

if [[ ! -x "$PYTHON" ]]; then
  echo "No se encontró $PYTHON. Crea el entorno e instala backend/requirements.txt." >&2
  exit 1
fi

exec "$PYTHON" "$ROOT/backend/manage.py" runserver 127.0.0.1:8001
