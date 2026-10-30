import math
import re

from django.conf import settings
from rest_framework import serializers


PROVINCIA_LISTA_ERROR = "Provincia inválida."


def provincias_oficiales():
    """Lista oficial de provincias (cacheada 24 h por el cliente Georef).

    Propaga `GeorefServiceError` para que la vista decida entre 400 (validación)
    y 502 (servicio no disponible), igual que el endpoint individual.
    """
    from .services.georef import GeorefClient
    return GeorefClient().provincias()


class StrictFloatField(serializers.FloatField):
    def to_internal_value(self, data):
        if isinstance(data, bool) or not isinstance(data, (int, float)):
            raise serializers.ValidationError("Debe ser un número JSON.")
        return super().to_internal_value(data)


class GeocodificarSerializer(serializers.Serializer):
    calle = serializers.CharField(required=True, max_length=120, allow_blank=False, trim_whitespace=True)
    numero = serializers.CharField(required=True, max_length=6, allow_blank=False, trim_whitespace=True)
    ciudad = serializers.CharField(required=True, max_length=80, allow_blank=False, trim_whitespace=True)
    provincia = serializers.CharField(required=True, allow_blank=False, trim_whitespace=True)

    def validate_numero(self, value):
        if not value.isdigit():
            raise serializers.ValidationError("Debe contener solo dígitos.")
        return value

    def validate_provincia(self, value):
        provincias = provincias_oficiales()
        if value not in provincias:
            raise serializers.ValidationError(PROVINCIA_LISTA_ERROR)
        return value


class UbicarCoordenadasSerializer(serializers.Serializer):
    lat = StrictFloatField(required=True)
    lng = StrictFloatField(required=True)

    def validate_lat(self, value):
        if not math.isfinite(value):
            raise serializers.ValidationError("Debe ser un número finito.")
        return value

    def validate_lng(self, value):
        if not math.isfinite(value):
            raise serializers.ValidationError("Debe ser un número finito.")
        return value


class PuntoRutaSerializer(serializers.Serializer):
    lat = StrictFloatField(required=True)
    lng = StrictFloatField(required=True)

    def validate_lat(self, value):
        if not math.isfinite(value):
            raise serializers.ValidationError("Debe ser un número finito.")
        return value

    def validate_lng(self, value):
        if not math.isfinite(value):
            raise serializers.ValidationError("Debe ser un número finito.")
        return value


class RutaSerializer(serializers.Serializer):
    MAX_PUNTOS = 20
    LAT_MIN, LAT_MAX = -56, -21
    LNG_MIN, LNG_MAX = -74, -53

    puntos = serializers.ListField(
        child=PuntoRutaSerializer(),
        min_length=2,
        max_length=MAX_PUNTOS,
    )
    perfil = serializers.ChoiceField(
        choices=["walking", "driving", "cycling"],
        default="walking",
    )
    optimizar = serializers.BooleanField(default=False)
    volver_al_inicio = serializers.BooleanField(default=False)
    fin = serializers.IntegerField(required=False, allow_null=True, default=None)

    def validate_fin(self, value):
        if isinstance(value, bool):
            raise serializers.ValidationError("Debe ser un índice entero.")
        return value

    def validate(self, attrs):
        puntos = attrs["puntos"]
        fin = attrs.get("fin")
        if fin is not None:
            if fin < 1 or fin >= len(puntos):
                raise serializers.ValidationError({"fin": "El punto final debe ser una huella distinta del inicio."})
            if attrs.get("volver_al_inicio"):
                raise serializers.ValidationError({"fin": "Elegí un punto final o volver al inicio, no ambos."})
        return attrs

    def validate_puntos(self, value):
        for punto in value:
            if not self.LAT_MIN <= punto["lat"] <= self.LAT_MAX:
                raise serializers.ValidationError("Cada punto debe estar dentro de Argentina.")
            if not self.LNG_MIN <= punto["lng"] <= self.LNG_MAX:
                raise serializers.ValidationError("Cada punto debe estar dentro de Argentina.")
        return value


