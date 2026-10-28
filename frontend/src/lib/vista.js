/**
 * Cálculo de vista del mapa compatible con MapLibre.
 *
 * MapLibre `fitBounds` acepta `LngLatBounds`, `[sw, ne]` o
 * `[west, south, east, north]`; no acepta un array de N puntos.
 */

export function boundsParaElementos(elementos) {
  if (!Array.isArray(elementos) || elementos.length === 0) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  let validos = 0;

  for (const el of elementos) {
    if (!el || !Number.isFinite(el.lat) || !Number.isFinite(el.lng)) continue;
    validos += 1;
    minLng = Math.min(minLng, el.lng);
    minLat = Math.min(minLat, el.lat);
    maxLng = Math.max(maxLng, el.lng);
    maxLat = Math.max(maxLat, el.lat);
  }

  if (validos === 0) return null;
  return [minLng, minLat, maxLng, maxLat];
}

/**
 * Ajusta el mapa a uno o varios elementos. Con un único punto usa `flyTo`
 * porque un bounds de área cero es inválido/incómodo para MapLibre.
 */
export function ajustarVista(map, elementos, { animar = true } = {}) {
  const bounds = boundsParaElementos(elementos);
  if (!map || !bounds) return false;

  if (elementos.length === 1) {
    map.flyTo({
      center: [elementos[0].lng, elementos[0].lat],
      zoom: Math.max(map.getZoom?.() ?? 0, 14),
      duration: animar ? 600 : 0,
    });
    return true;
  }

  map.fitBounds(bounds, {
    padding: 40,
    maxZoom: 15,
    duration: animar ? 600 : 0,
  });
  return true;
}
