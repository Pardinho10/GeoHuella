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
    """Cliente mínimo para HeiGIT Directions v2 y optimización VROOM."""

    def __init__(self):
        self.enabled = bool(settings.ROUTING_ENABLED)
        self.api_key = (settings.ROUTING_API_KEY or "").strip()
        self.base_url = settings.ROUTING_BASE_URL.rstrip("/")
        self.optimization_url = settings.ROUTING_OPTIMIZATION_URL.rstrip("/")
        self.timeout = settings.ROUTING_TIMEOUT
        self.cache_ttl = settings.ROUTING_CACHE_TTL

    @property
    def disponible(self):
        return self.enabled and bool(self.api_key)

    def calcular_ruta(self, puntos, perfil, volver_al_inicio=False, optimizar=False):
        if not self.disponible:
            raise RoutingServiceError("El servicio de rutas no está configurado.")

        perfil_api = PERFILES.get(perfil)
        if not perfil_api:
            raise RoutingServiceError("Perfil de ruta inválido.")

        if optimizar:
            orden = self._orden_optimizado(
                puntos, perfil, perfil_api, volver_al_inicio
            )
        else:
            orden = list(range(len(puntos)))
            if volver_al_inicio:
                orden.append(0)

        coordenadas = [
            [float(puntos[indice]["lng"]), float(puntos[indice]["lat"])]
            for indice in orden
        ]

        clave = self._clave_cache(coordenadas, perfil, volver_al_inicio)
        cacheado = cache.get(clave)
        if cacheado is not None:
            return copy.deepcopy(cacheado)

        url = f"{self.base_url}/{perfil_api}/geojson"
        body = {
            "coordinates": coordenadas,
            "instructions": False,
            "units": "m",
        }
        payload = self._post(url, body, accept="application/geo+json, application/json")
        resultado = self._normalizar(payload, orden)
        cache.set(clave, copy.deepcopy(resultado), self.cache_ttl)
        return resultado

    def _orden_optimizado(self, puntos, perfil, perfil_api, volver_al_inicio):
        clave = self._clave_optimizacion(puntos, perfil, volver_al_inicio)
        cacheado = cache.get(clave)
        if isinstance(cacheado, list):
            return list(cacheado)

        inicio = [float(puntos[0]["lng"]), float(puntos[0]["lat"])]
        vehiculo = {
            "id": 0,
            "profile": perfil_api,
            "start": list(inicio),
        }
        if volver_al_inicio:
            vehiculo["end"] = list(inicio)

        jobs = [
            {
                "id": indice,
                "location": [float(punto["lng"]), float(punto["lat"])],
            }
            for indice, punto in enumerate(puntos[1:], start=1)
        ]

        payload = self._post(
            self.optimization_url,
            {"vehicles": [vehiculo], "jobs": jobs},
            accept="application/json",
        )
        orden = self._normalizar_optimizacion(
            payload, len(puntos), volver_al_inicio
        )
        cache.set(clave, list(orden), self.cache_ttl)
        return orden

    def _post(self, url, body, accept):
        headers = {
            "Authorization": self.api_key,
            "Content-Type": "application/json",
            "Accept": accept,
            "User-Agent": "GeoHuella/0.1 (educational routing)",
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
        return payload

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

    def _clave_optimizacion(self, puntos, perfil, volver_al_inicio):
        firma = json.dumps(
            {
                "puntos": [
                    [round(float(p["lng"]), 6), round(float(p["lat"]), 6)]
                    for p in puntos
                ],
                "perfil": perfil,
                "volver_al_inicio": bool(volver_al_inicio),
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        digest = hashlib.sha256(firma.encode("utf-8")).hexdigest()
        return f"ruta-orden:v1:{digest}"

    def _normalizar_optimizacion(self, payload, cantidad_puntos, volver_al_inicio):
        if not isinstance(payload, dict) or payload.get("code") != 0:
            raise RoutingServiceError("La optimización no pudo resolver el recorrido.")

        summary = payload.get("summary")
        if not isinstance(summary, dict):
            raise RoutingServiceError("La optimización no informó un resumen válido.")
        if summary.get("unassigned") not in (None, 0):
            raise RoutingServiceError("La optimización dejó huellas sin asignar.")

        routes = payload.get("routes")
        if not isinstance(routes, list) or len(routes) != 1:
            raise RoutingServiceError("La optimización no devolvió una ruta única.")
        route = routes[0]
        steps = route.get("steps") if isinstance(route, dict) else None
        if not isinstance(steps, list):
            raise RoutingServiceError("La optimización no devolvió pasos válidos.")

        orden = [0]
        vistos = set()
        for step in steps:
            if not isinstance(step, dict) or step.get("type") != "job":
                continue
            job = step.get("job")
            if isinstance(job, bool) or not isinstance(job, int):
                raise RoutingServiceError("La optimización devolvió un paso inválido.")
            if job < 1 or job >= cantidad_puntos or job in vistos:
                raise RoutingServiceError("La optimización devolvió un orden inválido.")
            vistos.add(job)
            orden.append(job)

        if vistos != set(range(1, cantidad_puntos)):
            raise RoutingServiceError("La optimización no incluyó todas las huellas.")
        if volver_al_inicio:
            orden.append(0)
        return orden

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
