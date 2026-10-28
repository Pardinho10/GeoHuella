# Notas verificadas de Georef

Verificación inicial de Fase 0. Consultas ejecutadas contra la API pública v2.0 el 2026-10-22, desde el entorno de desarrollo. La especificación oficial se enlaza desde <https://www.argentina.gob.ar/datos-abiertos/georef/openapi> y actualmente publica el documento OpenAPI en el repositorio oficial <https://raw.githubusercontent.com/datosgobar/georef-ar-api/master/public/openapi.json>.

## Comportamiento observado

- El servicio base responde en `https://apis.datos.gob.ar/georef/api/v2.0`.
- `GET /provincias?campos=nombre&max=3` devolvió `cantidad`, `inicio`, `parametros`, `provincias` (objetos `{id, nombre}`) y `total`. La respuesta de ejemplo incluyó Ciudad Autónoma de Buenos Aires, Neuquén y San Luis; el subconjunto depende del ordenamiento/paginación por defecto, por lo que hay que solicitar las 24 provincias (`max=25`) y ordenar localmente.
- La operación de direcciones de OpenAPI es `GET /direcciones`. Parámetros confirmados: `direccion`, `provincia`, `localidad` o `localidad_censal`, `max`, entre otros. El campo `direccion` no debe incluir datos de localidad. La respuesta tiene `direcciones`, `cantidad`, `total`, `parametros`; cada dirección puede incluir `nomenclatura`, `ubicacion: {lat, lon}`, `provincia`, `localidad`, `localidad_censal` y `departamento`.
- `/ubicacion` usa `lat` y `lon` (no `lng`) como parámetros de longitud/latitud, según OpenAPI oficial.
- Georef puede incluir candidatos sin coordenadas (`lat: null`, `lon: null`). El backend debe filtrar esos registros antes de exponerlos como ubicaciones seleccionables.
- El parámetro `max` limita los registros devueltos, no el total de coincidencias. La API puede informar un `total` mucho mayor que los candidatos de la página. El piloto muestra los primeros candidatos ubicables dentro de la página de hasta cinco registros y no afirma que sea una lista exhaustiva.

## Consultas reales de direcciones

Solicitudes realizadas a `/direcciones` con `direccion`, `provincia`, `localidad` y `max=5`:

| Entrada | Total Georef | Entradas devueltas | Observación |
|---|---:|---:|---|
| Avenida Corrientes 1000, Ciudad Autónoma de Buenos Aires | 86 | 5 | Primer registro sin coordenadas; segundo ubicable en San Nicolás, Comuna 1 (`-34.603669473, -58.380975283`). Otros registros devueltos también sin coordenadas. |
| Florida 100, Ciudad Autónoma de Buenos Aires | 14 | 2 | Uno sin coordenadas y otro ubicable en San Nicolás, Comuna 1 (`-34.606866379, -58.375036384`). |
| Colón 500, Córdoba, Córdoba | 88 | 1 | Un resultado ubicable: `AV COLON 500, Córdoba, Capital, Córdoba` (`-31.411629297, -64.189803317`). |
| San Martín 1000, Mendoza, Mendoza | 101 | 5 | Hubo coincidencias ambiguas; una coincidencia ubicable es `AV GRL SAN MARTIN 1000, Mendoza, Capital, Mendoza` (`-32.891678704, -68.839684366`). |
| Mitre 500, San Carlos de Bariloche, Río Negro | 24 | 2 | Dos entradas equivalentes; una con coordenadas (`-41.134253582, -71.302714169`) y otra sin ellas. |
| Avenida Belgrano 1200, Santiago del Estero | 107 | 2 | Devolvió Belgrano Norte y Belgrano Sur, ambas sin coordenadas. No son candidatos ubicables; el endpoint piloto debe responder `404 no_encontrada`. |

## Consecuencias para la implementación

1. Enviar la calle y altura juntas en `direccion` (por ejemplo, `Avenida Corrientes 1000`) y ciudad/provincia como filtros separados. Usar filtros de provincia/localidad confirmados por OpenAPI.
2. Solicitar hasta cinco registros y transformar únicamente entradas con coordenadas numéricas y finitas. Nombres de campos Georef: longitud `lon`; el contrato propio usa `lng`.
3. Conservar el orden de Georef. Puede haber registros duplicados o con nomenclaturas iguales; si dos candidatos tienen igual nomenclatura y coordenadas, se pueden deduplicar para no presentar duplicados idénticos. No descartar candidatos diferentes por mera similitud del texto.
4. Mostrar los candidatos resultantes como previsualización antes de guardarlos. No hay garantía de que la página de cinco entradas contenga cinco candidatos ubicables ni que incluya todas las coincidencias del total.
5. Una verificación adicional debe probar explícitamente `/ubicacion` antes de dar por finalizada la implementación de backend. No se anotan resultados de esa llamada en esta primera pasada.

