"""Lógica de geocodificación compartida por `/api/geocodificar/` y `/api/geocodificar-lote/`.

El objetivo de este módulo es que exista **una sola** implementación del flujo
Georef -> Nominatim (fallback exacto) -> HERE (PA/MPA) -> sugerencias
aproximadas. Tanto el endpoint individual como el de lote llaman a
`resolver_direccion`; de ese modo el lote no puede duplicar reglas ni abrir una
vía que evite la caché o el rate-lock global de Nominatim.

`resolver_direccion` no paraleliza nada: cada fila se resuelve de forma
secuencial reutilizando los clientes existentes (y sus cachés).

Clasificación de candidatos:

- **exacto**: proviene de una búsqueda de altura exacta (Georef `/direcciones`
  con coordenadas utilizables, `NominatimClient.search_exact` con
  `house_number` igual al pedido, o HERE con `houseNumberType` `PA`/`MPA` y la
  misma altura).
- **aproximado**: interpolación de HERE (`interpolated`) o altura vecina de
  Nominatim (`search_nearby`). Nunca se presenta como coincidencia exacta.

En el **lote**, los candidatos de Georef se reclasifican además con
`services/exactitud.py` (discrepancia mínima de calle/altura/territorio). El
endpoint individual no aplica ese criterio: conserva su semántica histórica
(`aproximada: true`) y su shape.
"""

import logging

from .georef import GeorefClient, GeorefServiceError
from .nominatim import NominatimClient, NominatimServiceError
from .here import HereClient, HereServiceError
from .exactitud import es_candidato_exacto

logger = logging.getLogger(__name__)

MAX_CANDIDATOS = 5


def _etiqueta(proveedor, candidato, nombre=None):
    """Envuelve un candidato con su proveedor sin mutar el dict original."""
    return {"proveedor": proveedor, "candidato": candidato, "nombre": nombre}


def resolver_direccion(calle, numero, ciudad, provincia):
    """Resuelve una dirección con el flujo compartido.

    Devuelve un dict con:

    - ``exactos``: lista de ``{"proveedor", "candidato", "nombre"}`` con
      coincidencias exactas (máximo 5). Si no está vacía, no se consultaron
      los proveedores de respaldo.
    - ``aproximados``: lista con el mismo formato, sólo con interpolaciones o
      alturas vecinas (máximo 5). Se llena únicamente si no hubo exactos.
    - ``fallo_primario``: ``"georef"`` cuando Georef falló; el endpoint
      individual lo traduce a 502 y el lote a ``estado: "error"``.
    - ``fallas``: proveedores de respaldo consultados que fallaron.
    - ``respuestas``: proveedores que respondieron correctamente.

    No registra la dirección en logs.
    """
    resultado = {
        "exactos": [],
        "aproximados": [],
        "fallo_primario": None,
        "fallas": [],
        "respuestas": [],
    }

    georef = GeorefClient()
    try:
        candidatos = georef.geocodificar(calle, numero, ciudad, provincia)
    except GeorefServiceError:
        resultado["fallo_primario"] = "georef"
        return resultado

    resultado["respuestas"].append("georef")
    if candidatos:
        resultado["exactos"] = [
            _etiqueta("georef", candidato) for candidato in candidatos[:MAX_CANDIDATOS]
        ]
        return resultado

    nominatim = NominatimClient()

    # Fallback exacto con Nominatim.
    try:
        exactos = nominatim.search_exact(calle, numero, ciudad, provincia)
    except NominatimServiceError:
        exactos = []
        resultado["fallas"].append("nominatim")
    else:
        resultado["respuestas"].append("nominatim")

    if exactos:
        resultado["exactos"] = [
            _etiqueta("nominatim", candidato) for candidato in exactos[:MAX_CANDIDATOS]
        ]
        return resultado

    # Fallback opcional con HERE. Los resultados PA/MPA son exactos;
    # los interpolated se devuelven como sugerencias aproximadas.
    here = HereClient()
    try:
        here_results = here.search_exact(calle, numero, ciudad, provincia)
    except HereServiceError:
        here_results = []
        resultado["fallas"].append("here")
    else:
        resultado["respuestas"].append("here")

    here_exactos = [c for c in here_results if not c.get("_interpolada")]
    if here_exactos:
        resultado["exactos"] = [
            _etiqueta("here", HereClient.publico(c), c.get("_nombre"))
            for c in here_exactos[:MAX_CANDIDATOS]
        ]
        return resultado

    # Sugerencias de alturas cercanas, misma calle/localidad/provincia.
    try:
        sugerencias = nominatim.search_nearby(calle, numero, ciudad, provincia)
    except NominatimServiceError:
        sugerencias = []
        resultado["fallas"].append("nominatim")
    else:
        resultado["respuestas"].append("nominatim")

    # HERE interpolado va primero, luego las sugerencias de Nominatim.
    candidatos_aproximados = [
        _etiqueta("here", HereClient.publico(c), c.get("_nombre"))
        for c in here_results
        if c.get("_interpolada")
    ] + [_etiqueta("nominatim", c) for c in sugerencias]

    vistas = set()
    for item in candidatos_aproximados:
        candidate = item["candidato"]
        clave = (
            round(float(candidate.get("lat", 0)), 6),
            round(float(candidate.get("lng", 0)), 6),
            candidate.get("direccion"),
        )
        if clave in vistas:
            continue
        vistas.add(clave)
        resultado["aproximados"].append(item)
        if len(resultado["aproximados"]) >= MAX_CANDIDATOS:
            break

    return resultado


