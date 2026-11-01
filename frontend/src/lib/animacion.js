/**
 * Animación del recorrido de una ruta (v0.2.2).
 *
 * Reglas:
 * - La geometría del proveedor es la fuente de verdad: no se invierten
 *   coordenadas, no se reordena nada y no se calcula una ruta alternativa.
 *   Para auto y bici eso preserva el sentido real de las calles (one-way).
 * - En ida y vuelta se recorre primero el tramo de ida y luego el de regreso,
 *   tal como los entrega `tramosDeRuta` (el punto de giro se comparte y no se
 *   duplica, así el icono nunca “salta”).
 * - Se interpola por distancia acumulada sobre los segmentos GeoJSON.
 */

import { tramosDeRuta } from './ruta.js';

/** Duración UX: 5 s por km, acotada para no animar horas reales de viaje. */
export const MS_POR_KM_ANIMACION = 5000;
export const DURACION_MINIMA_MS = 12000;
export const DURACION_MAXIMA_MS = 45000;
/** Avance de cada paso manual (5 %). */
export const PASO_MANUAL = 0.05;

const RAD = Math.PI / 180;
const RADIO_TIERRA_M = 6371000;

/** Duración de reproducción en ms: 5 s/km acotada a 12–45 s. */
export function duracionAnimacionMs(distanciaMetros) {
  const metros = Number(distanciaMetros);
  if (!Number.isFinite(metros) || metros <= 0) return DURACION_MINIMA_MS;
  const proporcional = (metros / 1000) * MS_POR_KM_ANIMACION;
  return Math.round(Math.min(DURACION_MAXIMA_MS, Math.max(DURACION_MINIMA_MS, proporcional)));
}

