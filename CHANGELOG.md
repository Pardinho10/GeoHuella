# Historial de versiones

Todas las versiones relevantes de GeoHuella se documentan en este archivo.
El formato sigue [Versionado Semántico](https://semver.org/lang/es/).

## [0.2.0] - 2026-10-30

### Agregado

- Importación masiva desde texto pegado y archivos CSV UTF-8, con detección y mapeo de columnas, defaults explícitos y edición de filas.
- Geocodificación secuencial en lotes de hasta 10 filas con progreso, cancelación del cliente, reintentos y resultados independientes por fila.
- Revisión de candidatos, selección explícita de aproximados, coordenadas manuales, descarte y detección de duplicados por dirección o proximidad.
- Confirmación antes de guardar importaciones; persiste en el almacenamiento local existente y respeta el máximo de 200 huellas.
- Avisos accesibles y selección de subconjunto para rutas cuando hay más de 20 huellas; no se implementa división automática en tramos.
- Criterio de exactitud de Georef tolera como máximo una edición de carácter en total en el nombre de calle, exigiendo altura coincidente y localidad/provincia compatibles; discrepancias mayores o no verificables siguen como aproximadas y sin preseleccionar.

### Notas

- Importación máxima: 100 filas; solicitudes batch de hasta 10 filas.
- HERE, Georef y Nominatim mantienen sus respectivas limitaciones de cobertura y cuota.
- Cancelar en el navegador evita iniciar nuevos bloques y aborta la espera del cliente, pero no garantiza detener trabajo ya iniciado en el backend/proveedor.

## [0.1.1] - 2026-10-30

### Corregido

- El backend de desarrollo se instala como servicio de usuario con reinicio automático en Linux con systemd, para evitar que `localhost:8001` quede sin respuesta al cerrar la terminal o si Django se detiene.
- El arranque conjunto reutiliza el backend persistente cuando ya está activo.
- Se agregaron comandos para comprobar estado, instalar el servicio y consultar logs.

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
