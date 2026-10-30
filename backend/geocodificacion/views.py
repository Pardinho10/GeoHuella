from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .serializers import (
    GeocodificarSerializer, GeocodificarLoteSerializer, UbicarCoordenadasSerializer,
    RutaSerializer, LugaresCercanosSerializer,
)
from .services.georef import GeorefClient, GeorefServiceError
from .services.consulta import resolver_direccion, procesar_fila_lote
from .services.routing import RoutingClient, RoutingServiceError
from .services.places import HerePlacesClient, HerePlacesServiceError
from config.version import VERSION


@api_view(["GET"])
def salud(request):
    return Response({"estado": "ok", "version": VERSION})


@api_view(["GET"])
def provincias(request):
    client = GeorefClient()
    try:
        nombres = client.provincias()
    except GeorefServiceError:
        return Response(
            {"error": {"codigo": "servicio_no_disponible",
                       "mensaje": "El servicio de georreferencia no está disponible."}},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    return Response({"provincias": nombres})


@api_view(["POST"])
def geocodificar(request):
    serializer = GeocodificarSerializer(data=request.data)
    try:
        serializer.is_valid(raise_exception=True)
    except GeorefServiceError:
        return Response(
            {"error": {"codigo": "servicio_no_disponible",
                       "mensaje": "El servicio de georreferencia no está disponible."}},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    data = serializer.validated_data

    resultado = resolver_direccion(
        data["calle"], data["numero"], data["ciudad"], data["provincia"]
    )

    if resultado["fallo_primario"]:
        return Response(
            {"error": {"codigo": "servicio_no_disponible",
                       "mensaje": "El servicio de georreferencia no está disponible."}},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    if resultado["exactos"]:
        return Response({"resultados": [item["candidato"] for item in resultado["exactos"]]})

    error_body = {
        "codigo": "no_encontrada",
        "mensaje": "No se pudo ubicar la dirección. Revisá la calle, el número y la ciudad.",
    }
    if resultado["aproximados"]:
        error_body["sugerencias"] = [item["candidato"] for item in resultado["aproximados"]]
    return Response(
        {"error": error_body},
        status=status.HTTP_404_NOT_FOUND,
    )


@api_view(["POST"])
def geocodificar_lote(request):
    """Geocodifica hasta `GEOCODIFICAR_LOTE_MAX` direcciones, en orden.

    Procesa las filas secuencialmente reutilizando la misma lógica que
    `/api/geocodificar/` (incluida la caché y el rate-lock global de
    Nominatim). Los fallos de proveedor se aíslan por fila como
    `estado: "error"`; no se persiste nada y no se agregan puntos.
    """
    serializer = GeocodificarLoteSerializer(data=request.data)
    try:
        serializer.is_valid(raise_exception=True)
    except GeorefServiceError:
        return Response(
            {"error": {"codigo": "servicio_no_disponible",
                       "mensaje": "El servicio de georreferencia no está disponible."}},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    filas = serializer.validated_data["filas"]
    resultados = [procesar_fila_lote(fila) for fila in filas]
    return Response({"resultados": resultados})


@api_view(["POST"])
def ubicar_coordenadas(request):
    serializer = UbicarCoordenadasSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    lat = data["lat"]
    lng = data["lng"]

    if lat < -56 or lat > -21 or lng < -74 or lng > -53:
        return Response(
            {"error": {"codigo": "fuera_de_rango",
                       "mensaje": "Coordenadas fuera de la caja geográfica acordada para Argentina."}},
            status=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )

    client = GeorefClient()
    try:
        resultado = client.ubicar(lat, lng)
    except GeorefServiceError:
        return Response(
            {"error": {"codigo": "servicio_no_disponible",
                       "mensaje": "El servicio de georreferencia no está disponible."}},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    return Response(resultado)


@api_view(["POST"])
def ruta(request):
    serializer = RutaSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    client = RoutingClient()
    if not client.disponible:
        return Response(
            {"error": {"codigo": "routing_no_configurado",
                       "mensaje": "El servicio de rutas no está configurado."}},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    try:
        resultado = client.calcular_ruta(
            data["puntos"],
            data["perfil"],
            data["volver_al_inicio"],
            data["optimizar"],
            data["fin"],
        )
    except RoutingServiceError:
        return Response(
            {"error": {"codigo": "routing_no_disponible",
                       "mensaje": "No se pudo calcular la ruta. Intentá nuevamente en unos minutos."}},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    return Response(resultado)


@api_view(["GET"])
def lugares_cercanos(request):
    serializer = LugaresCercanosSerializer(data=request.query_params)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    client = HerePlacesClient()
    if not client.disponible:
        return Response(
            {"error": {"codigo": "lugares_no_configurado",
                       "mensaje": "El servicio de lugares cercanos no está configurado."}},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    try:
        lugares = client.buscar(data["lat"], data["lng"], data["limit"])
    except HerePlacesServiceError:
        return Response(
            {"error": {"codigo": "lugares_no_disponible",
                       "mensaje": "No se pudieron consultar los lugares cercanos."}},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    return Response({"lugares": lugares})
