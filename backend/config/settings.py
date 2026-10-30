import os
from pathlib import Path
from decouple import config, Csv

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = config("DJANGO_SECRET_KEY", default=config("SECRET_KEY", default="django-insecure-dev-key-change-me"))
DEBUG = config("DJANGO_DEBUG", default=config("DEBUG", default=True, cast=bool), cast=bool)
ALLOWED_HOSTS = config("ALLOWED_HOSTS", default="localhost,127.0.0.1", cast=Csv())

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.sessions",
    "rest_framework",
    "corsheaders",
    "geocodificacion",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

# No database of business; Django needs a default DB for tests/admin-less operation.
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

# Cache: configurable backend; default locmem for dev/tests.
CACHES = {
    "default": {
        "BACKEND": config(
            "CACHE_BACKEND",
            default="django.core.cache.backends.locmem.LocMemCache",
        ),
        "LOCATION": config("CACHE_LOCATION", default="piloto-mapa"),
        "TIMEOUT": config("CACHE_DEFAULT_TIMEOUT", default=300, cast=int),
    }
}

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "EXCEPTION_HANDLER": "geocodificacion.exceptions.custom_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": config("THROTTLE_RATE", default="30/min"),
    },
}

CORS_ALLOW_ALL_ORIGINS = config("CORS_ALLOW_ALL", default=False, cast=bool)
CORS_ALLOWED_ORIGINS = config("CORS_ALLOWED_ORIGINS", default="", cast=Csv())

GEOREF_BASE_URL = config(
    "GEOREF_BASE_URL", default="https://apis.datos.gob.ar/georef/api/v2.0"
)
GEOREF_TIMEOUT = config("GEOREF_TIMEOUT", default=8, cast=int)
NOMINATIM_BASE_URL = config("NOMINATIM_BASE_URL", default="https://nominatim.openstreetmap.org")
NOMINATIM_TIMEOUT = config("NOMINATIM_TIMEOUT", default=8, cast=int)
NOMINATIM_USER_AGENT = config(
    "NOMINATIM_USER_AGENT",
    default="GeoHuella/0.1 (educational address lookup; https://www.openstreetmap.org/copyright)",
)
NOMINATIM_RATE_LIMIT_SECONDS = config("NOMINATIM_RATE_LIMIT_SECONDS", default=1.1, cast=float)
NOMINATIM_NEARBY_BUDGET_SECONDS = config("NOMINATIM_NEARBY_BUDGET_SECONDS", default=6.0, cast=float)
NOMINATIM_RATE_LOCK_FILE = config("NOMINATIM_RATE_LOCK_FILE", default="")

# HERE Geocoding & Search (fallback opcional, solo backend).
HERE_ENABLED = config("HERE_ENABLED", default=False, cast=bool)
HERE_API_KEY = config("HERE_API_KEY", default="")
HERE_BASE_URL = config("HERE_BASE_URL", default="https://geocode.search.hereapi.com/v1/geocode")
HERE_TIMEOUT = config("HERE_TIMEOUT", default=8, cast=int)
HERE_MIN_SCORE = config("HERE_MIN_SCORE", default=0.8, cast=float)
HERE_MAX_RETRIES = config("HERE_MAX_RETRIES", default=1, cast=int)
HERE_RETRY_DELAY = config("HERE_RETRY_DELAY", default=1.0, cast=float)
HERE_CACHE_TTL = config("HERE_CACHE_TTL", default=86400, cast=int)

# Lugares cercanos (HERE Browse). Caché corta; no persistencia de resultados.
HERE_PLACES_ENABLED = config("HERE_PLACES_ENABLED", default=False, cast=bool)
HERE_PLACES_URL = config(
    "HERE_PLACES_URL",
    default="https://browse.search.hereapi.com/v1/browse",
)
HERE_PLACES_TIMEOUT = config("HERE_PLACES_TIMEOUT", default=8, cast=int)
HERE_PLACES_CACHE_TTL = config("HERE_PLACES_CACHE_TTL", default=1800, cast=int)

# Rutas: HeiGIT/OpenRouteService Directions v2 (solo backend).
ROUTING_ENABLED = config("ROUTING_ENABLED", default=False, cast=bool)
ROUTING_API_KEY = config("ROUTING_API_KEY", default="")
ROUTING_BASE_URL = config(
    "ROUTING_BASE_URL",
    default="https://api.heigit.org/openrouteservice/v2/directions",
)
ROUTING_OPTIMIZATION_URL = config(
    "ROUTING_OPTIMIZATION_URL",
    default="https://api.heigit.org/vroom/v0",
)
ROUTING_TIMEOUT = config("ROUTING_TIMEOUT", default=10, cast=int)
ROUTING_CACHE_TTL = config("ROUTING_CACHE_TTL", default=300, cast=int)

PROVINCIAS_CACHE_TTL = config("PROVINCIAS_CACHE_TTL", default=86400, cast=int)
GEOCODIFICACION_CACHE_TTL = config("GEOCODIFICACION_CACHE_TTL", default=86400, cast=int)

# Importación masiva (v0.2.0).
# `IMPORT_MAX_FILAS` es el tope por importación y lo aplica el cliente;
# `GEOCODIFICAR_LOTE_MAX` es el tope real por solicitud del endpoint de lote.
IMPORT_MAX_FILAS = config("IMPORT_MAX_FILAS", default=100, cast=int)
GEOCODIFICAR_LOTE_MAX = config("GEOCODIFICAR_LOTE_MAX", default=10, cast=int)

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
TIME_ZONE = "America/Argentina/Buenos_Aires"
LANGUAGE_CODE = "es-ar"