## Fallback Nominatim (OpenStreetMap)

Autorizado por el usuario para cubrir coincidencias reconocidas por Georef que no tienen coordenadas. OpenStreetMap Nominatim se consulta desde el backend solo si el lote de Georef no produjo candidatos ubicables.

- Política oficial: <https://operations.osmfoundation.org/policies/nominatim/>. Exige máximo absoluto de 1 petición/segundo, `User-Agent` o `Referer` válido identificando la aplicación, atribución visible y limita usos pesados. El piloto usa un lock de archivo compartido entre procesos del mismo host y un intervalo fijo de 1.1 s entre solicitudes; en Windows o si el lock no está disponible, degrada a un lock por proceso.
- API oficial búsqueda: <https://nominatim.org/release-docs/latest/api/Search/>. Se usa búsqueda estructurada con `street`, `city`, `state`, `country=Argentina`, `format=jsonv2`, `addressdetails=1`, `limit=5`.
- Consulta de prueba autorizada por el usuario para «Calle Libertad 640, Santiago del Estero»: Nominatim con `street=640 Libertad` devolvió la entrada de casa `house_number=640`, `road=Avenida Libertad`, ciudad/provincia Santiago del Estero, coordenadas `-27.7885803, -64.2621877`, `display_name` incluye Centro, Santiago del Estero, Argentina. La consulta literal `640 Calle Libertad` no encontraba el resultado; el backend elimina prefijos genéricos de vía (Calle, Avenida, Av., etc.) antes de formar el campo street.
- **Sugerencias de alturas cercanas:** si la altura exacta no aparece, se prueban alturas vecinas de la misma calle (`-1, +1, -2, +2, -10, +10, -100, +100`), como máximo cinco resultados y sin consultar calles adyacentes. Cada prueba reutiliza el flujo exacto, el límite de frecuencia y la caché por altura. La búsqueda tiene un presupuesto configurable (`NOMINATIM_NEARBY_BUDGET_SECONDS`, 6 s por defecto) para no bloquear un worker indefinidamente; si se agota, se devuelven las sugerencias encontradas hasta ese momento. Si no hay coincidencias, se devuelve `404 no_encontrada` sin sugerencias. Se descartó Overpass para el piloto porque los endpoints públicos probados respondieron con lentitud, timeout o HTTP 502; la alternativa acotada mantiene el uso de Nominatim predecible.
- Se exige coincidencia de provincia, localidad y número de altura para descartar resultados homónimos irrelevantes. Si el fallback no es concluyente, no inventar una ubicación. Las sugerencias siguen siendo aproximadas y requieren selección explícita.
- Si la búsqueda exacta con ciudad/provincia no devuelve el número, se hace un segundo intento estructurado sin `city`/`state` (solo `street` y `country=Argentina`, `limit=40`) y se vuelve a validar calle, número, ciudad y provincia localmente. Esto cubre diferencias de nomenclatura territorial sin relajar la validación.

## Fallback HERE (opcional)

- HERE Geocoding & Search se consulta solo si `HERE_ENABLED=true`, `HERE_API_KEY` está configurada y Georef/Nominatim no produjeron un candidato exacto.
- Consulta real del 2026-10-28 para «Perú 781, Santiago del Estero»: HTTP 200, `resultType=houseNumber`, `houseNumberType=interpolated`, `position=-27.77751, -64.26501`, `address.houseNumber=781`, ciudad/provincia Santiago del Estero.
- Al ser `interpolated`, el backend lo devuelve como sugerencia aproximada, no como resultado exacto. Los tipos `PA`/`MPA` sí se devuelven como candidatos.
- La API key se guarda solo en `backend/.env` (`HERE_API_KEY`) y nunca se expone al frontend. Revisar la cobertura, los términos y el plan de almacenamiento vigentes de HERE antes de persistir resultados.
- El cliente reintenta una vez los HTTP 429 usando `HERE_MAX_RETRIES` y `HERE_RETRY_DELAY`, respetando `Retry-After` con un tope de 3 segundos. Si el límite persiste, el endpoint sigue funcionando con las sugerencias de OpenStreetMap.

## Limitaciones de la verificación

La especificación referenciada en el HTML antiguo de `/datos-abiertos/georef/openapi` es una interfaz/portal, no el JSON mismo. El portal enlaza el OpenAPI oficial en GitHub. Las consultas reales iniciales cubrieron direcciones de CABA, Córdoba, Mendoza, Río Negro y Santiago del Estero; sus resultados pueden variar a medida que se actualizan las bases de datos de los proveedores. La política del servidor público Nominatim puede cambiar; revalidarla antes de escalar el uso. Un 404 con sugerencias puede tardar varios segundos porque implica varias consultas acotadas al mismo servicio, y las sugerencias dependen de que existan alturas vecinas en OpenStreetMap.
