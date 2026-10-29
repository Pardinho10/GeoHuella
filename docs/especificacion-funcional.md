# Especificación funcional — GeoHuella

## Objetivo y alcance

Single page educativa, independiente, con mapa MapLibre GL JS a pantalla completa y panel flotante para crear elementos genéricos de mapa. Cada elemento es exclusivamente un punto geográfico; no modela conceptos de otros sistemas. La búsqueda por dirección puede devolver varios candidatos, que se previsualizan en el mapa y se agregan solo después de que el usuario elige uno o varios. También se pueden ingresar coordenadas directamente.

Incluye rutas por calles entre huellas seleccionadas, con perfiles caminando, auto y bici, y optimización opcional del orden de visita. No incluye autenticación, base de datos de negocio, edición de elementos guardados, importación/exportación, tiempo real, geolocalización, internacionalización, Docker ni despliegue.

## Decisiones de producto

| Tema | Decisión |
|---|---|
| Backend | Django + Django REST Framework; proxy Georef con fallback Nominatim (OpenStreetMap) y, opcionalmente, HERE cuando Georef no ofrece coordenadas |
| Frontend | React + Vite + JavaScript + Bootstrap 5 / react-bootstrap |
| Mapa | MapLibre GL JS + tiles vectoriales de OpenFreeMap (estilo oscuro, sin API key; datos OpenStreetMap/OpenMapTiles) |
| Persistencia | `localStorage`, sin base de datos de negocio |
| Elementos | Genéricos; varios puntos, hasta 200 |
| Búsqueda de dirección | Campos calle, número, ciudad, provincia; mostrar hasta 5 candidatos ubicables y dejar seleccionar uno o varios |
| Selección | Los candidatos se muestran provisionalmente; no se persisten ni cuentan hasta agregarlos explícitamente |
| Nombre automático | Si se agrega un elemento sin nombre, asignar `Elemento N`; el contador solo sube al crear un elemento con nombre automático, no al buscar, no para nombres personalizados y nunca baja al borrar |
| Coordenadas | En campos separados admitir punto o coma decimal. En pegado de par admitir `lat, lng` con puntos decimales o `lat; lng` con comas decimales; sin separadores de miles |
| Puntos superpuestos | Aplicar desplazamiento visual pequeño en píxeles a marcadores coincidentes mediante `offset` de MapLibre; no alterar coordenadas guardadas ni mostradas. El desplazamiento debe recalcularse de modo estable según zoom y conjunto de puntos; la tarjeta y el ajuste de vista usan siempre la posición geográfica real |
| Marca | GeoHuella; cada punto se representa con una huella de perro SVG. Lema: “Cada lugar deja una huella”. |
| Rutas | Entre 2 y 20 huellas seleccionadas; perfiles caminando, auto y bici; opción de optimizar orden e ida y vuelta. La ruta se dibuja en MapLibre y no se persiste. Con ida y vuelta, la ida se muestra sólida y el regreso punteado en otro color, con leyenda en el resumen. |
| Estilo | Panel cálido editorial sobre mapa oscuro, tipografía Poppins y paleta `#251605`, `#c57b57`, `#f1ab86`, `#f7dba7`, `#9cafb7`; interfaz en español |
| Versiones | Estables vigentes fijadas en archivos de dependencias |
| Pruebas | Backend pytest + pytest-django; frontend Vitest + React Testing Library |
| Imágenes de mapa | Atribución automática de OpenFreeMap, OpenMapTiles y OpenStreetMap; comprobar términos vigentes antes de uso superior al piloto |

## Interfaz

- Mapa al 100% de la ventana, inicialmente centrado en Argentina. Zoom mediante botones, rueda y gestos táctiles, hasta nivel 20; mínimo razonable para no alejarse del mundo. El estilo vectorial conserva calles y etiquetas al ampliar.
- Panel flotante izquierdo en escritorio, con transparencia leve, desenfoque, bordes redondeados y opción de colapsar. En celular se transforma en panel inferior colapsable.
- Panel: título breve; pestañas Dirección y Coordenadas; formulario; lista de elementos; contador total. Accesibilidad básica: etiquetas, foco visible, navegación por teclado y botones rotulados.
- Panel claro cálido con texto café oscuro, acentos cobre/durazno, tipografía Poppins, contraste legible, bordes y sombras suaves.

### Dirección

Campos: Nombre (opcional), Calle, Número, Ciudad y Provincia (lista obtenida de la API). Validación local obligatoria: calle (máx. 120), número requerido solo dígitos (máx. 6), ciudad (máx. 80), provincia elegida. Al enviar, mostrar estado de carga y prevenir doble envío. Ante éxito, presentar los candidatos; cada uno muestra dirección y coordenadas y puede previsualizarse/destacarse. Permitir seleccionar uno o varios. Al confirmar, crear los elementos elegidos con sus nombres, limpiar la entrada y conservar la pestaña activa. Si el nombre está vacío, asignar nombres `Elemento N` consecutivos para cada candidato agregado.

### Coordenadas

Campos: Nombre opcional, latitud y longitud. Validar número y caja aproximada argentina: latitud -56 a -21, longitud -74 a -53. Aceptar punto o coma decimal. Pegar `lat, lng` solo con punto decimal o `lat; lng` con coma decimal reparte el par en los campos. Después de validar, consultar `/api/ubicar-coordenadas/`; si no existe unidad territorial, crear el elemento con dirección “Sin dirección disponible”.

### Rutas

