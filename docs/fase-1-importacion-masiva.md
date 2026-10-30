# Fase 1 — v0.2.0: Importación masiva de direcciones

## Objetivo

Permitir pegar o importar un CSV con direcciones, geocodificarlas sin bloquear la interfaz, revisar cada coincidencia, corregir filas y agregar explícitamente los puntos válidos. En v0.2.0 se implementan texto pegado y CSV; Excel queda fuera hasta validar una dependencia segura y mantenida.

## Decisiones cerradas para esta fase

- Máximo de 100 filas totales por importación.
- `POST /api/geocodificar-lote/` procesa hasta 10 filas por solicitud.
- El frontend hace solicitudes secuenciales por bloque, presenta progreso y no envía más de un bloque en paralelo. El backend reutiliza clientes/cachés existentes; el rate-limit global de Nominatim sigue vigente entre todos los procesos del host.
- Todas las filas deben ser sintácticamente válidas antes de empezar el trabajo del lote. Una fila inválida devuelve 400 con errores por índice/id; así no se oculta ningún error de entrada.
- Los fallos de proveedor se aíslan por fila y el endpoint siempre devuelve los demás resultados. Los errores de proveedor se representan con estado `error` en la fila, no con 502 para todo el lote.
- Una dirección no se agrega automáticamente: el usuario confirma la selección en la revisión. Ningún candidato de estado `ambigua` se selecciona previamente; elegir un radio marca explícitamente la fila para agregar.
- Reutilizar las respuestas y la semántica de `/api/geocodificar/`. Para el estado del lote, Georef solo se clasifica exacto con altura coincidente y calle verificada (igualdad tras normalizar o una edición de carácter en total, sin tokens agregados/eliminados), sin contradicción territorial. Si la calle no puede verificarse o la discrepancia excede la tolerancia, es aproximado y requiere selección explícita. HERE interpolado y alturas vecinas de Nominatim siempre son aproximados; ver contrato §4.
- El modo mock devuelve resultados deterministas para permitir probar parser, revisión, cancelación y duplicados sin proveedores reales.
- No agregar librerías de Excel ni dependencias externas sin evaluación y aprobación.

## Contrato `POST /api/geocodificar-lote/`

### Solicitud

```json
{
  "filas": [
    {
      "id": "fila-1",
      "calle": "Perú",
      "altura": "781",
      "ciudad": "Santiago del Estero",
      "provincia": "Santiago del Estero"
    }
  ]
}
```

Reglas:

- `filas`: arreglo no vacío, máximo configurable `GEOCODIFICAR_LOTE_MAX` (default 10 por solicitud).
- Cada `id` es string no vacío, único dentro del lote, máximo 80 caracteres.
- `calle`: requerido, máximo 120 caracteres.
- `altura`: requerido, solo dígitos, máximo 6 caracteres.
- `ciudad`: requerida, máximo 80 caracteres.
- `provincia`: requerida; misma validación y lista oficial que `/api/geocodificar/`.
- Límite por importación (`IMPORT_MAX_FILAS`, default 100) es responsabilidad del cliente y se mantiene además de los topes del endpoint.
- Campo faltante, tipo incorrecto, longitud excesiva, id repetido, provincia inválida o fila inválida: HTTP 400, con el formato uniforme de errores y `error.campos` con errores indexados/identificables por fila.
- El batch no ofrece streaming; una llamada como máximo procesa 10 filas y responde una vez completo.

### Respuesta `200 OK`

Siempre hay un resultado en el mismo orden de entrada y con el mismo `id`:

```json
{
  "resultados": [
    {
      "id": "fila-1",
      "estado": "ambigua",
      "candidatos": [
        {
          "lat": -27.77751,
          "lng": -64.26501,
          "nombre": "Perú 781",
          "direccion": "PERU 781, Santiago del Estero, Capital, Santiago del Estero",
          "proveedor": "here",
          "aproximada": true
        }
      ],
      "mensaje": null
    }
  ]
}
```

Estados:

- `encontrada`: exactamente un candidato y no aproximado.
- `ambigua`: más de un candidato exacto o cualquier candidato aproximado. Cada candidato preserva `aproximada` y campos públicos del contrato de geocodificación. Ningún candidato ambiguo queda seleccionado automáticamente, incluso si solo hay una ubicación aproximada.
- `sin_resultado`: equivalente a `no_encontrada` sin sugerencias.
- `error`: error de proveedor para esta fila; `mensaje` describe la falla en lenguaje claro, sin URL, stack trace ni credenciales.

