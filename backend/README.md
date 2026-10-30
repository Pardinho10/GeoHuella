# Backend — GeoHuella

Versión actual: `0.1.1`, leída desde `../VERSION`.

API Django + Django REST Framework que actúa como proxy/cache de la API pública de Georef y usa Nominatim (OpenStreetMap) y, opcionalmente, HERE Geocoding & Search como respaldos cuando faltan coordenadas.

## Requisitos

- Python 3.12+

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Editar `.env` según el entorno. Por defecto usa caché en memoria, Georef público y Nominatim público. Configurar un `NOMINATIM_USER_AGENT` identificable y respetar la [política de uso de Nominatim](https://operations.osmfoundation.org/policies/nominatim/).

## Ejecutar

```bash
source .venv/bin/activate
python manage.py runserver 0.0.0.0:8001
```

Endpoints base `/api/`:

- `salud/`: estado y versión del servicio.
- `provincias/`: provincias de Georef.
- `geocodificar/`: búsqueda de direcciones; puede devolver candidatos de Georef o de Nominatim.
- `ubicar-coordenadas/`: unidad territorial para un par lat/lng.
- `ruta/`: ruta por calles entre 2 y 20 puntos; requiere `ROUTING_ENABLED=true` y `ROUTING_API_KEY`.
- `lugares-cercanos/`: lugares de HERE alrededor de una coordenada; requiere `HERE_PLACES_ENABLED=true` y `HERE_API_KEY`.

## Búsqueda y sugerencias

- Georef se consulta primero. Si devuelve coincidencias sin coordenadas utilizables, se intenta Nominatim con calle, altura, ciudad y provincia.
- El cliente elimina prefijos genéricos de vía (`Calle`, `Avenida`, `Av.`, etc.) y compara tokens de la calle, tolerando variantes como `Calle Libertad` / `Avenida Libertad`.
- Si la altura exacta no aparece, se prueban alturas vecinas de la misma calle (`-1, +1, -2, +2, -10, +10, -100, +100`) y se devuelven hasta cinco sugerencias en un `404`; nunca se agregan automáticamente.
- Todas las consultas a Nominatim comparten un lock de archivo entre procesos del mismo host, un intervalo mínimo de 1.1 s y caché. Las sugerencias cercanas tienen un presupuesto máximo configurable (`NOMINATIM_NEARBY_BUDGET_SECONDS`, 6 s por defecto) para acotar la latencia de un 404 sin resultados.
- HERE es opcional y se activa con `HERE_ENABLED=true` y `HERE_API_KEY`. Los resultados `PA`/`MPA` se devuelven como candidatos; los `interpolated` se devuelven como sugerencias aproximadas. Ante HTTP 429 se reintenta de forma acotada (`HERE_MAX_RETRIES`, `HERE_RETRY_DELAY`).
- Los lugares cercanos usan HERE Browse y se activan por separado con `HERE_PLACES_ENABLED=true`. La respuesta se cachea `HERE_PLACES_CACHE_TTL` segundos y no se persiste.

## Rutas

- Proveedor: HeiGIT/OpenRouteService Directions v2 (`ROUTING_BASE_URL`) y VROOM (`ROUTING_OPTIMIZATION_URL`, default `https://api.heigit.org/vroom/v0`).
- Perfiles: `walking` → `foot-walking`, `driving` → `driving-car`, `cycling` → `cycling-regular`.
- Límite actual: 2 a 20 puntos.
- `optimizar=true` usa VROOM para reordenar; el primer elemento del arreglo `puntos` es el inicio y el índice `fin` define el final. El frontend permite elegir ambos.
- Cuotas gratuitas de referencia: Directions 2.000/día y optimización 500/día.
- La ruta se cachea `ROUTING_CACHE_TTL` segundos; no se persiste.
- Crear una API key gratuita en <https://account.heigit.org/> y configurarla solo en el backend. La key no se envía al frontend.

## Tests

```bash
source .venv/bin/activate
pytest
```

Los tests simulan Georef, Nominatim y el proveedor de rutas (sin red). La caché se aísla por test.

## Variables de entorno

Ver `.env.example`.
