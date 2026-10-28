# Contrato de API — GeoHuella

Fuente de verdad compartida entre backend y frontend. Base `/api/`. JSON UTF-8. Sin autenticación. Los ejemplos de direcciones son ilustrativos: las respuestas reales dependen de la cobertura y ranking de Georef.

## 1. Salud — `GET /api/salud/`

`200 OK`

```json
{ "estado": "ok" }
```

## 2. Provincias — `GET /api/provincias/`

Proxy de Georef `/provincias`; lista alfabéticamente ordenada y cacheada por 24 horas.

`200 OK`

```json
{ "provincias": ["Buenos Aires", "Catamarca", "Chaco", "Córdoba"] }
```

## 3. Geocodificar — `POST /api/geocodificar/`

Recibe calle, altura, ciudad/localidad y provincia. Devuelve hasta **5 candidatos con coordenadas utilizables**. El frontend presenta los candidatos provisionalmente en el mapa y en una lista; el usuario puede elegir uno o varios para agregarlos. Una búsqueda no agrega elementos ni incrementa el contador de nombres.

### Solicitud

```json
{
  "calle": "Avenida Corrientes",
  "numero": "1000",
  "ciudad": "Ciudad Autónoma de Buenos Aires",
  "provincia": "Ciudad Autónoma de Buenos Aires"
}
```

Validaciones: `calle` obligatoria (texto, máximo 120); `numero` obligatorio, solo dígitos (máximo 6); `ciudad` obligatoria (máximo 80); `provincia` obligatoria y debe pertenecer a la lista de provincias.

### Respuesta

`200 OK`

```json
{
  "resultados": [
    {
      "lat": -34.603669473,
      "lng": -58.380975283,
      "direccion": "AV CORRIENTES 1000, San Nicolás, Comuna 1, Ciudad Autónoma de Buenos Aires",
      "provincia": "Ciudad Autónoma de Buenos Aires",
      "localidad": "San Nicolás",
      "departamento": "Comuna 1",
      "aproximada": true
    }
  ]
}
```

`resultados` contiene de uno a cinco candidatos en una respuesta 200. Se excluyen las entradas de Georef con latitud o longitud nula/inválida, conservando el orden original de Georef. Cuando Georef devuelve coincidencias pero ninguna con coordenadas, el backend usa Nominatim (OpenStreetMap) como respaldo y, si está configurado, HERE Geocoding & Search como último fallback. Si tampoco encuentra un candidato compatible, responde `404 no_encontrada` (no se devuelve un arreglo vacío con 200). Cada candidato tiene coordenadas; `aproximada` es siempre `true`. Para candidatos Georef, `direccion` usa `nomenclatura`; para respaldo Nominatim, usa `display_name`; para HERE, usa `title`. Los datos territoriales se normalizan de los campos anidados de cada proveedor. `departamento` puede ser nulo cuando el proveedor no lo informa.

El fallback Nominatim envía la calle, altura, ciudad y provincia al servicio público de OpenStreetMap. Se ejecuta solo después de que Georef no produzca ubicaciones utilizables, con caché del resultado final y una frecuencia global limitada a no más de una petición por segundo; debe usarse un `User-Agent` identificable y mostrarse atribución `© OpenStreetMap contributors`. Los datos pueden ser incompletos y no se garantiza encontrar todas las direcciones.

El fallback HERE es opcional, se ejecuta solo con `HERE_ENABLED=true` y una `HERE_API_KEY` configurada en el backend, y solo después de que Georef y Nominatim no produzcan un candidato exacto. Los resultados con `houseNumberType` `PA` o `MPA` se devuelven como candidatos 200; los resultados `interpolated` se devuelven como sugerencias aproximadas dentro del 404. La API key nunca se expone al frontend. Revisar los términos y el plan de almacenamiento de HERE antes de persistir resultados.