El botón “Ruta” abre un panel para seleccionar entre 2 y 20 huellas. Cada fila de la lista se puede marcar o desmarcar; las filas seleccionadas se resaltan. Se eligen el punto de inicio y, opcionalmente, un punto final. También se elige el perfil (Caminando, Auto o Bici) y, opcionalmente, “Optimizar orden” y “Volver al inicio”. El inicio queda primero y el final último en el arreglo enviado; al optimizar, VROOM ordena los intermedios. Final y “Volver al inicio” son excluyentes. “Trazar ruta” llama a `POST /api/ruta/` y muestra una línea GeoJSON sobre el mapa, distancia, duración y cantidad de huellas. La ruta se cachea en el backend y no se guarda en `localStorage`; “Quitar ruta” solo elimina la visualización. Si se elimina una huella usada por la ruta, la ruta se descarta. Los errores del proveedor se muestran dentro del panel de ruta.

### Lugares cercanos

Cada huella guardada tiene una acción “Cerca”. Al activarla se consulta `GET /api/lugares-cercanos/` con las coordenadas de la huella y se muestran hasta cinco lugares de HERE con nombre, categoría, distancia y dirección. La tarjeta aparece sobre la lista de puntos y se puede cerrar. Los resultados se consultan al momento, no se guardan en `localStorage` y solo se cachean en el backend durante un período corto. Si el servicio no está configurado o falla, se muestra un error dentro de la tarjeta sin afectar los puntos ni las rutas.

### Mensajes y mapa

- Validaciones de cliente bajo cada campo, en español. Errores del backend en alerta Bootstrap con mensaje del contrato. Si el servidor no responde: “No se pudo conectar con el servidor”.
- Agregar centra animadamente (`flyTo`) el mapa en el punto real y destaca el marcador brevemente.
- Marcadores propios de MapLibre con colores cíclicos de la paleta (cobre, durazno, arena y gris azulado), borde claro y halo sutil. Colores asignados cíclicamente.
- Tarjeta de detalles en JSX (sin HTML crudo) con nombre, dirección o “Sin dirección disponible”, latitud/longitud a 6 decimales. Tooltip nativo al pasar el cursor y popup al hacer clic, equivalente en dispositivos táctiles.
- Si dos o más elementos tienen la misma coordenada, separar sus iconos un poco en pantalla para que se vean y puedan seleccionarse. Mantener exactos los datos de coordenadas y usar posición verdadera para lista, tooltip y foco; se permite un conector visual sutil.
- Lista con color, nombre, dirección/coordenadas resumidas; clic centra el mapa; acción para eliminar; “Quitar todos” requiere confirmación. Estado vacío explica brevemente cómo agregar el primer punto. Nombres largos se recortan visualmente con puntos suspensivos.
- “Ver todos” ajusta los límites a elementos guardados. Al recargar con elementos guardados, el mapa reencuadra para mostrarlos.

## Persistencia local

Claves: `piloto-mapa:elementos:v1` y `piloto-mapa:contador:v1`. Validar estructura y tipos antes de usar valores leídos. Lectura/escritura siempre en `try/catch`; ante datos corruptos o almacenamiento no disponible iniciar vacío sin bloquear la aplicación. Cada elemento:

```json
{
  "id": "identificador-unico",
  "nombre": "Elemento 1",
  "direccion": "AV CORRIENTES 1000, San Nicolás, Ciudad Autónoma de Buenos Aires",
  "lat": -34.603669473,
  "lng": -58.380975283,
  "color": "#00E5FF",
  "origen": "direccion",
  "creadoEn": "2026-10-22T00:00:00.000Z"
}
```

El contador se conserva aunque se elimine el elemento con el número más alto. Si se supera 200 elementos al seleccionar candidatos múltiples, informar cuántos caben; nunca guardar más de 200.

## Capa de API y pruebas frontend

La interfaz de API en `src/api/` ofrece `obtenerProvincias()`, `geocodificar(direccion)` (devuelve `resultados[]`), `ubicarCoordenadas(lat, lng)` y `calcularRuta({ puntos, perfil, volver_al_inicio })`. `VITE_API_BASE_URL` configura backend y `VITE_USAR_MOCK=true|false` selecciona mock o servicio real.

Pruebas obligatorias: validación, coma decimal y par pegado; lógica de lista (alta, baja, quitar todos, límite y paleta cíclica); localStorage (lectura/escritura/corrupto/no disponible); cliente API para respuestas y errores del contrato; tarjeta JSX con textos y coordenadas; selección y presentación de candidatos múltiples; marcadores coincidentes visibles sin mutar ubicaciones; formato de distancia/duración y flujo de selección, trazado y limpieza de ruta.

## Lista de verificación de integración

1. Backend y frontend arrancan siguiendo el README raíz sin pasos ocultos.
2. Provincias cargan desde backend.
3. Probar al menos cinco direcciones reales de diferentes provincias; candidatos ubicables caen en lugares razonables y el usuario puede seleccionar varios resultados.
4. Probar coordenadas en rango, con coma decimal y coordenadas fuera de Argentina.
5. Dirección inexistente o sin candidatos con coordenadas muestra `no_encontrada`.
6. Backend apagado muestra error de conexión sin romper UI.
7. Tras recargar, lista y mapa recuperan elementos y contador monotónico.
8. Zoom con controles, rueda y gestos; “Ver todos” ajusta extensión.
9. Colores contrastan sobre el mapa oscuro; puntos coincidentes se ven y seleccionan.
10. Ruta: seleccionar 2–20 huellas, elegir inicio y final, probar los tres perfiles, optimización de orden, ida y vuelta, distancia/duración y “Quitar ruta”.
11. Lugares cercanos: abrir “Cerca” en una huella, revisar categorías y distancias, centrar un lugar y cerrar la tarjeta.
12. Panel utilizable en móvil y escritorio.
13. Tests de ambos proyectos pasan.
14. Consola del navegador sin errores ni advertencias relevantes.
