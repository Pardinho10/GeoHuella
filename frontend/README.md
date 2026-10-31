# Frontend — GeoHuella

Versión actual: `0.2.1`, leída desde `../VERSION` y expuesta en el panel como `v0.2.1`.

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
- `VITE_USAR_MOCK`: `true` para usar mocks, incluido `geocodificarLote`, de modo que la importación completa se puede probar sin backend.
- `VITE_MAP_STYLE_URL`: estilo vectorial de MapLibre (default `https://tiles.openfreemap.org/styles/dark`).
  OpenFreeMap no requiere API key y agrega la atribución de OpenFreeMap, OpenMapTiles y OpenStreetMap.

## Tests

```bash
npm test
npm run build
```

`npm test` cubre, entre otros, el parser CSV/texto, el mapeo de columnas, la validación de filas, el lote secuencial con cancelación, los duplicados, la confirmación de importación y el límite de 20 huellas con aviso de subconjunto en rutas.

## Experiencia

- Panel con cabecera de marca, resumen de puntos, pestañas segmentadas, validación bajo cada campo y estados de carga.
- Resultados de dirección y sugerencias cercanas se muestran en tarjetas; las cercanas están marcadas como aproximadas y solo se agregan tras selección explícita.
- Marcadores cíclicos de la paleta con resplandor bajo. Los puntos coincidentes se separan visualmente sin alterar sus coordenadas.
- Rutas: el botón “Ruta” permite seleccionar entre 2 y 20 huellas, elegir inicio y final, caminando/auto/bici, optimizar el orden, ida y vuelta y trazar una línea por calles con distancia y duración. La ruta es temporal y no se guarda; en ida y vuelta, la ida es sólida y el regreso punteado. Si la lista tiene más de 20 huellas, el panel avisa del límite, indica cuántas quedan fuera y permite elegir un subconjunto (o limpiar la selección) sin borrar puntos; no hay división automática en tramos.
- Lugares cercanos: el botón “Cerca” de cada huella consulta HERE y muestra bares, sanatorios, comercios y otros puntos de interés con categoría y distancia. Los resultados se numeran en el mapa y en la lista; al tocar un marcador o un elemento de la lista se abre una ficha con nombre, categoría, distancia y dirección. La vista se ajusta automáticamente para que todos los puntos queden visibles.
- Tooltip nativo al pasar el cursor y popup al hacer clic, con nombre, dirección y coordenadas a 6 decimales. El mapa vectorial permite zoom hasta 20; OpenFreeMap publica datos hasta zoom 14 y MapLibre los amplía sin devolver tiles de error.
- Panel colapsable; en móvil se convierte en hoja inferior y los controles de zoom se reubican por encima.
- Cada huella se puede editar, subir o bajar dentro de la lista y filtrar por nombre o dirección. El orden de la lista se usa como orden base para las rutas sin optimización.
- Importación masiva v0.2.1: pegar direcciones línea por línea o cargar CSV, mapear/editar columnas, revisar resultados, reintentar filas, detectar duplicados y confirmar qué huellas agregar. Límite de 100 filas; geocodificación secuencial en bloques de hasta 10 con progreso y cancelación entre bloques; estados por fila (pendiente, buscando, encontrada, ambigua, sin resultado, error, cancelada); los candidatos aproximados nunca quedan preseleccionados y requieren elección explícita. Excel queda fuera de esta versión.

Las sugerencias cercanas dependen de que `POST /api/geocodificar/` devuelva `error.sugerencias` en una respuesta 404. El cliente normaliza esa respuesta para no perder las alternativas. El backend puede completarlas con resultados de Nominatim o de HERE; las alturas interpoladas por HERE se presentan como aproximadas y nunca se agregan automáticamente. En la importación masiva, el indicador de una coincidencia aproximada es la etiqueta “Aproximada”, y cancelar solo evita iniciar nuevos bloques: el backend puede terminar el bloque en curso.

## Estrategia de marcadores coincidentes

Las coordenadas guardadas nunca se mutan. Para elementos coincidentes se calcula un offset en píxeles (`src/lib/marcadores.js`) y se pasa como `offset` al `Marker` de MapLibre, de modo que el hitbox se desplaza junto al icono y cada marcador conserva eventos. Los colores se validan contra la paleta o un hex estricto (`colorSeguro`). El contenido de los popups es JSX de React.