Para las sugerencias cercanas, el backend prueba un conjunto acotado de alturas vecinas de la misma calle (`-1, +1, -2, +2, -10, +10, -100, +100`), reutilizando el flujo exacto, el límite de frecuencia y la caché. Nunca consulta calles adyacentes. Devuelve como máximo cinco sugerencias; si ninguna altura vecina es ubicable, responde `404` sin `sugerencias`. Por implicar varias consultas al mismo servicio público, un 404 con sugerencias puede tardar varios segundos.

El backend solicita como máximo 5 entradas a Georef (`max=5`) y filtra las que carecen de coordenadas, por lo cual puede devolver menos de cinco candidatos aunque el total reportado por Georef sea mayor. **No** se exige detectar ni informar todos los candidatos posibles de la base; la interfaz deja claro que son coincidencias sugeridas, no un inventario exhaustivo.

### Error sin candidato ubicable y sugerencias cercanas

Si la respuesta de Georef es válida, pero no queda ningún resultado con coordenadas válidas ni el fallback exacto produce un candidato con altura/provincia/localidad coincidentes, el endpoint responde 404 (por lo tanto, las respuestas 200 siempre contienen al menos un candidato):

`404 Not Found`

```json
{
  "error": {
    "codigo": "no_encontrada",
    "mensaje": "No encontramos esa altura exacta. Revisá la dirección o elegí una ubicación cercana sugerida.",
    "sugerencias": [
      {
        "lat": -27.7885,
        "lng": -64.2621,
        "direccion": "630, Avenida Libertad, Santiago del Estero, Argentina",
        "provincia": "Santiago del Estero",
        "localidad": "Santiago del Estero",
        "departamento": "Capital",
        "aproximada": true
      }
    ]
  }
}
```

`error.sugerencias` es opcional; cuando existe contiene hasta 5 ubicaciones alternativas numeradas sobre la misma calle y en la misma ciudad/provincia, próximas a la altura solicitada. Nunca se agregan automáticamente. Si no se encuentran coincidencias cercanas fiables, se conserva el error `no_encontrada` sin sugerencias. Las sugerencias provistas por Nominatim o HERE pueden ser aproximadas y deben ser elegidas explícitamente por la persona. Las alturas `interpolated` de HERE se presentan como aproximadas, nunca como coincidencia exacta.

## 4. Ubicar coordenadas — `POST /api/ubicar-coordenadas/`

Valida coordenadas y consulta la unidad territorial que las contiene mediante Georef `/ubicacion`.

### Solicitud

```json
{ "lat": -27.7951, "lng": -64.2615 }
```

`lat` y `lng` deben ser números JSON finitos; latitud entre -56 y -21 y longitud entre -74 y -53. Fuera de esos rangos responde 422.

### Respuesta

`200 OK`

```json
{
  "lat": -27.7951,
  "lng": -64.2615,
  "direccion": "Santiago del Estero, Santiago del Estero",
  "provincia": "Santiago del Estero",
  "departamento": "Capital"
}
```

Si Georef no informa unidad territorial, devuelve 200 y campos territoriales nulos:

```json
{
  "lat": -27.7951,
  "lng": -64.2615,
  "direccion": null,
  "provincia": null,
  "departamento": null
}
```

## 5. Ruta — `POST /api/ruta/`

Calcula una ruta por calles entre 2 y 20 huellas. Requiere `ROUTING_ENABLED=true` y `ROUTING_API_KEY` configurada en el backend; la key nunca se expone al frontend. Usa HeiGIT/OpenRouteService Directions v2 para la geometría y VROOM para la optimización opcional del orden.

```json
{
  "puntos": [
    { "lat": -27.784, "lng": -64.267 },
    { "lat": -27.782, "lng": -64.265 }
  ],
  "perfil": "walking",
  "volver_al_inicio": false,
  "optimizar": false
}
```

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `puntos` | array | sí | Entre 2 y 20 puntos con `lat`/`lng` numéricos, finitos y dentro de Argentina. |
| `perfil` | string | no | `walking` (default), `driving` o `cycling`. |
| `optimizar` | boolean | no | Default `false`. Si es `true`, VROOM reordena las huellas; el primer punto de la lista se mantiene como inicio. |
| `volver_al_inicio` | boolean | no | Default `false`. Si es `true`, agrega el primer punto al final del recorrido. Funciona con y sin optimización. |

