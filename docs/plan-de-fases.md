# Plan de fases y control de agentes

El usuario conserva la última palabra. El orquestador coordina, asigna fases, espera a que el agente termine y quede `idle`, audita sus cambios y solo entonces solicita autorización del usuario para avanzar. Ningún agente inicia la fase siguiente por iniciativa propia.

## Roles

- **Orquestador (este agente):** único responsable de documentación/contrato, estructura raíz, integración y auditoría. No implementa backend ni frontend salvo reparación puntual autorizada después de informar al usuario.
- **Agente Backend — pane Herdr `wD:pW`:** propietario exclusivo de `backend/`.
- **Agente Frontend — pane Herdr `wD:pV`:** propietario exclusivo de `frontend/`.

Los agentes deben detenerse al final de cada fase y reportar archivos tocados, pruebas ejecutadas/resultados, decisiones, problemas y pendientes. Si la tarea entra en conflicto con el contrato, no lo cambian: paran y preguntan al orquestador. El orquestador audita mientras ambos agentes están detenidos y solicita al usuario aprobación antes de habilitar la fase siguiente.

## Fase 0 — Orquestador — TERMINADA

- Creada estructura de monorepo y documentación inicial.
- Escrito contrato API y notas de verificación de Georef.
- Decidido que la búsqueda de direcciones devuelve hasta cinco candidatos ubicables como previsualización seleccionable.
- No se delegan cambios hasta que el usuario apruebe la auditoría de Fase 0.

## Fase 1A — Backend — TERMINADA Y AUDITADA

Agente: `wD:pW`.

Implementar Django + DRF dentro de `backend/` según `docs/contrato-api.md`, con servicio Georef separado, configuración por entorno, caché/throttling, errores normalizados y tests con Georef simulado. Verificar antes de finalizar `/ubicacion` en el servicio real y anotar resultado/payload en `docs/notas-georef.md` mediante el orquestador (no editar docs directamente). No tocar otras carpetas.

Criterio de salida: código y pruebas terminados; sin cambios fuera de `backend/`; agente detenido/idle; resumen con pruebas y gotchas.

## Fase 1B — Frontend — TERMINADA Y AUDITADA

Agente: `wD:pV`.

Implementar React/Vite dentro de `frontend/` según el contrato vigente: mapa Leaflet, candidatos de dirección con selección múltiple, lista/persistencia local, formulario de coordenadas, marcadores con desplazamiento visual ante coincidencia, tema oscuro y tests. La capa API puede usar mock o backend configurable. No tocar otras carpetas ni modificar el contrato.

Criterio de salida: código y pruebas terminados; sin cambios fuera de `frontend/`; agente detenido/idle; resumen con pruebas y pendientes.

## Auditoría y autorización

Las fases de backend y frontend podrán correr en paralelo solo después de autorización explícita del usuario. Al completar ambas (o cuando el usuario solicite auditar una fase individual), el orquestador inspecciona diff y fronteras de carpeta, comprueba tests y correspondencia con el contrato, informa hallazgos y solicita aprobación. No se continúa a integración hasta el visto bueno del usuario.

## Fase 2 — Integración local — COMPLETADA CON LIMITACIONES DOCUMENTADAS

Autorizada por el usuario el 2026-10-22. Configurados `.env` locales (ignorados por Git), CORS limitado a `http://localhost:5174`, y documentado el arranque conjunto. Un único `npm run dev` usa Concurrently para levantar Django y Vite en paralelo. Ambos servidores se levantaron; salud, CORS, provincias, geocodificación de Corrientes 1000 (CABA) y ubicación inversa de `(-27.7951, -64.2615)` respondieron correctamente. Las pruebas backend y frontend también pasaron durante la integración.

Resultado detallado en `docs/resultado-integracion.md`. Se verificó con Chrome headless flujo real de dirección, múltiples candidatos, selección/alta, recarga y viewport móvil; también API de ubicación inversa, tiles y atribución. Quedan escenarios de interacción y accesibilidad expresamente listados como no verificados en ese informe. La integración local se considera completada para el alcance del piloto, con limitaciones documentadas. No avanzar a despliegue u otra etapa sin aprobación del usuario.


## Fase 2.1 — Migración de mapa a MapLibre — IMPLEMENTADA, PENDIENTE DE VERIFICACIÓN

Se reemplazó la capa raster de Esri y Leaflet por MapLibre GL JS con el estilo vectorial oscuro de OpenFreeMap, para permitir zoom hasta nivel 20 sin tiles de “mapa no disponible”. Cambios y diagnóstico en [`migracion-maplibre.md`](migracion-maplibre.md). No se avanzó a la verificación funcional completa. Queda pendiente probar el mapa migrado, el selector de provincia y el flujo completo en navegador antes de cerrar la etapa.

## Etapa v0.2.0 — Importación masiva — IMPLEMENTADA, PENDIENTE DE APROBACIÓN

Autorizada por el usuario. El alcance funcional y los criterios están en [`fase-1-importacion-masiva.md`](fase-1-importacion-masiva.md); el contrato, en [`contrato-api.md`](contrato-api.md) §4.

- Backend: `POST /api/geocodificar-lote/` de 1 a `GEOCODIFICAR_LOTE_MAX` filas (default 10) sobre la lógica compartida, con errores aislados por fila y criterio conservador de exactitud de Georef (altura coincidente, localidad/provincia compatibles y calle con la misma cantidad de tokens y como máximo una edición de carácter en total).
- Frontend: acción **Importar** con texto pegado y CSV (detección y mapeo de columnas), revisión editable por fila, defaults explícitos de ciudad/provincia, límite `IMPORT_MAX_FILAS` (100), procesamiento secuencial en bloques de 10 con progreso y cancelación del cliente (no detiene el backend), selección explícita de candidatos aproximados, duplicados y confirmación antes de persistir en `localStorage`.
- Rutas: se conserva el máximo de 20 huellas, con aviso accesible del límite y elección de subconjunto cuando la lista es mayor; sin división automática en tramos.
- Verificación: `pytest` y `manage.py check` del backend, `npm test` y `npm run build` del frontend en verde; smoke E2E local con servicios reales ejecutado antes del cierre (informe a cargo del orquestador).
- Pendiente: aprobación final del usuario y tareas de publicación (CI/E2E, accesibilidad, configuración de producción).
