# Propuesta de rutas — GeoHuella

**Estado: Fases 2, 3 y 4 implementadas.** El backend calcula rutas en orden fijo u optimizado, y el frontend permite seleccionar huellas, elegir perfil, optimizar el orden, dibujar la línea y ver distancia/duración. El contrato vigente está en [`contrato-api.md`](contrato-api.md).

## Objetivo

Permitir que la persona seleccione varias huellas y vea el recorrido por calles, con distancia y duración. Opcionalmente, el backend puede optimizar el orden de visita.

## Proveedor sugerido

**HeiGIT/OpenRouteService** (plan Standard gratuito):

- Directions: 2.000 solicitudes/día, 40/minuto.
- Optimización: 500 solicitudes/día, 40/minuto.
- Perfiles: `driving-car`, `foot-walking`, `cycling-regular`.
- Devuelve geometría GeoJSON.
- La API key queda solo en el backend (`ROUTING_API_KEY`).

Alternativas: HERE Routing, GraphHopper, Mapbox Directions u OSRM self-hosted. No se debe consultar un proveedor desde el frontend con una key embebida.

## Endpoint propuesto

```http
POST /api/ruta/
Content-Type: application/json
```

### Request

```json
{
  "puntos": [
    { "lat": -27.784, "lng": -64.267 },
    { "lat": -27.781, "lng": -64.263 },
    { "lat": -27.777, "lng": -64.265 }
  ],
  "perfil": "walking",
  "optimizar": false,
  "volver_al_inicio": false
}
```

Campos:

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `puntos` | array | sí | Entre 2 y 20 puntos con `lat`/`lng` finitos y dentro de Argentina. |
| `perfil` | string | no | `walking` (default), `driving` o `cycling`. |
| `optimizar` | boolean | no | Si es `true`, el proveedor puede reordenar los puntos; el primero del arreglo es el inicio. Default `false`. |
| `volver_al_inicio` | boolean | no | Agrega el primer punto al final. Aplica con y sin optimización. Default `false`. |

### Response 200

```json
{
  "ruta": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": {
          "type": "LineString",
          "coordinates": [[-64.267, -27.784], [-64.265, -27.782]]
        },
        "properties": { "perfil": "walking" }
      }
    ]
  },
  "distancia_metros": 2450.4,
  "duracion_segundos": 1800,
  "orden": [0, 2, 1]
}
```

- `ruta` es GeoJSON listo para MapLibre.
- `orden` contiene índices del array `puntos` en el orden efectivamente recorrido.
- Con `optimizar=false`, `orden` es la identidad `[0, 1, 2, ...]`. Con `optimizar=true`, el orden puede cambiar y `0` se mantiene como inicio.
- `distancia_metros` y `duracion_segundos` son números finitos y no negativos.
- La ruta no se persiste en localStorage; se calcula bajo demanda.

### Errores

| HTTP | Código | Cuándo |
|---|---|---|
| 400 | `puntos_invalidos` | Menos de 2 o más de 20 puntos, coordenadas inválidas o fuera de Argentina. |
| 400 | `perfil_invalido` | Perfil fuera de `walking`, `driving`, `cycling`. |
| 429 | `demasiadas_solicitudes` | Se superó el límite del backend. |
| 502 | `routing_no_disponible` | El proveedor de rutas u optimización falló, agotó el timeout o devolvió una respuesta inesperada. |
| 503 | `routing_no_configurado` | Falta la API key o el servicio está apagado. |

Formato de error, consistente con el resto de la API:

```json
{
  "error": {
    "codigo": "routing_no_disponible",
    "mensaje": "No se pudo calcular la ruta. Intentá nuevamente en unos minutos."
  }
}
```

## Comportamiento en el frontend

1. La persona activa el modo ruta y selecciona entre 2 y 20 huellas.
2. Elige el punto de inicio; ese punto se envía primero en `puntos`.
3. Elige perfil: caminando, auto o bicicleta.
4. Puede activar “Optimizar orden” y “Volver al inicio”.
5. Al confirmar, se llama a `POST /api/ruta/`.
6. La línea se dibuja en MapLibre con una fuente GeoJSON y una capa `line`.
7. Se muestra distancia, duración e inicio.
8. Se ajusta la vista a la ruta completa.
9. “Quitar ruta” elimina la línea y el resumen, sin borrar las huellas.

La línea debe distinguirse de los marcadores y respetar el tema visual. Las huellas siguen siendo la fuente de verdad; la ruta es una visualización temporal.

## Privacidad y límites

- Las coordenadas se envían al proveedor de routing; debe informarse en la interfaz.
- No se envía el nombre del lugar, solo coordenadas y perfil.
- La API key nunca se expone al frontend.
- Cachear rutas idénticas durante un período corto para ahorrar cuota.
- Para más de 20 puntos, no usar optimización exacta: ofrecer solo ruta en orden fijo o una heurística local.
- Revisar términos, atribución y almacenamiento del proveedor antes de producción.

## Fases de implementación

1. ~~Marca GeoHuella y huellas SVG.~~
2. ~~Backend: cliente de routing, endpoint `/api/ruta/`, validación, caché y tests mockeados.~~
3. ~~Frontend: selección de huellas, perfil, línea GeoJSON, distancia/duración y quitar ruta.~~
4. ~~Optimización de orden con límite de puntos y pruebas de error.~~
5. ~~Verificación con una API key real de HeiGIT.~~ Queda revisar cuota/términos antes de producción.
