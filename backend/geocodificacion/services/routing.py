import copy
import hashlib
import json
import logging
import math

import requests
from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)

PERFILES = {
    "walking": "foot-walking",
    "driving": "driving-car",
    "cycling": "cycling-regular",
}


class RoutingServiceError(Exception):
    """Falla del proveedor de rutas o de su respuesta."""


class RoutingClient:
    """Cliente mínimo para HeiGIT/OpenRouteService Directions v2."""

    def __init__(self):
        self.enabled = bool(settings.ROUTING_ENABLED)
        self.api_key = (settings.ROUTING_API_KEY or "").strip()
        self.base_url = settings.ROUTING_BASE_URL.rstrip("/")
        self.timeout = settings.ROUTING_TIMEOUT
        self.cache_ttl = settings.ROUTING_CACHE_TTL

    @property
    def disponible(self):
        return self.enabled and bool(self.api_key)

    def calcular_ruta(self, puntos, perfil, volver_al_inicio=False):
        if not self.disponible:
            raise RoutingServiceError("El servicio de rutas no está configurado.")

        perfil_api = PERFILES.get(perfil)
        if not perfil_api:
            raise RoutingServiceError("Perfil de ruta inválido.")

        coordenadas = [
            [float(punto["lng"]), float(punto["lat"])] for punto in puntos
        ]
        orden = list(range(len(coordenadas)))
        if volver_al_inicio:
            coordenadas.append(list(coordenadas[0]))
            orden.append(0)

        clave = self._clave_cache(coordenadas, perfil, volver_al_inicio)
        cacheado = cache.get(clave)
        if cacheado is not None:
            return copy.deepcopy(cacheado)

        url = f"{self.base_url}/{perfil_api}/geojson"
        headers = {
            "Authorization": self.api_key,
            "Content-Type": "application/json",
            "Accept": "application/geo+json, application/json",
            "User-Agent": "GeoHuella/0.1 (educational routing)",
        }
        body = {
            "coordinates": coordenadas,
            "instructions": False,
            "units": "m",
        }

        try:
            response = requests.post(
                url,
                json=body,
                headers=headers,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            logger.warning("Routing provider no disponible: %s", type(exc).__name__)
            raise RoutingServiceError("No se pudo consultar el proveedor de rutas.") from exc

        if response.status_code != 200:
            logger.warning("Routing provider respondió HTTP %s", response.status_code)
            raise RoutingServiceError("El proveedor de rutas devolvió un error.")

        try:
            payload = response.json()
        except ValueError as exc:
            logger.warning("Routing provider devolvió JSON inválido")
            raise RoutingServiceError("El proveedor de rutas devolvió una respuesta inválida.") from exc

        resultado = self._normalizar(payload, orden)
        cache.set(clave, copy.deepcopy(resultado), self.cache_ttl)
        return resultado

    def _clave_cache(self, coordenadas, perfil, volver_al_inicio):
        firma = json.dumps(
            {
                "coordenadas": [
                    [round(lng, 6), round(lat, 6)] for lng, lat in coordenadas
                ],
                "perfil": perfil,
                "volver_al_inicio": bool(volver_al_inicio),
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        digest = hashlib.sha256(firma.encode("utf-8")).hexdigest()
        return f"ruta:v1:{digest}"

    @staticmethod
    def _numero_no_negativo(valor):
        if isinstance(valor, bool) or not isinstance(valor, (int, float)):
            return None
        numero = float(valor)
        if not math.isfinite(numero) or numero < 0:
            return None
        return numero

    def _normalizar(self, payload, orden):
        if not isinstance(payload, dict):
            raise RoutingServiceError("Respuesta de rutas inválida.")

        features = payload.get("features")
        if not isinstance(features, list) or len(features) != 1:
            raise RoutingServiceError("La respuesta de rutas no contiene una ruta única.")

        feature = features[0]
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            raise RoutingServiceError("La respuesta de rutas no es un Feature GeoJSON.")

        geometry = feature.get("geometry")
        if not isinstance(geometry, dict) or geometry.get("type") != "LineString":
            raise RoutingServiceError("La ruta no es una LineString GeoJSON.")

        coordinates = geometry.get("coordinates")
        if not isinstance(coordinates, list) or len(coordinates) < 2:
            raise RoutingServiceError("La ruta no tiene suficientes coordenadas.")

        for coordinate in coordinates:
            if not isinstance(coordinate, (list, tuple)) or len(coordinate) < 2:
                raise RoutingServiceError("La ruta contiene coordenadas inválidas.")
            lng, lat = coordinate[0], coordinate[1]
            if isinstance(lng, bool) or isinstance(lat, bool):
                raise RoutingServiceError("La ruta contiene coordenadas inválidas.")
            if not isinstance(lng, (int, float)) or not isinstance(lat, (int, float)):
                raise RoutingServiceError("La ruta contiene coordenadas inválidas.")
            lng, lat = float(lng), float(lat)
            if not math.isfinite(lng) or not math.isfinite(lat):
                raise RoutingServiceError("La ruta contiene coordenadas inválidas.")
            if not -180 <= lng <= 180 or not -90 <= lat <= 90:
                raise RoutingServiceError("La ruta contiene coordenadas fuera de rango.")

        properties = feature.get("properties") or {}
        summary = properties.get("summary") if isinstance(properties, dict) else None
        distancia = None
        duracion = None
        if isinstance(summary, dict):
            distancia = self._numero_no_negativo(summary.get("distance"))
            duracion = self._numero_no_negativo(summary.get("duration"))

        if distancia is None or duracion is None:
            segments = properties.get("segments") if isinstance(properties, dict) else None
            if isinstance(segments, list) and segments:
                distancias = []
                duraciones = []
                for segment in segments:
                    if not isinstance(segment, dict):
                        continue
                    d = self._numero_no_negativo(segment.get("distance"))
                    t = self._numero_no_negativo(segment.get("duration"))
                    if d is not None and t is not None:
                        distancias.append(d)
                        duraciones.append(t)
                if distancias and duraciones:
                    distancia = sum(distancias)
                    duracion = sum(duraciones)

        if distancia is None or duracion is None:
            raise RoutingServiceError("La respuesta de rutas no informa distancia y duración.")

        return {
            "ruta": {"type": "FeatureCollection", "features": [feature]},
            "distancia_metros": round(distancia, 1),
            "duracion_segundos": round(duracion),
            "orden": orden,
        }
