# GeoHuella

Mapa de lugares para buscar direcciones, comparar coincidencias, guardar puntos y trazar rutas por calles. Proyecto independiente y educativo construido con Django REST Framework, React, MapLibre GL JS y servicios abiertos de geocodificación y ruteo.

El nombre de producto es **GeoHuella**. El repositorio conserva el nombre interno `piloto-mapa` en algunas claves de `localStorage` para no perder datos existentes.

**Versión actual:** `0.2.1`. El historial de cambios está en [`CHANGELOG.md`](CHANGELOG.md). La versión se muestra en el panel y en `GET /api/salud/`.

## Funcionalidades

- Búsqueda de direcciones por calle, altura, ciudad y provincia.
- Hasta cinco candidatos por búsqueda, con selección explícita antes de agregarlos.
- Fallback de geocodificación con Nominatim y, opcionalmente, HERE.
- Sugerencias de alturas cercanas cuando no existe la altura exacta.
- Alta de puntos por coordenadas.
- Edición del nombre de cada huella.
- Reordenamiento de huellas para controlar el orden de la lista y de las rutas.
- Filtro por nombre o dirección.
- Marcadores con forma de huella y colores cíclicos.
- Persistencia local de puntos en el navegador.
- Rutas por calles entre 2 y 20 huellas.
- Perfiles de caminata, auto y bicicleta.
- Punto de inicio y punto final seleccionables.
- Optimización opcional del orden de visita con VROOM.
- Ida y regreso diferenciados en el mapa: ida sólida y regreso punteado.
- Distancia y duración estimadas por el proveedor de ruteo.
- Consulta de lugares cercanos a una huella: bares, sanatorios, comercios y otros puntos de interés.
- Los lugares cercanos aparecen numerados en el mapa, con el mismo número en la lista. Al tocar un punto se abre una ficha con nombre, categoría, distancia y dirección.
- Importación masiva de direcciones desde texto pegado o CSV: revisión y corrección por fila, geocodificación secuencial en lotes, cancelación, detección de duplicados y confirmación antes de guardar. Hasta 100 filas por importación.
- Criterio conservador de exactitud para Georef en la importación: la calle admite como máximo una edición de carácter en total, la altura debe coincidir y localidad/provincia no pueden contradecir la dirección pedida; cualquier duda deja el candidato como aproximado y sin preseleccionar.
- Al armar rutas con más de 20 huellas, la interfaz avisa del límite y permite elegir el subconjunto sin borrar puntos.

## Stack

- Backend: Python 3.12, Django 6, Django REST Framework.
- Frontend: React, Vite, JavaScript, Bootstrap y MapLibre GL JS.
- Mapas: OpenFreeMap con datos de OpenStreetMap y OpenMapTiles.
- Geocodificación: Georef, Nominatim y HERE.
- Ruteo: HeiGIT/OpenRouteService Directions y VROOM.
- Pruebas: pytest, Vitest y React Testing Library.

## Requisitos

- Python 3.12 o superior.
- Node.js 20.19 o superior, o 22.12 o superior.
- npm.

## Instalación

Desde la raíz del repositorio:

```bash
npm ci
cd frontend && npm ci
cd ../backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Configuración

Crear los archivos de entorno locales:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Los archivos `.env` no se versionan. La configuración mínima para desarrollo es:

```dotenv
CORS_ALLOW_ALL=False
CORS_ALLOWED_ORIGINS=http://localhost:5174
```

### Variables principales del backend

| Variable | Uso |
| --- | --- |
| `DJANGO_SECRET_KEY` | Clave de Django. Cambiarla fuera de desarrollo. |
| `DJANGO_DEBUG` | Activa o desactiva el modo debug. |
| `ALLOWED_HOSTS` | Hosts permitidos por Django. |
| `CORS_ALLOWED_ORIGINS` | Orígenes autorizados del frontend. |
| `GEOREF_BASE_URL` | API de Georef. |
| `NOMINATIM_USER_AGENT` | Identificación obligatoria ante Nominatim. |
| `HERE_ENABLED` | Activa el fallback de HERE. |
| `HERE_API_KEY` | API key de HERE, solo en backend. |
| `ROUTING_ENABLED` | Activa el cálculo de rutas. |
| `ROUTING_API_KEY` | API key de HeiGIT, solo en backend. |
| `ROUTING_BASE_URL` | Endpoint de Directions de HeiGIT. |
| `ROUTING_OPTIMIZATION_URL` | Endpoint de optimización VROOM. |
| `ROUTING_CACHE_TTL` | Tiempo de caché de rutas y órdenes. |
| `HERE_PLACES_ENABLED` | Activa la consulta de lugares cercanos. |
| `HERE_PLACES_URL` | Endpoint Browse de HERE. |
| `HERE_PLACES_CACHE_TTL` | Tiempo de caché de lugares cercanos. |
| `IMPORT_MAX_FILAS` | Tope de filas por importación, aplicado por el cliente (default 100). |
| `GEOCODIFICAR_LOTE_MAX` | Tope real de filas por solicitud de `/api/geocodificar-lote/` (default 10). Mantener sincronizado con el bloque de 10 del frontend. |

Para habilitar rutas, crear una API key gratuita en <https://account.heigit.org/> y configurar:

```dotenv
ROUTING_ENABLED=true
ROUTING_API_KEY=tu_api_key
```

Nunca exponer las API keys en el frontend ni subirlas al repositorio.

## Ejecución

Desde la raíz:

```bash
npm run dev
```

El comando inicia Django en `http://localhost:8001` y Vite en `http://localhost:5174`. Para detener los procesos iniciados por el comando, presionar `Ctrl+C`. Si el backend está instalado como servicio persistente, `npm run dev` lo reutiliza y solo inicia Vite.

Scripts disponibles:

- `npm run dev:backend`: inicia solo el backend en la terminal.
- `npm run dev:frontend`: inicia solo el frontend.
- `npm run status`: comprueba que frontend y backend respondan.
- `npm run install:backend-service`: instala un servicio de usuario con reinicio automático en Linux con systemd. Tras instalarlo, Django permanece disponible aunque se cierre la terminal; detenerlo con `systemctl --user stop geohuella-backend.service`. Este es un servicio de desarrollo local, no un reemplazo de un despliegue de producción.

El frontend usa el backend real por defecto. Para trabajar sin backend, configurar `VITE_USAR_MOCK=true` en `frontend/.env` y reiniciar Vite.

## Endpoints

- `GET /api/salud/`: estado y versión del servicio.
- `GET /api/provincias/`: provincias obtenidas de Georef.
- `POST /api/geocodificar/`: búsqueda de direcciones y sugerencias.
- `POST /api/geocodificar-lote/`: geocodificación en lote de hasta `GEOCODIFICAR_LOTE_MAX` filas (default 10), con estado y errores aislados por fila.
- `POST /api/ubicar-coordenadas/`: unidad territorial para un par de coordenadas.
- `POST /api/ruta/`: ruta por calles, con perfiles, inicio, final y optimización opcional.
- `GET /api/lugares-cercanos/`: lugares de HERE alrededor de una coordenada.

El contrato detallado está en [`docs/contrato-api.md`](docs/contrato-api.md).

## Pruebas

Backend:

```bash
cd backend
source .venv/bin/activate
pytest
python manage.py check
```

Frontend:

```bash
cd frontend
npm test
npm run build
```

Las pruebas no dependen de llamadas reales a los proveedores externos. La verificación con servicios reales requiere configurar las API keys correspondientes.

El repositorio no incluye un CSV de muestra: para un smoke de importación manual, generar un archivo temporal fuera del repositorio (por ejemplo en `/tmp`) con encabezados y 1–2 filas, y borrarlo al terminar.

## Estructura

```text
backend/    API Django, servicios de geocodificación y ruteo
frontend/   Aplicación React, mapa y pruebas
docs/       Contrato, especificación y notas técnicas
```

Documentación adicional:

- [`docs/contrato-api.md`](docs/contrato-api.md)
- [`docs/especificacion-funcional.md`](docs/especificacion-funcional.md)
- [`docs/fase-1-importacion-masiva.md`](docs/fase-1-importacion-masiva.md)
- [`docs/notas-georef.md`](docs/notas-georef.md)
- [`docs/rutas-propuesta.md`](docs/rutas-propuesta.md)
- [`docs/migracion-maplibre.md`](docs/migracion-maplibre.md)
- [`docs/diagnostico-backend-recurrente.md`](docs/diagnostico-backend-recurrente.md)
- [`CHANGELOG.md`](CHANGELOG.md)
- [`VERSION`](VERSION)