def _degradado(resultado):
    """True si no hubo respuesta utilizable de ningún proveedor.

    Se usa sólo cuando no hay candidatos: si Nominatim (el respaldo obligatorio)
    falló en todos sus intentos y nada más aportó datos, informar
    ``sin_resultado`` ocultaría un fallo de infraestructura.
    """
    return (
        "nominatim" in resultado["fallas"]
        and "nominatim" not in resultado["respuestas"]
    )


def candidato_lote(item, aproximada):
    """Forma pública del candidato para `POST /api/geocodificar-lote/`.

    ``aproximada`` se deriva de la vía que produjo el candidato (exacta o
    aproximada) y no del valor interno que expone el endpoint individual.
    """
    candidato = item["candidato"]
    return {
        "lat": candidato.get("lat"),
        "lng": candidato.get("lng"),
        "nombre": item.get("nombre"),
        "direccion": candidato.get("direccion"),
        "proveedor": item["proveedor"],
        "aproximada": bool(aproximada),
    }


def _aproximada(item, fila):
    """Marca de aproximación de un candidato exacto según su proveedor.

    Georef aplica la política conservadora de `services/exactitud.py`: sólo es
    exacto si la calle/altura/territorio verifican con discrepancia mínima.
    HERE (PA/MPA) y Nominatim exacto conservan la política existente.
    """
    if item["proveedor"] != "georef":
        return False
    return not es_candidato_exacto(item["candidato"], fila)


def procesar_fila_lote(fila):
    """Resuelve una fila del lote y la clasifica en un estado del contrato.

    Nunca propaga errores de proveedor: los convierte en ``estado: "error"``
    aislado para esa fila, sin exponer URLs, trazas ni credenciales.
    """
    resultado = resolver_direccion(
        fila["calle"], fila["altura"], fila["ciudad"], fila["provincia"]
    )

    salida = {
        "id": fila["id"],
        "estado": "sin_resultado",
        "candidatos": [],
        "mensaje": None,
    }

    if resultado["fallo_primario"]:
        salida["estado"] = "error"
        salida["mensaje"] = (
            "El servicio de georreferencia no respondió para esta fila. "
            "Reintentá en unos minutos."
        )
        return salida

    if resultado["exactos"]:
        candidatos = [
            candidato_lote(item, aproximada=_aproximada(item, fila))
            for item in resultado["exactos"][:MAX_CANDIDATOS]
        ]
        salida["candidatos"] = candidatos
        salida["estado"] = (
            "encontrada"
            if len(candidatos) == 1 and not candidatos[0]["aproximada"]
            else "ambigua"
        )
        return salida

    if resultado["aproximados"]:
        salida["candidatos"] = [
            candidato_lote(item, aproximada=True)
            for item in resultado["aproximados"][:MAX_CANDIDATOS]
        ]
        salida["estado"] = "ambigua"
        return salida

    if _degradado(resultado):
        logger.info("Lote: fila sin resultado por fallo de proveedor de respaldo")
        salida["estado"] = "error"
        salida["mensaje"] = (
            "Un servicio de geocodificación no respondió para esta fila. "
            "Reintentá en unos minutos."
        )
        return salida

    return salida
