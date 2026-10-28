from django.urls import path

from .views import salud, provincias, geocodificar, ubicar_coordenadas, ruta

urlpatterns = [
    path("salud/", salud, name="salud"),
    path("provincias/", provincias, name="provincias"),
    path("geocodificar/", geocodificar, name="geocodificar"),
    path("ubicar-coordenadas/", ubicar_coordenadas, name="ubicar-coordenadas"),
    path("ruta/", ruta, name="ruta"),
]
