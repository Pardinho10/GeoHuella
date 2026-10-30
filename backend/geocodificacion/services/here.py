"""Cliente para HERE Geocoding & Search (fallback opcional)."""

import hashlib
import json
import logging
import math
import re
import time
import unicodedata

import requests
from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)

GENERIC_STREET_WORDS = {
    "calle", "avenida", "av", "boulevard", "bulevar", "pasaje", "camino",
    "ruta", "rp", "rn", "autopista", "colectora",
}


class HereServiceError(Exception):
    """Error al consultar HERE o respuesta inesperada."""


class HereClient:
    USER_AGENT = "piloto-mapa-backend/1.0"

    def __init__(self, base_url=None, timeout=None, api_key=None):
        self.base_url = (base_url or getattr(settings, "HERE_BASE_URL", "https://geocode.search.hereapi.com/v1/geocode")).rstrip("/")
        self.timeout = timeout if timeout is not None else getattr(settings, "HERE_TIMEOUT", 8)
        self.api_key = api_key if api_key is not None else getattr(settings, "HERE_API_KEY", "")
        self.enabled = bool(getattr(settings, "HERE_ENABLED", False))

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
    def _street_ok(cls, street, calle):
        street_tokens = cls._street_tokens(street)
        calle_tokens = cls._street_tokens(calle)
        return bool(street_tokens) and street_tokens == calle_tokens

    @staticmethod
    def _place_variants(value):
        normalized = HereClient._normalize(value)
        variants = {normalized}
        for prefix in ("municipio de ", "ciudad de ", "partido de ", "departamento "):
            if normalized.startswith(prefix):
                variants.add(normalized[len(prefix):])
        if normalized in {"ciudad autonoma de buenos aires", "caba", "capital federal"}:
            variants.add("buenos aires")
        return {variant for variant in variants if variant}

    @classmethod
    def _territory_ok(cls, address, ciudad, provincia):
        if not isinstance(address, dict):
            return False
        if cls._normalize(address.get("state")) != cls._normalize(provincia):
            return False
        requested = cls._place_variants(ciudad)
        for key in ("city", "town", "village", "municipality", "county", "district"):
            value = address.get(key)
            if isinstance(value, str) and requested & cls._place_variants(value):
                return True
        return False

    @staticmethod
    def _finite(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

    @staticmethod
    def _house_number(address):
        raw = address.get("houseNumber") if isinstance(address, dict) else None
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
    def _department(address):
        if not isinstance(address, dict):
            return None
        for key in ("district", "county"):
            value = address.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    @staticmethod
    def _score(item):
        scoring = item.get("scoring") if isinstance(item, dict) else None
        if not isinstance(scoring, dict):
            return None
        value = scoring.get("queryScore")
        return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None

    @staticmethod
    def _cache_key(calle, numero, ciudad, provincia):
        payload = json.dumps(
            {"calle": calle, "numero": numero, "ciudad": ciudad, "provincia": provincia},
            sort_keys=True, ensure_ascii=False,
        )
        digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        return f"here:exact:{digest}"

    def search_exact(self, calle, numero, ciudad, provincia):
        if not self.enabled or not self.api_key:
            return []

        cache_key = self._cache_key(calle, numero, ciudad, provincia)
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        try:
            requested_number = int(str(numero).strip())
        except (TypeError, ValueError):
            return []

        params = {
            "q": f"{calle} {numero}, {ciudad}, {provincia}, Argentina",
            "limit": 5,
            "lang": "es",
            "in": "countryCode:ARG",
            "apiKey": self.api_key,
        }
        max_retries = max(0, min(int(getattr(settings, "HERE_MAX_RETRIES", 1)), 3))
        retry_delay = max(0.0, min(float(getattr(settings, "HERE_RETRY_DELAY", 1.0)), 5.0))
        response = None
        for intento in range(max_retries + 1):
            try:
                response = requests.get(
                    self.base_url,
                    params=params,
                    headers={"User-Agent": self.USER_AGENT},
                    timeout=self.timeout,
                )
            except requests.RequestException as exc:
                logger.warning("HERE request failed: %s", type(exc).__name__)
                raise HereServiceError("timeout_or_network") from exc

            if response.status_code != 429 or intento >= max_retries:
                break

            espera = retry_delay
            retry_after = response.headers.get("Retry-After") if response.headers else None
            try:
                espera = min(max(float(retry_after), 0.0), 3.0)
            except (TypeError, ValueError):
                pass
            logger.warning("HERE HTTP 429; reintentando en %.1f s", espera)
            if espera:
                time.sleep(espera)

        if response.status_code != 200:
            logger.warning("HERE HTTP %s (non-2xx)", response.status_code)
            raise HereServiceError("http_error")

        try:
            data = response.json()
        except ValueError as exc:
            logger.warning("HERE invalid JSON")
            raise HereServiceError("invalid_json") from exc

        if not isinstance(data, dict):
            raise HereServiceError("unexpected_response")
        if "error" in data:
            logger.warning("HERE returned an error payload")
            raise HereServiceError("provider_error")
        items = data.get("items")
        if not isinstance(items, list):
            raise HereServiceError("unexpected_response")

        min_score = float(getattr(settings, "HERE_MIN_SCORE", 0.8))
        results = []
        for item in items:
            if not isinstance(item, dict):
                continue
            if item.get("resultType") != "houseNumber":
                continue
            house_number_type = item.get("houseNumberType")
            if house_number_type not in {"PA", "MPA", "interpolated"}:
                continue
            score = self._score(item)
            if score is not None and score < min_score:
                continue

            address = item.get("address")
            if not isinstance(address, dict):
                continue
            if not self._street_ok(address.get("street"), calle):
                continue
            if not self._territory_ok(address, ciudad, provincia):
                continue
            number = self._house_number(address)
            if number != requested_number:
                continue

            position = item.get("position")
            if not isinstance(position, dict):
                continue
            lat = position.get("lat")
            lng = position.get("lng")
            if not self._finite(lat) or not self._finite(lng):
                continue

            title = item.get("title")
            label = address.get("label")
            direccion = title if isinstance(title, str) and title.strip() else (
                label.strip() if isinstance(label, str) and label.strip() else None
            )
            results.append({
                "lat": lat,
                "lng": lng,
                "direccion": direccion,
                "provincia": address.get("state"),
                "localidad": self._locality(address),
                "departamento": self._department(address),
                "aproximada": True,
                "_numero": number,
                "_interpolada": house_number_type == "interpolated",
                # Nombre corto del proveedor (interno: `publico()` lo descarta).
                "_nombre": title.strip() if isinstance(title, str) and title.strip() else None,
            })
            if len(results) >= 5:
                break

        ttl = getattr(settings, "HERE_CACHE_TTL", 86400)
        cache.set(cache_key, results, ttl)
        return results

    @staticmethod
    def publico(candidate):
        return {key: value for key, value in candidate.items() if not key.startswith("_")}
