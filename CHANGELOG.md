# Historial de versiones

Todas las versiones relevantes de GeoHuella se documentan en este archivo.
El formato sigue [Versionado Semántico](https://semver.org/lang/es/).

## [0.1.0] - 2026-10-30

Primera versión funcional del piloto.

### Agregado

- Geocodificación de direcciones con Georef, OpenStreetMap/Nominatim y HERE como respaldo.
- Ubicación inversa de coordenadas dentro de Argentina.
- Huellas con nombre, dirección, color y persistencia local.
- Edición de nombres, reordenamiento y filtro por nombre o dirección.
- Rutas por calles con perfiles caminando, auto y bicicleta.
- Inicio y final de ruta seleccionables, ida y vuelta, y optimización de orden con VROOM.
- Consulta de lugares cercanos con HERE, marcadores numerados en el mapa y ficha de detalle.
- Endpoint de salud con versión de la aplicación.

### Notas

- HERE tiene un límite gratuito de 1.000 consultas diarias.
- Los puntos y el nombre se guardan solo en el navegador.
- La dirección `Perú 781` puede aparecer como interpolación aproximada según el proveedor.
