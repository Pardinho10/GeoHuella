from django.urls import path

from .views import salud, provincias, geocodificar, ubicar_coordenadas, ruta, lugares_cercanos

urlpatterns = [
    path("salud/", salud, name="salud"),
    path("provincias/", provincias, name="provincias"),
    path("geocodificar/", geocodificar, name="geocodificar"),
    path("ubicar-coordenadas/", ubicar_coordenadas, name="ubicar-coordenadas"),
    path("ruta/", ruta, name="ruta"),
    path("lugares-cercanos/", lugares_cercanos, name="lugares-cercanos"),
]
