# Diagnóstico: backend local que deja de responder

## Síntoma

El frontend sigue cargando en `http://localhost:5174`, pero las solicitudes a `http://localhost:8001` fallan con `net::ERR_CONNECTION_REFUSED`. El navegador puede presentar mensajes adicionales de CORS; con conexión rechazada no hay respuesta HTTP y primero se debe recuperar el servicio.

## Causa encontrada

El proceso Django se ejecutaba como hijo de la terminal/sesión usada para lanzar `npm run dev`. Al finalizar esa sesión, el proceso moría; Vite podía permanecer activo y mostrar una app que no podía hablar con su API. Reiniciar Django a mano solucionaba temporalmente el síntoma, pero no el ciclo de vida del proceso.

## Corrección de desarrollo local

En Linux con systemd de usuario, instalar una vez desde la raíz:

```bash
npm run install:backend-service
```

El servicio `geohuella-backend.service` queda habilitado, reinicia Django si termina inesperadamente y persiste tras cerrar la terminal. Para iniciarlo al arrancar sin login interactivo se habilita linger para el usuario (requiere autorización local cuando el sistema lo exige).

```bash
systemctl --user status geohuella-backend.service
systemctl --user restart geohuella-backend.service
journalctl --user -u geohuella-backend.service -f
```

El comando de desarrollo `npm run dev` ahora detecta y reutiliza backend/frontend ya disponibles, iniciando solo los que falten. `npm run status` verifica las URLs esperadas.

El servicio usa `scripts/backend-service.sh`, referencia la raíz del proyecto a través de `~/.local/share/geohuella` y escribe logs del servicio en el journal. No se debe mantener en paralelo otro `runserver` manual en `8001`.

## Verificación de esta corrección

- Django devolvió `200` en `/api/salud/`, `/api/provincias/` y `OPTIONS` con CORS para `http://localhost:5174`.
- Se mató intencionalmente el proceso principal de Django; systemd lo reinició y `/api/salud/` volvió a `200` (`NRestarts` incrementó a 1).
- Tests backend: 75; frontend: 67; build Vite: correcto.

## Aviso independiente de mapa

OpenFreeMap actualmente referencia imágenes `circle-11` en el estilo, mientras su sprite contiene `circle_11`. MapLibre advierte que no pudo cargar `circle-11`. La app añade un resolver local solo para ese icono; el aviso de imagen no causa el rechazo de conexión al backend.
