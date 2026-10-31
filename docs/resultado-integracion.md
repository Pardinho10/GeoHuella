# Resultado de la integración local — 2026-10-22

> Nota: los puertos actuales son frontend `5174` y backend `8001`. Este informe conserva los valores usados en la verificación original (`5173`/`8000`). La verificación con Leaflet corresponde a la etapa previa a la migración; el estado MapLibre está documentado en `migracion-maplibre.md`. Las cifras de tests son las de esa fecha. El payload de `/api/salud/` se muestra con la versión vigente al cierre (0.2.1); la corrida original usó el build de entonces.

## Entorno

- Backend Django en `http://localhost:8000`.
- Frontend Vite en `http://localhost:5173`.
- CORS restringido a `http://localhost:5173`.
- `.env` locales creados desde ejemplos; no versionarlos.
- El frontend está en modo API real (`VITE_USAR_MOCK=false`).

## Verificado

- `GET /api/salud/`: 200 `{ "estado": "ok", "version": "0.2.1" }`.
- `GET /api/provincias/`: 200, 24 provincias; CORS responde con `Access-Control-Allow-Origin: http://localhost:5173`.
- Preflight `OPTIONS` para POST JSON: 200 con métodos/cabeceras CORS esperados.
- `POST /api/geocodificar/` para Avenida Corrientes 1000, CABA: 200 con candidato ubicado (`-34.603669473, -58.380975283`).
- `POST /api/ubicar-coordenadas/` para `(-27.7951, -64.2615)`: 200, Santiago del Estero / Capital.
- Chrome headless contra UI y API real: formulario de dirección, preview de cuatro candidatos para Argentina 200, selección de dos y alta automática `Elemento 1`/`Elemento 2`; localStorage y marcadores se actualizaron.
- Formulario de coordenadas con par pegado `-27,7951; -64,2615`: respondió y añadió un elemento en la corrida de navegador anterior.
- Recarga: recupera elementos y contador.
- Panel colapsable; viewport de 390×844 usa panel inferior, sin overflow horizontal.
- Zoom Leaflet visible, botón “Ver todos” disponible, tiles descargados y atribución visible.
- Interfaz sin errores de consola en la corrida final tras corregir el proveedor de tiles.
- Pruebas tras añadir fallback: backend `pytest` 34 pasaron; `manage.py check` limpio. Frontend Vitest 33 pasaron; build de Vite correcto. Vitest puede emitir advertencia de performance por entornos `jsdom` repetidos, no es fallo.

## Fallback Nominatim para direcciones sin coordenadas

Se añadió fallback de Georef a Nominatim aprobado por el usuario. Ver `docs/notas-georef.md` para la política y consulta verificada. La dirección que motivó el fallback (Calle Libertad 640, Santiago del Estero) ahora responde `200` con un punto en `(-27.7885803, -64.2621877)`; el UI muestra que esa es una ubicación estimada por proveedor externo. El UI informa que Nominatim/OpenStreetMap puede recibir la dirección como servicio externo.

También se verificó el flujo de sugerencias: `Calle Libertad 2098` responde `404 no_encontrada` con alturas cercanas de la misma calle (por ejemplo, 2097 y 2099), coordenadas aproximadas y sin agregarlas automáticamente. El backend prueba un conjunto acotado de alturas vecinas y devuelve como máximo cinco; si no encuentra ninguna, el 404 no incluye `sugerencias`.

## Incidencias/cambios durante integración

1. CARTO raster Dark Matter ahora muestra una imagen de requisito de API key (cambio del proveedor efectivo desde septiembre de 2026). Para que el piloto no apareciera con marca de clave requerida, se cambió el valor por defecto a Esri World Dark Gray Canvas y se actualizó atribución/configuración/README. `VITE_TILE_URL` permite volver a CARTO si se configura una clave autorizada.
2. Chrome solicitaba `/favicon.ico` y recibía 404. Se añadió favicon vacío inline en `frontend/index.html`; ya no se registra ese 404.
3. Georef real varía por dirección y ranking. Ver `notas-georef.md`; por ejemplo, consultas de Buenos Aires/Neuquén/Salta/Corrientes/Córdoba/Mendoza/Río Negro tuvieron candidatos, mientras varias direcciones probadas dieron `no_encontrada`. Santiago del Estero Belgrano 1200 devuelve 404 porque Georef presentó resultados sin coordenadas utilizables.

## Pendiente / no afirmado como verificado

- No se recorrieron con ratón/gestos físicos todos los controles de zoom/táctiles.
- No se verificaron visualmente hover/popup, eliminación, confirmación de “Quitar todos”, error con servidor apagado, 200-element limit, accesibilidad con lector de pantalla ni todas las ciudades del checklist.
- Marcadores coincidentes tienen prueba de desplazamiento/anchor y render React; se recomienda validación visual/manual adicional para todos los casos extremos.
- CARTO Dark Matter requiere key para raster según sus términos actuales; Esri es el default del piloto. Revisar licencias, límites y atribución antes de uso público o intensivo.


## Migración a MapLibre GL JS (implementada, pendiente de verificación)

Se reemplazó Leaflet/react-leaflet por MapLibre GL JS y OpenFreeMap Dark para resolver el límite de zoom de la capa raster anterior. El detalle del diagnóstico y los cambios está en [`migracion-maplibre.md`](migracion-maplibre.md).

El build de producción y las pruebas de interacción del frontend pasaron durante la migración. No se ejecutó todavía la prueba funcional completa en navegador ni la verificación visual posterior a la migración; ese es el siguiente paso antes de considerar cerrada esta etapa.
