"""Versión de la aplicación, leída desde el archivo VERSION de la raíz."""

from pathlib import Path

ARCHIVO_VERSION = Path(__file__).resolve().parents[2] / "VERSION"


def _leer_version() -> str:
    try:
        version = ARCHIVO_VERSION.read_text(encoding="utf-8").strip()
    except OSError:
        return "0.0.0"
    return version or "0.0.0"


VERSION = _leer_version()
