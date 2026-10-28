"""Cliente separado para la API pública de Georef (Argentina)."""

import hashlib
import json
import logging
import math

import requests
from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)


class GeorefServiceError(Exception):
    """Error al consultar Georef o respuesta inesperada."""


class GeorefClient:
    USER_AGENT = "piloto-mapa-backend/1.0 (+https://github.com/piloto-mapa)"

    def __init__(self, base_url=None, timeout=None, user_agent=None):
        self.base_url = (base_url or settings.GEOREF_BASE_URL).rstrip("/")
        self.timeout = timeout if timeout is not None else settings.GEOREF_TIMEOUT
        self.user_agent = user_agent or self.USER_AGENT

    def _get(self, path, params):
        url = f"{self.base_url}{path}"
        try:
            response = requests.get(
                url, params=params, timeout=self.timeout,
                headers={"User-Agent": self.user_agent},
            )
        except requests.RequestException as exc:
            logger.warning("Georef request failed: %s", type(exc).__name__)
            raise GeorefServiceError("timeout_or_network") from exc
        if response.status_code != 200:
            logger.warning("Georef HTTP %s (non-2xx)", response.status_code)
            raise GeorefServiceError("http_error")
        try:
            data = response.json()
        except ValueError as exc:
            logger.warning("Georef invalid JSON")
            raise GeorefServiceError("invalid_json") from exc
        if not isinstance(data, dict):
            raise GeorefServiceError("unexpected_response")
        return data

    def _is_finite_number(self, value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

    def provincias(self):
        cache_key = "georef:provincias"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        data = self._get("/provincias", {"campos": "nombre", "max": 25})
        items = data.get("provincias")
        if not isinstance(items, list):
            raise GeorefServiceError("unexpected_response")

        nombres = []
        for item in items:
            if isinstance(item, dict) and item.get("nombre"):
                nombres.append(str(item["nombre"]))
        nombres = sorted(set(nombres))

        cache.set(cache_key, nombres, getattr(settings, "PROVINCIAS_CACHE_TTL", 86400))
        return nombres

    def _cache_key_geocodificar(self, calle, numero, ciudad, provincia):
        payload = json.dumps(
            {"calle": calle, "numero": numero, "ciudad": ciudad, "provincia": provincia},
            sort_keys=True, ensure_ascii=False,
        )
        digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        return f"georef:geocodificar:{digest}"

    def geocodificar(self, calle, numero, ciudad, provincia):
        cache_key = self._cache_key_geocodificar(calle, numero, ciudad, provincia)
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        params = {
            "direccion": f"{calle} {numero}",
            "provincia": provincia,
            "localidad": ciudad,
            "max": 5,
        }
        data = self._get("/direcciones", params)
        direcciones = data.get("direcciones")
        if not isinstance(direcciones, list):
            raise GeorefServiceError("unexpected_response")

        resultados = []
        for item in direcciones:
            if not isinstance(item, dict):
                raise GeorefServiceError("unexpected_direction_item")

            ubic = item.get("ubicacion")
            if not isinstance(ubic, dict) or "lat" not in ubic or "lon" not in ubic:
                raise GeorefServiceError("unexpected_direction_location")
            lat = ubic["lat"]
            lon = ubic["lon"]
            if lat is not None and not self._is_finite_number(lat):
                raise GeorefServiceError("unexpected_direction_latitude")
            if lon is not None and not self._is_finite_number(lon):
                raise GeorefServiceError("unexpected_direction_longitude")
            if lat is None or lon is None:
                continue

            nomenclatura = item.get("nomenclatura")
            if nomenclatura is not None and not isinstance(nomenclatura, str):
                raise GeorefServiceError("unexpected_nomenclatura")
            direccion = nomenclatura if isinstance(nomenclatura, str) and nomenclatura.strip() else None

            def nombre_entidad(campo):
                entidad = item.get(campo)
                if entidad is None:
                    return None
                if not isinstance(entidad, dict):
                    raise GeorefServiceError(f"unexpected_{campo}")
                nombre = entidad.get("nombre")
                if nombre is not None and not isinstance(nombre, str):
                    raise GeorefServiceError(f"unexpected_{campo}_name")
                return nombre

            provincia_nombre = nombre_entidad("provincia")
            localidad_nombre = nombre_entidad("localidad_censal")
            if localidad_nombre is None:
                localidad_nombre = nombre_entidad("localidad")
            departamento_nombre = nombre_entidad("departamento")

            resultados.append({
                "lat": lat,
                "lng": lon,
                "direccion": direccion,
                "provincia": provincia_nombre,
                "localidad": localidad_nombre,
                "departamento": departamento_nombre,
                "aproximada": True,
            })
            if len(resultados) >= 5:
                break

        ttl = getattr(settings, "GEOCODIFICACION_CACHE_TTL", None)
        if ttl is None:
            ttl = getattr(settings, "PROVINCIAS_CACHE_TTL", 86400)
        cache.set(cache_key, resultados, ttl)
        return resultados

    def ubicar(self, lat, lng):
        data = self._get("/ubicacion", {"lat": lat, "lon": lng})
        if "ubicacion" not in data:
            raise GeorefServiceError("unexpected_response")
        ubic = data.get("ubicacion")
        if ubic is None:
            return {
                "lat": lat,
                "lng": lng,
                "direccion": None,
                "provincia": None,
                "departamento": None,
            }
        if not isinstance(ubic, dict):
            raise GeorefServiceError("unexpected_response")

        def nombre_entidad(campo):
            entidad = ubic.get(campo)
            if entidad is None:
                return None
            if not isinstance(entidad, dict):
                raise GeorefServiceError(f"unexpected_{campo}")
            nombre = entidad.get("nombre")
            if nombre is not None and not isinstance(nombre, str):
                raise GeorefServiceError(f"unexpected_{campo}_name")
            return nombre

        provincia_nombre = nombre_entidad("provincia")
        departamento_nombre = nombre_entidad("departamento")
        gobierno_nombre = nombre_entidad("gobierno_local")

        if gobierno_nombre and provincia_nombre:
            direccion = f"{gobierno_nombre}, {provincia_nombre}"
        elif provincia_nombre:
            direccion = provincia_nombre
        elif gobierno_nombre:
            direccion = gobierno_nombre
        else:
            direccion = None

        return {
            "lat": lat,
            "lng": lng,
            "direccion": direccion,
            "provincia": provincia_nombre,
            "departamento": departamento_nombre,
        }