`200 OK`

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
        "properties": { "summary": { "distance": 2450.4, "duration": 1800 } }
      }
    ]
  },
  "distancia_metros": 2450.4,
  "duracion_segundos": 1800,
  "orden": [0, 1]
}
```

- `ruta` es GeoJSON listo para MapLibre.
- `orden` contiene índices del array `puntos` en el orden recorrido. Con `optimizar=false` es la identidad; con `optimizar=true` puede cambiar, conservando `0` como inicio. Con `volver_al_inicio=true`, el índice `0` se repite al final.
- La ruta y el orden optimizado se cachean durante `ROUTING_CACHE_TTL` segundos y no se persisten en `localStorage`.
- Solo se envían coordenadas y perfil al proveedor; no se envían nombres de lugares.

## 6. Errores uniformes

Todos los errores usan esta envoltura JSON:

```json
{
  "error": {
    "codigo": "no_encontrada",
    "mensaje": "No se pudo ubicar la dirección. Revisá la calle, el número y la ciudad."
  }
}
```

| HTTP | `codigo` | Uso |
|---|---|---|
| 400 | `solicitud_invalida` | JSON mal formado, campos faltantes o validación de campos. |
| 404 | `no_encontrada` | Georef y el fallback exacto no hallaron ubicación; puede incluir opcionalmente `error.sugerencias` con hasta 5 alturas cercanas de la misma calle/localidad/provincia. |
| 422 | `fuera_de_rango` | Coordenadas fuera de la caja geográfica acordada para Argentina. |
| 429 | `demasiadas_solicitudes` | Límite de solicitudes del backend. |
| 502 | `servicio_no_disponible` | Georef/Nominatim falló, agotó el timeout o devolvió una respuesta inesperada. Un fallo de HERE se degrada a las sugerencias disponibles, no a 502. |
| 502 | `routing_no_disponible` | El proveedor de rutas o la optimización falló, agotó el timeout o devolvió una respuesta inválida. |
| 503 | `routing_no_configurado` | `ROUTING_ENABLED` está apagado o falta `ROUTING_API_KEY`. |

Los errores 400 pueden incluir `campos`, con mensajes por campo:

```json
{
  "error": {
    "codigo": "solicitud_invalida",
    "mensaje": "Revisá los campos indicados.",
    "campos": { "numero": "Debe contener solo dígitos." }
  }
}
```

## 7. Contrato visual de sugerencias

- En un 404 con `error.sugerencias`, el frontend muestra una sección separada “Ubicaciones cercanas” con dirección y punto de mapa por candidato. Se informa que no se encontró la altura exacta.
- La persona puede seleccionar una o varias sugerencias y agregarlas explícitamente. Nunca se agregan automáticamente ni se presentan como coincidencia exacta.
- Mostrar el indicador de aproximación “Cercana · verificá antes de agregar”. Los marcadores de sugerencias usan estilo distinto a candidatos exactos.
- Una respuesta 404 sin `sugerencias` conserva el estado de error no encontrado normal.

## 8. Reglas compartidas del cliente

- El frontend agrega candidatos elegidos como elementos locales; no existe endpoint para guardar ni eliminar elementos.
- El nombre se asigna en el cliente. El contador monotónico solo avanza cuando se crea un elemento sin nombre provisto por el usuario; buscar candidatos o crear elementos con nombre personalizado no lo incrementa. Borrar elementos nunca reduce el contador ni reutiliza números.
- Para coordenadas pegadas, `lat, lng` requiere punto decimal (`-27.7951, -64.2615`) y `lat; lng` admite coma decimal (`-27,7951; -64,2615`). En campos separados, se admite punto o coma como separador decimal. No se interpretan miles.
