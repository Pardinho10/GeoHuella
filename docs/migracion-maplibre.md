# Migración del mapa a MapLibre GL JS + OpenFreeMap

## Motivo

La capa raster anterior (Esri World Dark Gray Canvas) entrega imágenes de relleno desde zoom 17 en la zona de Santiago del Estero. La respuesta HTTP sigue siendo 200, pero el contenido es la imagen de “map data not available”, por lo que Leaflet no puede mostrar calles con detalle.

Diagnóstico realizado con tiles reales en `Calle Libertad 640`:

- Zoom 13–16: tiles de entre ~10 KB y ~17 KB.
- Zoom 17–20: tiles de 2.521 bytes correspondientes a la imagen de relleno.

## Alternativa elegida

- **MapLibre GL JS 6.16** como renderizador vectorial.
- **OpenFreeMap Dark** (`https://tiles.openfreemap.org/styles/dark`) como estilo base.
- Sin API key ni registro.
- Atribución automática: OpenFreeMap, OpenMapTiles y datos de OpenStreetMap.
- Uso comercial permitido según OpenFreeMap; no ofrece SLA.
- Los tiles vectoriales publicados declaran datos hasta zoom 14. MapLibre los amplía (overzoom) y renderiza calles y etiquetas con nitidez hasta zoom 20, según la prueba visual aislada realizada.

## Cambios técnicos

- Dependencias: se quitaron `leaflet` y `react-leaflet`; se agregaron `maplibre-gl` y `@vis.gl/react-maplibre`.
- Worker de MapLibre configurado para Vite mediante `setWorkerUrl` y `?worker&url`.
- El mapa usa `VITE_MAP_STYLE_URL`, con OpenFreeMap Dark por defecto.
- `maxZoom` se fija en 20.
- Marcadores migrados a componentes `Marker` de MapLibre con `offset` en píxeles para puntos superpuestos.
- Popups migrados a un único `Popup` controlado por estado; el tooltip nativo queda disponible mediante `title`.
- Controles de zoom y atribución adaptados a las clases de MapLibre.
- Estilos y pruebas de interacción actualizados.
- Carga perezosa: `App` importa el componente del mapa con `React.lazy`/`Suspense`; MapLibre, su CSS y el worker quedan en chunks separados que no se descargan en el HTML inicial.

## Pendiente de verificación

La implementación compila, pero todavía no se ejecutó la prueba funcional completa en navegador después de la migración. Queda verificar:

1. Carga real del estilo, worker, fuentes y sprites en Vite.
2. Zoom 18–20 sobre calles de Santiago del Estero.
3. Búsqueda exacta, candidatos, sugerencias y alta de puntos.
4. Marcadores superpuestos y popups.
5. Vista móvil y controles por encima del panel inferior.
6. Consola y red sin errores relevantes.
7. Problema reportado del selector de provincia que se cierra.
