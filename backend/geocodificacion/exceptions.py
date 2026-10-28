from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler


def _wrap(codigo, mensaje, campos=None, http_status=None):
    payload = {"error": {"codigo": codigo, "mensaje": mensaje}}
    if campos:
        payload["error"]["campos"] = campos
    return Response(payload, status=http_status)


def custom_exception_handler(exc, context):
    # Let DRF handle first to get standard response/status.
    response = drf_exception_handler(exc, context)
    if response is None:
        return None

    # Already wrapped? (our service raises custom)
    if isinstance(response.data, dict) and "error" in response.data and "codigo" in response.data.get("error", {}):
        return response

    # Map DRF validation errors.
    if response.status_code == 400:
        campos = None
        if isinstance(response.data, dict):
            campos = {}
            for key, value in response.data.items():
                if isinstance(value, list):
                    campos[key] = value[0] if value else ""
                else:
                    campos[key] = value
            if not campos:
                campos = None
        mensaje = "Revisá los campos indicados." if campos else "Solicitud inválida."
        return _wrap("solicitud_invalida", mensaje, campos, status.HTTP_400_BAD_REQUEST)

    # Default mapping by status code.
    mapping = {
        404: ("no_encontrada", "No se pudo ubicar la dirección. Revisá la calle, el número y la ciudad.", status.HTTP_404_NOT_FOUND),
        422: ("fuera_de_rango", "Coordenadas fuera de la caja geográfica acordada para Argentina.", status.HTTP_422_UNPROCESSABLE_ENTITY),
        429: ("demasiadas_solicitudes", "Demasiadas solicitudes.", status.HTTP_429_TOO_MANY_REQUESTS),
        502: ("servicio_no_disponible", "El servicio de georreferencia no está disponible.", status.HTTP_502_BAD_GATEWAY),
    }
    if response.status_code in mapping:
        codigo, mensaje, http = mapping[response.status_code]
        return _wrap(codigo, mensaje, None, http)

    return response