## Solución de problemas

### El frontend muestra "Connection refused" contra `localhost:8001`

El backend no está corriendo. Comprobar el estado:

```bash
npm run status
```

Para iniciarlo junto al frontend:

```bash
npm run dev
```

En Linux con systemd, instalarlo para que se recupere automáticamente si se cae o se reinicia el equipo:

```bash
npm run install:backend-service
systemctl --user status geohuella-backend.service
```

Para ver los logs o detener el servicio:

```bash
journalctl --user -u geohuella-backend.service -f
systemctl --user stop geohuella-backend.service
systemctl --user start geohuella-backend.service
```

O iniciar ambos servicios:

```bash
npm run dev
```

Comprobar el estado:

```bash
curl http://localhost:8001/api/salud/
```

Debe responder `{"estado":"ok","version":"0.2.1"}`.

Los errores de CORS que aparecen junto a `Connection refused` suelen ser consecuencia de que el backend está apagado, no un problema separado de configuración. El servicio persistente gestiona fallas del backend; si la consola muestra `Could not be loaded` para una imagen de MapLibre, es un aviso separado sobre el sprite del estilo cartográfico.

### Los cambios en `.env` no se aplican

Reiniciar el backend. `runserver` recarga archivos Python automáticamente, pero no vuelve a leer `.env`.

### El puerto 8001 está ocupado

Verificar el proceso:

```bash
ss -ltnp | grep 8001
```

Detener ese proceso o cambiar el puerto de Django y `VITE_API_BASE_URL`.

## Persistencia y privacidad

- Los puntos se guardan en `localStorage`; no existe base de datos de negocio ni autenticación.
- Las búsquedas de direcciones envían calle, altura, ciudad y provincia a los proveedores configurados.
- La importación masiva procesa el CSV o el texto en el navegador y envía las filas al backend en bloques secuenciales de hasta 10. El backend no persiste las filas ni registra las direcciones completas.
- Las rutas envían coordenadas y perfil al proveedor de ruteo.
- La consulta de lugares cercanos envía coordenadas a HERE; no se guardan en el navegador y solo se cachean por un período corto en el backend.
- Las API keys permanecen en el backend.
- Nominatim exige un `User-Agent` identificable y un máximo de una solicitud por segundo. El backend aplica un límite y una caché.
- Revisar los términos, la atribución y las cuotas de Georef, OpenStreetMap, HERE, HeiGIT y OpenFreeMap antes de un uso público o de alto volumen.

## Limitaciones conocidas

- La aplicación no está preparada todavía para producción: no hay autenticación, despliegue, monitoreo ni configuración endurecida.
- La persistencia es local y no se sincroniza entre dispositivos.
- La cobertura de direcciones depende de Georef, Nominatim y HERE.
- Las alturas interpoladas por HERE se muestran como sugerencias aproximadas.
- Las rutas dependen de una API key de HeiGIT y de sus cuotas.
- Los lugares cercanos dependen de HERE y de su cobertura, cuota y términos de uso.
- El máximo de huellas por ruta es 20. Con conjuntos mayores, se elige un subconjunto; no hay división automática en tramos.
- La importación masiva usa archivos CSV/texto, con máximo 100 filas (`IMPORT_MAX_FILAS`); el tamaño batch del cliente y backend debe mantenerse sincronizado en 10 (`GEOCODIFICAR_LOTE_MAX`).
- La tolerancia de una edición de carácter solo aplica al lote de importación: la altura debe coincidir y localidad/provincia no pueden contradecir la solicitud. El endpoint individual conserva su semántica histórica.
- La optimización usa un solo vehículo y no admite ventanas horarias ni capacidades.
- Los tests automatizados usan respuestas simuladas de los proveedores externos.

## Estado

El proyecto se encuentra en etapa de piloto funcional. Las suites de backend y frontend pasan, y el flujo principal fue verificado con servicios reales en entorno local. Antes de publicarlo como servicio, faltan tareas de CI, pruebas E2E, accesibilidad, configuración de producción y revisión de términos de los proveedores.
