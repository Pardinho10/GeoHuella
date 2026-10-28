# Frontend — GeoHuella

SPA en React + Vite (JavaScript), Bootstrap 5 y MapLibre GL JS con tiles vectoriales de OpenFreeMap. Interfaz en español, con panel cálido editorial sobre mapa oscuro, tipografía Poppins y la paleta `#251605`, `#c57b57`, `#f1ab86`, `#f7dba7`, `#9cafb7`.

## Setup

```bash
cd frontend
npm ci
cp .env.example .env
npm run dev
```

Variables:
- `VITE_API_BASE_URL`: base del backend (ej. `http://localhost:8001`).
- `VITE_USAR_MOCK`: `true` para usar mocks.
- `VITE_MAP_STYLE_URL`: estilo vectorial de MapLibre (default `https://tiles.openfreemap.org/styles/dark`).
  OpenFreeMap no requiere API key y agrega la atribución de OpenFreeMap, OpenMapTiles y OpenStreetMap.

## Tests

```bash
npm test
npm run build
```

## Experiencia

- Panel con cabecera de marca, resumen de puntos, pestañas segmentadas, validación bajo cada campo y estados de carga.
- Resultados de dirección y sugerencias cercanas se muestran en tarjetas; las cercanas están marcadas como aproximadas y solo se agregan tras selección explícita.
- Marcadores cíclicos de la paleta con resplandor bajo. Los puntos coincidentes se separan visualmente sin alterar sus coordenadas.
- Rutas: el botón “Ruta” permite seleccionar entre 2 y 20 huellas, elegir el punto de inicio, caminando/auto/bici, optimizar el orden, ida y vuelta y trazar una línea por calles con distancia y duración. La ruta es temporal y no se guarda.
- Tooltip nativo al pasar el cursor y popup al hacer clic, con nombre, dirección y coordenadas a 6 decimales. El mapa vectorial permite zoom hasta 20; OpenFreeMap publica datos hasta zoom 14 y MapLibre los amplía sin devolver tiles de error.
- Panel colapsable; en móvil se convierte en hoja inferior y los controles de zoom se reubican por encima.

Las sugerencias cercanas dependen de que `GET /api/geocodificar/` devuelva `error.sugerencias` en una respuesta 404. El cliente normaliza esa respuesta para no perder las alternativas. El backend puede completarlas con resultados de Nominatim o de HERE; las alturas interpoladas por HERE se presentan como aproximadas y nunca se agregan automáticamente.

## Estrategia de marcadores coincidentes

Las coordenadas guardadas nunca se mutan. Para elementos coincidentes se calcula un offset en píxeles (`src/lib/marcadores.js`) y se pasa como `offset` al `Marker` de MapLibre, de modo que el hitbox se desplaza junto al icono y cada marcador conserva eventos. Los colores se validan contra la paleta o un hex estricto (`colorSeguro`). El contenido de los popups es JSX de React.
