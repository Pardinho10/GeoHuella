import math

from rest_framework import serializers

from .services.georef import GeorefServiceError


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
        from .services.georef import GeorefClient
        try:
            provincias = GeorefClient().provincias()
        except GeorefServiceError:
            raise
        if value not in provincias:
            raise serializers.ValidationError("Provincia inválida.")
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
