# Backend — GeoHuella

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

- `salud/`: estado del servicio.
- `provincias/`: provincias de Georef.
- `geocodificar/`: búsqueda de direcciones; puede devolver candidatos de Georef o de Nominatim.
- `ubicar-coordenadas/`: unidad territorial para un par lat/lng.

## Búsqueda y sugerencias

- Georef se consulta primero. Si devuelve coincidencias sin coordenadas utilizables, se intenta Nominatim con calle, altura, ciudad y provincia.
- El cliente elimina prefijos genéricos de vía (`Calle`, `Avenida`, `Av.`, etc.) y compara tokens de la calle, tolerando variantes como `Calle Libertad` / `Avenida Libertad`.
- Si la altura exacta no aparece, se prueban alturas vecinas de la misma calle (`-1, +1, -2, +2, -10, +10, -100, +100`) y se devuelven hasta cinco sugerencias en un `404`; nunca se agregan automáticamente.
- Todas las consultas a Nominatim comparten un lock de archivo entre procesos del mismo host, un intervalo mínimo de 1.1 s y caché. Las sugerencias cercanas tienen un presupuesto máximo configurable (`NOMINATIM_NEARBY_BUDGET_SECONDS`, 6 s por defecto) para acotar la latencia de un 404 sin resultados.
- HERE es opcional y se activa con `HERE_ENABLED=true` y `HERE_API_KEY`. Los resultados `PA`/`MPA` se devuelven como candidatos; los `interpolated` se devuelven como sugerencias aproximadas.

## Tests

```bash
source .venv/bin/activate
pytest
```

Los tests simulan Georef y Nominatim (sin red). La caché se aísla por test.

## Variables de entorno

Ver `.env.example`.
