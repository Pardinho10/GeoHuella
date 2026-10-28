from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .serializers import GeocodificarSerializer, UbicarCoordenadasSerializer, RutaSerializer
from .services.georef import GeorefClient, GeorefServiceError
from .services.nominatim import NominatimClient, NominatimServiceError
from .services.here import HereClient, HereServiceError
from .services.routing import RoutingClient, RoutingServiceError


@api_view(["GET"])
def salud(request):
    return Response({"estado": "ok"})


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

    client = GeorefClient()
    try:
        resultados = client.geocodificar(
            data["calle"], data["numero"], data["ciudad"], data["provincia"]
        )
    except GeorefServiceError:
        return Response(
            {"error": {"codigo": "servicio_no_disponible",
                       "mensaje": "El servicio de georreferencia no está disponible."}},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    if resultados:
        return Response({"resultados": resultados})

    # Fallback exacto con Nominatim.
    nominatim = NominatimClient()
    try:
        exactos = nominatim.search_exact(
            data["calle"], data["numero"], data["ciudad"], data["provincia"]
        )
    except NominatimServiceError:
        exactos = []

    if exactos:
        return Response({"resultados": exactos})

    # Fallback opcional con HERE. Los resultados PA/MPA son exactos;
    # los interpolated se devuelven como sugerencias aproximadas.
    here = HereClient()
    try:
        here_results = here.search_exact(
            data["calle"], data["numero"], data["ciudad"], data["provincia"]
        )
    except HereServiceError:
        here_results = []

    here_exactos = [c for c in here_results if not c.get("_interpolada")]
    if here_exactos:
        return Response({"resultados": [HereClient.publico(c) for c in here_exactos]})

    # Sugerencias de alturas cercanas, misma calle/localidad/provincia.
    try:
        sugerencias = nominatim.search_nearby(
            data["calle"], data["numero"], data["ciudad"], data["provincia"]
        )
    except NominatimServiceError:
        sugerencias = []

    # HERE interpolado va primero, luego las sugerencias de Nominatim.
    combinadas = [HereClient.publico(c) for c in here_results if c.get("_interpolada")]
    vistas = set()
    sugerencias_unicas = []
    for candidate in combinadas + list(sugerencias):
        key = (
            round(float(candidate.get("lat", 0)), 6),
            round(float(candidate.get("lng", 0)), 6),
            candidate.get("direccion"),
        )
        if key in vistas:
            continue
        vistas.add(key)
        sugerencias_unicas.append(candidate)
        if len(sugerencias_unicas) >= 5:
            break

    error_body = {
        "codigo": "no_encontrada",
        "mensaje": "No se pudo ubicar la dirección. Revisá la calle, el número y la ciudad.",
    }
    if sugerencias_unicas:
        error_body["sugerencias"] = sugerencias_unicas
    return Response(
        {"error": error_body},
        status=status.HTTP_404_NOT_FOUND,
    )


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
