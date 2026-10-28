"""Cliente OSM Nominatim para geocodificación y alturas cercanas."""

import hashlib
import json
import logging
import math
import os
import re
import tempfile
import threading
import time
import unicodedata

import requests
from django.conf import settings
from django.core.cache import cache

try:  # Linux/macOS: lock compartido entre procesos de un mismo host.
    import fcntl
except ImportError:  # pragma: no cover - Windows
    fcntl = None

logger = logging.getLogger(__name__)

RATE_LIMIT_SECONDS = float(getattr(settings, "NOMINATIM_RATE_LIMIT_SECONDS", 1.1))
GENERIC_STREET_WORDS = {
    "calle", "avenida", "av", "boulevard", "bulevar", "pasaje", "camino",
    "ruta", "rp", "rn", "autopista", "colectora",
}


class NominatimServiceError(Exception):
    """Error al consultar un servicio OSM o respuesta inesperada."""


class NominatimClient:
    USER_AGENT = "piloto-mapa-backend/1.0 (contact: piloto-mapa)"

    _lock = threading.Lock()
    _last_request_at = 0.0

    def __init__(self, base_url=None, timeout=None, user_agent=None, email=None):
        self.base_url = (base_url or getattr(settings, "NOMINATIM_BASE_URL", "https://nominatim.openstreetmap.org")).rstrip("/")
        self.timeout = timeout if timeout is not None else getattr(settings, "NOMINATIM_TIMEOUT", 8)
        self.user_agent = user_agent or getattr(settings, "NOMINATIM_USER_AGENT", self.USER_AGENT)
        self.email = email if email is not None else getattr(settings, "NOMINATIM_EMAIL", "")

    # ---------- transporte y normalización ----------

    def _respect_rate_limit(self):
        """Aplica 1 req/s entre procesos del mismo host.

        El lock de archivo evita que dos workers de Django consulten Nominatim
        al mismo tiempo. Si `fcntl` no está disponible se degrada al lock de
        proceso. Un timestamp persistido en disco mantiene el intervalo entre
        procesos; con un cache/Redis compartido también se podría usar, pero
        el archivo funciona sin infraestructura adicional.
        """
        if RATE_LIMIT_SECONDS <= 0:
            return

        with self._lock:
            lock_path = getattr(settings, "NOMINATIM_RATE_LOCK_FILE", "") or os.path.join(
                tempfile.gettempdir(), "piloto-mapa-nominatim.lock"
            )
            timestamp_path = f"{lock_path}.timestamp"

            if fcntl is not None:
                try:
                    with open(lock_path, "a+", encoding="utf-8") as lock_file:
                        fcntl.flock(lock_file, fcntl.LOCK_EX)
                        try:
                            last = 0.0
                            try:
                                with open(timestamp_path, "r", encoding="utf-8") as ts:
                                    last = float(ts.read().strip())
                            except (OSError, ValueError):
                                last = 0.0
                            now = time.time()
                            wait = RATE_LIMIT_SECONDS - (now - last)
                            if wait > 0:
                                time.sleep(wait)
                            with open(timestamp_path, "w", encoding="utf-8") as ts:
                                ts.write(f"{time.time():.6f}")
                        finally:
                            fcntl.flock(lock_file, fcntl.LOCK_UN)
                    return
                except OSError:
                    logger.warning("No se pudo usar el lock de archivo de Nominatim; se usa lock local")

            now = time.monotonic()
            wait = RATE_LIMIT_SECONDS - (now - self._last_request_at)
            if wait > 0:
                time.sleep(wait)
            self._last_request_at = time.monotonic()

    def _get(self, params):
        self._respect_rate_limit()
        url = f"{self.base_url}/search"
        headers = {"User-Agent": self.user_agent}
        try:
            response = requests.get(url, params=params, headers=headers, timeout=self.timeout)
        except requests.RequestException as exc:
            logger.warning("Nominatim request failed: %s", type(exc).__name__)
            raise NominatimServiceError("timeout_or_network") from exc
        if response.status_code != 200:
            logger.warning("Nominatim HTTP %s (non-2xx)", response.status_code)
            raise NominatimServiceError("http_error")
        try:
            data = response.json()
        except ValueError as exc:
            logger.warning("Nominatim invalid JSON")
            raise NominatimServiceError("invalid_json") from exc
        if not isinstance(data, list):
            raise NominatimServiceError("unexpected_response")
        return data

    @staticmethod
    def _normalize(value):
        if not isinstance(value, str):
            return ""
        value = unicodedata.normalize("NFKD", value)
        value = "".join(ch for ch in value if not unicodedata.combining(ch))
        value = value.casefold()
        value = re.sub(r"[^a-z0-9]+", " ", value)
        return " ".join(value.split())

    @classmethod
    def _street_tokens(cls, value):
        return [token for token in cls._normalize(value).split() if token not in GENERIC_STREET_WORDS]

    @classmethod
    def _street_name(cls, value):
        if not isinstance(value, str):
            return ""
        words = re.findall(r"[^\s,]+", value)
        kept = [word for word in words if cls._normalize(word) not in GENERIC_STREET_WORDS]
        return " ".join(kept).strip(" ,.")

    @staticmethod
    def _place_variants(value):
        normalized = NominatimClient._normalize(value)
        variants = {normalized}
        for prefix in ("municipio de ", "ciudad de ", "partido de ", "departamento "):
            if normalized.startswith(prefix):
                variants.add(normalized[len(prefix):])
        if normalized in {"ciudad autonoma de buenos aires", "caba", "capital federal"}:
            variants.add("buenos aires")
        return {variant for variant in variants if variant}

    @classmethod
    def _road_ok(cls, road, calle):
        road_tokens = cls._street_tokens(road)
        calle_tokens = cls._street_tokens(calle)
        return bool(road_tokens) and road_tokens == calle_tokens

    @staticmethod
    def _house_number(address):
        raw = address.get("house_number") if isinstance(address, dict) else None
        if raw is None:
            return None
        match = re.match(r"\s*(\d+)", str(raw))
        return int(match.group(1)) if match else None

    @staticmethod
    def _locality(address):
        if not isinstance(address, dict):
            return None
        for key in ("city", "town", "village", "municipality", "county"):
            value = address.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    @staticmethod
    def _province(address):
        if not isinstance(address, dict):
            return None
        for key in ("state", "province", "region"):
            value = address.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    @classmethod
    def _territory_ok(cls, item, ciudad, provincia):
        address = item.get("address") if isinstance(item, dict) else None
        if not isinstance(address, dict):
            return False
        if cls._normalize(cls._province(address)) != cls._normalize(provincia):
            return False
        requested_variants = cls._place_variants(ciudad)
        for key in ("city", "town", "village", "municipality", "county", "state_district"):
            value = address.get(key)
            if isinstance(value, str) and requested_variants & cls._place_variants(value):
                return True
        return False

    @staticmethod
    def _finite(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

    @classmethod
    def _to_candidate(cls, item):
        if not isinstance(item, dict):
            return None
        try:
            lat = float(item.get("lat"))
            lng = float(item.get("lon"))
        except (TypeError, ValueError):
            return None
        if not cls._finite(lat) or not cls._finite(lng):
            return None
        address = item.get("address") if isinstance(item.get("address"), dict) else {}
        number = cls._house_number(address)
        if number is None:
            return None
        road = address.get("road") or address.get("street")
        locality = cls._locality(address)
        province = cls._province(address)
        department = address.get("state_district") or address.get("county")
        department = department.strip() if isinstance(department, str) and department.strip() else None
        display = item.get("display_name")
        direccion = display.strip() if isinstance(display, str) and display.strip() else ", ".join(
            part for part in (f"{road} {number}" if road else str(number), locality, province) if part
        )
        return {
            "lat": lat,
            "lng": lng,
            "direccion": direccion,
            "provincia": province,
            "localidad": locality,
            "departamento": department,
            "aproximada": True,
            "_numero": number,
        }

    @staticmethod
    def _strip_internal(candidate):
        return {key: value for key, value in candidate.items() if not key.startswith("_")}

    @staticmethod
    def _cache_key(kind, calle, numero, ciudad, provincia):
        payload = json.dumps(
            {"kind": kind, "calle": calle, "numero": numero, "ciudad": ciudad, "provincia": provincia},
            sort_keys=True,
            ensure_ascii=False,
        )
        digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        return f"nominatim:{kind}:{digest}"

    # ---------- búsqueda exacta ----------

    def _filtrar_exactos(self, raw, calle, ciudad, provincia, requested_number):
        resultados = []
        for item in raw:
            address = item.get("address") if isinstance(item, dict) and isinstance(item.get("address"), dict) else {}
            if not self._road_ok(address.get("road") or address.get("street"), calle):
                continue
            if not self._territory_ok(item, ciudad, provincia):
                continue
            candidate = self._to_candidate(item)
            if candidate is None or candidate["_numero"] != requested_number:
                continue
            resultados.append(candidate)
            if len(resultados) >= 5:
                break
        return resultados

    def search_exact(self, calle, numero, ciudad, provincia):
        cache_key = self._cache_key("exact", calle, numero, ciudad, provincia)
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        try:
            requested_number = int(str(numero).strip())
        except (TypeError, ValueError):
            return []

        street_name = self._street_name(calle)
        if not street_name:
            return []

        params = {
            "street": f"{requested_number} {street_name}",
            "city": ciudad,
            "state": provincia,
            "country": "Argentina",
            "format": "jsonv2",
            "addressdetails": 1,
            "limit": 5,
        }
        if self.email:
            params["email"] = self.email

        raw = self._get(params)
        results = self._filtrar_exactos(raw, calle, ciudad, provincia, requested_number)

        # Segundo intento: si los filtros de ciudad/provincia de Nominatim no
        # encontraron la altura, buscar el número en todo el país y validar el
        # territorio después. Cubre localidades cuyo nombre no coincide
        # exactamente con el campo `city` de OpenStreetMap.
        if not results:
            params_nacional = {
                "street": f"{requested_number} {street_name}",
                "country": "Argentina",
                "format": "jsonv2",
                "addressdetails": 1,
                "limit": 40,
            }
            if self.email:
                params_nacional["email"] = self.email
            raw_nacional = self._get(params_nacional)
            results = self._filtrar_exactos(
                raw_nacional, calle, ciudad, provincia, requested_number
            )

        cleaned = [self._strip_internal(candidate) for candidate in results]
        ttl = getattr(settings, "GEOCODIFICACION_CACHE_TTL", 86400)
        cache.set(cache_key, cleaned, ttl)
        return cleaned

    # ---------- sugerencias cercanas ----------

    def search_nearby(self, calle, numero, ciudad, provincia):
        cache_key = self._cache_key("nearby", calle, numero, ciudad, provincia)
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        try:
            requested_number = int(str(numero).strip())
        except (TypeError, ValueError):
            return []

        # A controlled set of nearby house numbers on the same street.
        # This keeps the public Nominatim usage bounded to a handful of
        # one-per-second requests, with every answer cached by search_exact.
        # The budget prevents a cold 404 from blocking a worker indefinitely.
        offsets = (-1, 1, -2, 2, -10, 10, -100, 100)
        budget = float(getattr(settings, "NOMINATIM_NEARBY_BUDGET_SECONDS", 6.0))
        started_at = time.monotonic()
        results = []
        seen = set()
        for offset in offsets:
            if budget > 0 and (time.monotonic() - started_at) >= budget:
                logger.info("Presupuesto de sugerencias cercanas agotado")
                break
            candidate_number = requested_number + offset
            if candidate_number <= 0:
                continue
            try:
                candidates = self.search_exact(calle, str(candidate_number), ciudad, provincia)
            except NominatimServiceError:
                break
            for candidate in candidates:
                key = (round(candidate["lat"], 6), round(candidate["lng"], 6), candidate["direccion"])
                if key in seen:
                    continue
                seen.add(key)
                results.append(candidate)
                if len(results) >= 5:
                    break
            if len(results) >= 5:
                break

        ttl = getattr(settings, "GEOCODIFICACION_CACHE_TTL", 86400)
        cache.set(cache_key, results, ttl)
        return results