class LugaresCercanosSerializer(serializers.Serializer):
    LAT_MIN, LAT_MAX = -56, -21
    LNG_MIN, LNG_MAX = -74, -53

    lat = serializers.FloatField(required=True)
    lng = serializers.FloatField(required=True)
    limit = serializers.IntegerField(required=False, min_value=1, max_value=10, default=5)

    def validate(self, attrs):
        lat = attrs["lat"]
        lng = attrs["lng"]
        if not math.isfinite(lat) or not math.isfinite(lng):
            raise serializers.ValidationError("Las coordenadas deben ser números finitos.")
        if not self.LAT_MIN <= lat <= self.LAT_MAX or not self.LNG_MIN <= lng <= self.LNG_MAX:
            raise serializers.ValidationError("Las coordenadas deben estar dentro de Argentina.")
        return attrs


class GeocodificarLoteSerializer(serializers.Serializer):
    """Valida el lote completo antes de iniciar cualquier geocodificación.

    Una sola fila inválida rechaza todo el lote (HTTP 400) con claves planas
    ``filas[<índice>].<campo>``, tal como define el contrato de la v0.2.0.
    """

    CAMPOS = ("id", "calle", "altura", "ciudad", "provincia")
    LONGITUDES = {"id": 80, "calle": 120, "altura": 6, "ciudad": 80}

    filas = serializers.ListField(
        child=serializers.JSONField(),
        allow_empty=False,
        error_messages={
            "empty": "El lote debe incluir al menos una fila.",
            "not_a_list": "Debe ser una lista de filas.",
        },
    )

    @staticmethod
    def _texto(valor):
        """Normaliza un campo de texto y rechaza tipos que no sean string."""
        if not isinstance(valor, str):
            return None
        return valor.strip()

    def validate(self, attrs):
        filas = attrs["filas"]

        try:
            maximo = int(getattr(settings, "GEOCODIFICAR_LOTE_MAX", 10))
        except (TypeError, ValueError):
            maximo = 10
        if maximo < 1:
            maximo = 1

        if len(filas) > maximo:
            raise serializers.ValidationError({
                "filas": f"El lote admite hasta {maximo} filas por solicitud.",
            })

        # Se consulta una sola vez la lista oficial (cacheada 24 h). Si Georef
        # falla se propaga `GeorefServiceError` y la vista responde 502.
        errores = {}
        limpias = []
        ids = {}

        for indice, fila in enumerate(filas):
            prefijo = f"filas[{indice}]"

            if not isinstance(fila, dict):
                errores.setdefault(prefijo, "Cada fila debe ser un objeto.")
                continue

            identificador = self._texto(fila.get("id"))
            etiqueta = f" (fila: {identificador})" if identificador else ""

            def anotar(campo, mensaje, _prefijo=prefijo, _etiqueta=etiqueta):
                errores.setdefault(f"{_prefijo}.{campo}", f"{mensaje}{_etiqueta}")

            valores = {}
            for campo in self.CAMPOS:
                if campo not in fila:
                    anotar(campo, "Este campo es obligatorio.")
                    continue
                valor = self._texto(fila.get(campo))
                if valor is None:
                    anotar(campo, "Debe ser texto.")
                    continue
                if not valor:
                    anotar(campo, "No puede estar vacío.")
                    continue
                limite = self.LONGITUDES.get(campo)
                if limite and len(valor) > limite:
                    anotar(campo, f"No puede superar {limite} caracteres.")
                    continue
                valores[campo] = valor

            altura = valores.get("altura")
            if altura is not None and not re.fullmatch(r"[0-9]+", altura):
                anotar("altura", "Debe contener solo dígitos.")
                valores.pop("altura")

            if identificador:
                previo = ids.get(identificador)
                if previo is not None:
                    errores.setdefault(
                        f"{prefijo}.id",
                        f"El id «{identificador}» ya se usó en filas[{previo}].",
                    )
                    valores.pop("id", None)
                else:
                    ids[identificador] = indice

            if len(valores) == len(self.CAMPOS):
                limpias.append({campo: valores[campo] for campo in self.CAMPOS})

        if errores:
            raise serializers.ValidationError(errores)

        # Solo consultar Georef si el payload ya pasó todas las validaciones
        # locales. Una fila inválida debe seguir dando 400 aunque Georef esté
        # caído y no debe provocar llamadas externas.
        provincias = provincias_oficiales()
        for indice, fila in enumerate(limpias):
            if fila["provincia"] not in provincias:
                errores[f"filas[{indice}].provincia"] = (
                    f"{PROVINCIA_LISTA_ERROR} (fila: {fila['id']})"
                )

        if errores:
            raise serializers.ValidationError(errores)

        return {"filas": limpias}
