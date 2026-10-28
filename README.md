# GeoHuella

**Cada lugar deja una huella.**

Mapa de lugares para buscar direcciones, comparar coincidencias y guardar puntos. Proyecto independiente y educativo para aprender React, MapLibre GL JS y las APIs Georef/OpenStreetMap/HERE. Sin autenticación ni base de datos de negocio.

> Nombre de producto: **GeoHuella**. Carpeta y repositorio interno: `piloto-mapa`.

## Estado

Integración local inicial verificada: backend y frontend arrancan, CORS permite el origen Vite configurado, Georef respondió a una consulta de dirección y a una consulta inversa, y las suites de ambos proyectos pasan. Resta completar la verificación manual de UX (móvil, interacción del mapa y direcciones de distintas provincias); consultar [`docs/especificacion-funcional.md`](docs/especificacion-funcional.md).

## Requisitos

- Python 3.12+
- Node.js 20.19+ o 22.12+
- npm

## Configuración inicial

Desde la carpeta raíz del proyecto:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

En `backend/.env`, para desarrollo local, asegurarse de tener:

```dotenv
CORS_ALLOW_ALL=False
CORS_ALLOWED_ORIGINS=http://localhost:5174
```

Los archivos `.env` locales no se versionan. Cambiar `DJANGO_SECRET_KEY` antes de un entorno no local y revisar `DEBUG`, `ALLOWED_HOSTS`, el límite de solicitudes y las condiciones de uso de Georef/OpenFreeMap.

Para habilitar rutas, crear una API key gratuita en <https://account.heigit.org/> y configurar en `backend/.env`:

```dotenv
ROUTING_ENABLED=true
ROUTING_API_KEY=tu_api_key
```

La key queda solo en el backend.

## Instalar dependencias

Desde la raíz, instalar el coordinador de procesos (Concurrently) y las dependencias frontend/backend:

```bash
npm ci
cd frontend && npm ci
cd ../backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
```

> En Linux/macOS, `npm ci` instala Concurrently para lanzar ambos servidores juntos. En Windows, el script `npm run dev` requiere ajustar el comando backend o ejecutarlo desde WSL.

Terminal 1 — backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py check
pytest
```

Terminal 2 — frontend:

```bash
cd frontend
npm ci
npm test
npm run build
```

## Ejecutar la aplicación

Con las dependencias instaladas y `.env` configurados, desde la raíz basta un solo comando:

```bash
npm run dev
```

Concurrently inicia Django y Vite en paralelo, muestra sus logs prefijados (`backend`/`frontend`) y detiene el otro proceso si uno falla. Abrir <http://localhost:5174>. Para detener ambos, presionar **Ctrl+C**.

Scripts disponibles:

- `npm run dev:backend`: solo Django (requiere `backend/.venv`).
- `npm run dev:frontend`: solo Vite.

El frontend usa el backend real por defecto (`VITE_USAR_MOCK=false`, `VITE_API_BASE_URL=http://localhost:8001`). Mantener `localhost` en ambos servicios evita un origen cruzado por diferencia de hostname. Para trabajar sin backend se puede activar el mock en `frontend/.env` (`VITE_USAR_MOCK=true`) y reiniciar Vite.

## Verificación rápida

- Salud: <http://localhost:8001/api/salud/> debe responder `{"estado":"ok"}`.
- Provincias: <http://localhost:8001/api/provincias/> consulta Georef y devuelve la lista cacheada.
- El formulario Dirección permite revisar y agregar candidatos encontrados.
- El formulario Coordenadas agrega un punto y consulta la unidad territorial.
- `POST /api/ruta/` calcula rutas en orden fijo si `ROUTING_ENABLED=true` y hay API key; sin configurar responde 503.
- Los elementos se conservan en `localStorage`; no se guardan en Django.

Para pruebas aisladas, ejecutar `pytest` dentro de `backend/` y `npm test` dentro de `frontend/`. Las pruebas simulan Georef y no dependen de llamadas externas.

## Estructura

- `backend/`: Django REST Framework, proxy/cache de Georef y pruebas.
- `frontend/`: React, Bootstrap, MapLibre GL JS/OpenFreeMap y pruebas.
- `docs/contrato-api.md`: contrato compartido de API.
- `docs/notas-georef.md`: respuestas observadas de la API oficial.
- `docs/especificacion-funcional.md`: alcance y checklist de producto.
- `docs/rutas-propuesta.md`: diseño y estado de la implementación de rutas.

## Limitaciones conocidas

- Persistencia local por navegador, sin cuentas ni sincronización.
- Georef puede devolver coincidencias sin coordenadas; cuando no hay candidatos ubicables se usa Nominatim como fallback exacto, sujeto a límite de una solicitud por segundo, User-Agent y atribución OpenStreetMap. Si la altura exacta no aparece, se prueban alturas vecinas de la misma calle y se ofrecen hasta cinco sugerencias aproximadas, nunca agregadas automáticamente. Se consultan como máximo cinco candidatos por proveedor; no se garantiza una lista exhaustiva.
- Opcionalmente se usa HERE Geocoding & Search como último fallback. La API key queda solo en el backend (`HERE_API_KEY`). Sus resultados `houseNumberType: interpolated` se muestran como sugerencias aproximadas y requieren selección explícita; revisar los términos y el plan de HERE antes de usarlo en producción.
- Los tests simulan los geocodificadores; el resultado real depende de cobertura, filtros y disponibilidad de los servicios públicos.
- MapLibre usa tiles vectoriales de OpenFreeMap (datos de OpenStreetMap/OpenMapTiles); Georef y OpenFreeMap son servicios externos: revisar sus condiciones, atribución y límites vigentes antes de uso no experimental o de alto volumen.
