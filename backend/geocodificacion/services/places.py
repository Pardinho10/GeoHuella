"""Consulta de lugares cercanos con HERE Browse (solo backend)."""

import hashlib
import json
import logging
import math
import time

import requests
from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)


class HerePlacesServiceError(Exception):
    """Error al consultar lugares cercanos."""


class HerePlacesClient:
    USER_AGENT = "GeoHuella/0.1 (educational places lookup)"

    def __init__(self):
        self.enabled = bool(getattr(settings, "HERE_PLACES_ENABLED", False))
        self.api_key = (getattr(settings, "HERE_API_KEY", "") or "").strip()
        self.base_url = getattr(
            settings,
            "HERE_PLACES_URL",
            "https://browse.search.hereapi.com/v1/browse",
        ).rstrip("/")
        self.timeout = getattr(settings, "HERE_PLACES_TIMEOUT", 8)
        self.cache_ttl = getattr(settings, "HERE_PLACES_CACHE_TTL", 1800)

    @property
    def disponible(self):
        return self.enabled and bool(self.api_key)

    @staticmethod
    def _finite(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

    @staticmethod
    def _cache_key(lat, lng, limit):
        payload = json.dumps(
            {"lat": round(float(lat), 5), "lng": round(float(lng), 5), "limit": int(limit)},
            sort_keys=True,
        )
        digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        return f"here:lugares:{digest}"

    @staticmethod
    def _categoria(item):
        categories = item.get("categories") if isinstance(item, dict) else None
        if not isinstance(categories, list):
            return None
        nombres = []
        for categoria in categories:
            if not isinstance(categoria, dict):
                continue
            nombre = categoria.get("name")
            if isinstance(nombre, str) and nombre.strip():
                nombres.append(nombre.strip())
        if not nombres:
            return None
        for categoria in categories:
            if isinstance(categoria, dict) and categoria.get("primary") is True:
                nombre = categoria.get("name")
                if isinstance(nombre, str) and nombre.strip():
                    return nombre.strip()
        return nombres[0]

    def buscar(self, lat, lng, limit=5):
        if not self.disponible:
            raise HerePlacesServiceError("El servicio de lugares cercanos no está configurado.")

        clave = self._cache_key(lat, lng, limit)
        cacheado = cache.get(clave)
        if isinstance(cacheado, list):
            return cacheado

        params = {
            "at": f"{float(lat)},{float(lng)}",
            "limit": int(limit),
            "lang": "es",
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
                logger.warning("HERE Places request failed: %s", type(exc).__name__)
                raise HerePlacesServiceError("No se pudo consultar HERE.") from exc

            if response.status_code != 429 or intento >= max_retries:
                break

            espera = retry_delay
            retry_after = response.headers.get("Retry-After") if response.headers else None
            try:
                espera = min(max(float(retry_after), 0.0), 3.0)
            except (TypeError, ValueError):
                pass
            logger.warning("HERE Places HTTP 429; reintentando en %.1f s", espera)
            if espera:
                time.sleep(espera)

        if response.status_code != 200:
            logger.warning("HERE Places HTTP %s (non-2xx)", response.status_code)
            raise HerePlacesServiceError("El proveedor de lugares devolvió un error.")

        try:
            data = response.json()
        except ValueError as exc:
            logger.warning("HERE Places devolvió JSON inválido")
            raise HerePlacesServiceError("Respuesta inválida del proveedor de lugares.") from exc

        if not isinstance(data, dict):
            raise HerePlacesServiceError("Respuesta inválida del proveedor de lugares.")
        if "error" in data:
            logger.warning("HERE Places devolvió un error")
            raise HerePlacesServiceError("El proveedor de lugares devolvió un error.")

        items = data.get("items")
        if not isinstance(items, list):
            raise HerePlacesServiceError("Respuesta inválida del proveedor de lugares.")

        lugares = []
        for item in items:
            if not isinstance(item, dict) or item.get("resultType") != "place":
                continue
            title = item.get("title")
            if not isinstance(title, str) or not title.strip():
                continue
            position = item.get("position")
            if not isinstance(position, dict):
                continue
            item_lat = position.get("lat")
            item_lng = position.get("lng")
            if not self._finite(item_lat) or not self._finite(item_lng):
                continue

            distance = item.get("distance")
            if not self._finite(distance) or distance < 0:
                distance = None
            address = item.get("address")
            direccion = None
            if isinstance(address, dict):
                label = address.get("label")
                if isinstance(label, str) and label.strip():
                    direccion = label.strip()

            lugares.append({
                "id": item.get("id"),
                "nombre": title.strip(),
                "categoria": self._categoria(item),
                "distancia_metros": round(distance, 1) if distance is not None else None,
                "direccion": direccion,
                "lat": float(item_lat),
                "lng": float(item_lng),
            })
            if len(lugares) >= int(limit):
                break

        cache.set(clave, lugares, self.cache_ttl)
        return lugares