/** Distancia en metros entre dos pares GeoJSON `[lng, lat]`. */
export function distanciaEntreCoordenadas(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  if (![lng1, lat1, lng2, lat2].every(Number.isFinite)) return 0;
  const dLat = (lat2 - lat1) * RAD;
  const dLng = (lng2 - lng1) * RAD;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function coordenadaValida(coord) {
  return Array.isArray(coord)
    && coord.length >= 2
    && Number.isFinite(coord[0])
    && Number.isFinite(coord[1]);
}

function mismoPunto(a, b) {
  if (!coordenadaValida(a) || !coordenadaValida(b)) return false;
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

/** Quita puntos consecutivos repetidos sin alterar el orden ni el sentido. */
function sinRepetidosConsecutivos(coordenadas) {
  const salida = [];
  for (const coord of coordenadas) {
    if (!coordenadaValida(coord)) continue;
    const anterior = salida[salida.length - 1];
    if (anterior && mismoPunto(anterior, coord)) continue;
    salida.push([coord[0], coord[1]]);
  }
  return salida;
}

/** Coordenadas de un FeatureCollection de un solo LineString. */
export function coordenadasDeTramo(tramo) {
  const coordenadas = tramo?.features?.[0]?.geometry?.coordinates;
  return Array.isArray(coordenadas) ? coordenadas : [];
}

/** Distancias acumuladas por vértice (arranca en 0). */
export function distanciasAcumuladas(coordenadas) {
  const acumuladas = [0];
  for (let i = 1; i < coordenadas.length; i += 1) {
    acumuladas.push(acumuladas[i - 1] + distanciaEntreCoordenadas(coordenadas[i - 1], coordenadas[i]));
  }
  return acumuladas;
}

/**
 * Recorrido utilizable para animar: coordenadas ordenadas, distancias
 * acumuladas y límites de cada tramo (ida/regreso).
 */
export function construirRecorrido(ruta) {
  if (!ruta) return null;

  const tramos = tramosDeRuta(ruta);
  const ida = sinRepetidosConsecutivos(coordenadasDeTramo(tramos.ida));
  const regreso = sinRepetidosConsecutivos(coordenadasDeTramo(tramos.regreso));

  const coordenadas = [...ida];
  const finIda = coordenadas.length - 1;
  let regresoInicio = null;

  if (regreso.length > 1) {
    // El primer punto del regreso es el punto de giro, ya presente en la ida.
    const desde = mismoPunto(coordenadas[coordenadas.length - 1], regreso[0]) ? 1 : 0;
    regresoInicio = coordenadas.length;
    coordenadas.push(...regreso.slice(desde));
  }

  if (coordenadas.length < 2) return null;

  const acumuladas = distanciasAcumuladas(coordenadas);

  return {
    coordenadas,
    acumuladas,
    distanciaMetros: acumuladas[acumuladas.length - 1],
    perfil: ruta.perfil || 'walking',
    idaYVuelta: Boolean(ruta.volverInicio),
    ida: { inicio: 0, fin: finIda },
    regreso: regresoInicio === null
      ? null
      : { inicio: regresoInicio, fin: coordenadas.length - 1 },
  };
}

/** Rumbo en grados (0 = norte, 90 = este) entre dos pares `[lng, lat]`. */
export function rumboEntre(a, b) {
  if (!coordenadaValida(a) || !coordenadaValida(b)) return 0;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  if (mismoPunto(a, b)) return 0;
  const dLng = (lng2 - lng1) * RAD;
  const y = Math.sin(dLng) * Math.cos(lat2 * RAD);
  const x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD)
    - Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos(dLng);
  const grados = Math.atan2(y, x) / RAD;
  return (grados + 360) % 360;
}

/**
 * Posición, rumbo y tramo para un progreso 0..1 sobre el recorrido.
 * La interpolación es lineal en el segmento correspondiente, sin saltos.
 */
export function interpolarEnRecorrido(recorrido, progreso) {
  if (!recorrido || !Array.isArray(recorrido.coordenadas) || recorrido.coordenadas.length < 2) {
    return null;
  }
  const crudo = Number(progreso);
  const p = Number.isFinite(crudo) ? Math.min(1, Math.max(0, crudo)) : 0;
  const { coordenadas, acumuladas } = recorrido;
  const total = acumuladas[acumuladas.length - 1];
  const objetivo = p * total;

  let indice = 0;
  while (indice < acumuladas.length - 2 && acumuladas[indice + 1] < objetivo) {
    indice += 1;
  }

  const inicio = coordenadas[indice];
  const fin = coordenadas[indice + 1];
  const largo = acumuladas[indice + 1] - acumuladas[indice];
  const fraccion = largo > 0 ? (objetivo - acumuladas[indice]) / largo : 0;

  // Interpolación en coordenadas (los segmentos son cortos; error despreciable).
  const lng = inicio[0] + (fin[0] - inicio[0]) * fraccion;
  const lat = inicio[1] + (fin[1] - inicio[1]) * fraccion;

  return {
    lat,
    lng,
    rumbo: rumboEntre(inicio, fin),
    indice,
    // El primer segmento de vuelta empieza en el punto de giro (índice
    // `regreso.inicio - 1`), por eso se compara el extremo final del segmento.
    tramo: recorrido.regreso && indice + 1 >= recorrido.regreso.inicio ? 'regreso' : 'ida',
  };
}

/** Avanza (o retrocede) el progreso respetando los límites 0..1. */
export function avanzarProgreso(progreso, delta) {
  const base = Number.isFinite(Number(progreso)) ? Number(progreso) : 0;
  const salto = Number.isFinite(Number(delta)) ? Number(delta) : 0;
  return Math.min(1, Math.max(0, base + salto));
}

/**
 * Preferencia de movimiento reducido.
 * Si el entorno no expone `matchMedia` (por ejemplo, pruebas o navegadores
 * muy antiguos) se asume movimiento reducido: nunca hay auto-play.
 */
export function prefiereMovimientoReducido() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return true;
  }
}

/** Suscribe a cambios de la preferencia. Devuelve la función para desuscribirse. */
export function observarMovimientoReducido(alCambiar) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  let media;
  try {
    media = window.matchMedia('(prefers-reduced-motion: reduce)');
  } catch {
    return () => {};
  }
  const manejador = (evento) => alCambiar(Boolean(evento.matches));
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', manejador);
    return () => media.removeEventListener('change', manejador);
  }
  if (typeof media.addListener === 'function') {
    media.addListener(manejador);
    return () => media.removeListener(manejador);
  }
  return () => {};
}