`candidatos` tiene máximo 5; será vacío para `sin_resultado` y `error`. Si búsqueda normal y sugerencias aproximadas resultan vacías, clasificar `sin_resultado`. Los candidatos no se guardan en backend ni en `localStorage` hasta que el usuario los seleccione y confirme.

### Semántica de compatibilidad

El endpoint no puede cambiar el comportamiento de `/api/geocodificar/`. Debe llamar la misma lógica compartida, no duplicar reglas HERE/Nominatim ni crear una vía que evada la política de Nominatim. Los errores transitorios se aíslan por fila; no registrar las direcciones completas.

## UI acordada

1. Añadir acción **Importar** a la sección “Tus puntos”.
2. Pestañas/controles **Pegar texto** y **Subir CSV**. Texto: una dirección completa por línea. El parser separa nombre opcional y calle/altura/ciudad/provincia cuando puede; si no puede inferir los campos obligatorios, muestra una fila editable y solicita datos, nunca inventa la provincia.
3. CSV con encabezados en castellano e inglés común (`nombre/name`, `calle/street/address`, `altura/numero/number`, `ciudad/localidad/city`, `provincia/province/state`). Detectar encabezados y permitir mapear columnas; archivo UTF-8, con BOM opcional, delimitadores coma o punto y coma, campos entrecomillados y saltos de línea CRLF/LF.
4. Default configurable en la UI: ciudad y provincia aplicables a filas incompletas. Valores por defecto explícitos del formulario, no inferencias ocultas.
5. Revisar y corregir campos antes de geocodificar. Validar 100 filas y longitudes.
6. Procesar bloques secuenciales de hasta 10. Mostrar `resueltas / total`, botón **Cancelar**. Cancelar evita iniciar más bloques; el cliente aborta la espera HTTP del bloque en vuelo y conserva filas resueltas, marcando restantes como canceladas. Esto no garantiza que Django o el proveedor detenga el trabajo ya iniciado ni que no consuma cuota.
7. Tabla/lista por fila: edición de dirección, reintentar, estados `Pendiente`, `Buscando`, `Encontrada`, `Ambigua`, `Sin resultado`, `Error`, elección explícita de candidato, cargar coordenadas manuales y descartar.
8. Selección final. Marcar duplicados contra puntos existentes y entre filas seleccionadas: texto sin acentos y normalizado o coordenadas a <= 5 m. Permitir descartar duplicados; no agregarlos dos veces de forma accidental.
9. Botón final **Agregar N huellas al mapa**. Respeta el límite existente de 200. Persistencia usa las claves existentes `piloto-mapa:*`.
10. No alterar la pantalla de búsqueda individual ni el contrato de rutas. La importación no agrega puntos hasta la confirmación final.

## Criterios de aceptación

- Pegar 30 líneas y cargar un CSV de 30 direcciones producen filas independientes y progreso visible sin bloquear la UI.
- Parser cubre CRLF, BOM, comas/punto y coma, comillas, comas dentro de campos y CSV vacío/malformado.
- Varias columnas se mapean o se pueden corregir manualmente.
- Resultados encontrados, ambiguos, sin resultado y errores quedan diferenciados.
- Editar y reintentar una fila no reinicia filas ya resueltas.
- Toda fila `ambigua` mantiene sus radios y checkbox vacíos hasta que la persona elige un candidato.
- Cancelar detiene los bloques siguientes y conserva resultados completos.
- Nunca hay más de 10 filas por llamada ni llamadas frontend paralelas.
- El servicio Nominatim compartido conserva su lock global/intervalo >= 1 s incluso cuando el batch corre desde dos solicitudes/processes.
- Duplicados están marcados antes de agregar; puntos importados persisten tras recargar.
- Ruta existente conserva límite máximo de 20, muestra aviso claro para conjuntos grandes y permite incluir solo las huellas elegidas. La división automática en tramos queda fuera de v0.2.0 para esta fase (requiere confirmar límites y UX).
- Backend `pytest`, Django check, frontend `npm test`, `npm run build` en verde; smoke test local sin exponer keys.
- El smoke no asume un CSV de muestra versionado: generar un archivo temporal fuera del repositorio (por ejemplo en `/tmp`) y borrarlo al finalizar.
