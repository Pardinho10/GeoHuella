export const MAX_PUNTOS_RUTA = 20;

export const PERFILES_RUTA = [
  { id: 'walking', etiqueta: 'Caminando' },
  { id: 'driving', etiqueta: 'Auto' },
  { id: 'cycling', etiqueta: 'Bici' },
];

export function etiquetaPerfil(perfil) {
  return PERFILES_RUTA.find((p) => p.id === perfil)?.etiqueta || 'Caminando';
}

export function formatearDistancia(metros) {
  if (typeof metros !== 'number' || !Number.isFinite(metros) || metros < 0) return '—';
  const valor = metros;
  if (valor < 1000) return `${Math.round(valor)} m`;
  const km = valor / 1000;
  const decimales = km >= 100 ? 0 : 1;
  return `${km.toFixed(decimales).replace('.', ',')} km`;
}

export function formatearDuracion(segundos) {
  if (typeof segundos !== 'number' || !Number.isFinite(segundos) || segundos < 0) return '—';
  const valor = segundos;
  const minutos = Math.max(1, Math.round(valor / 60));
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

export function coordenadasDeRuta(ruta) {
  const features = ruta?.ruta?.features;
  if (!Array.isArray(features)) return [];
  const coordenadas = [];
  for (const feature of features) {
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords)) continue;
    for (const coord of coords) {
      if (!Array.isArray(coord) || coord.length < 2) continue;
      const [lng, lat] = coord;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      coordenadas.push([lng, lat]);
    }
  }
  return coordenadas;
}

export function boundsDeRuta(ruta) {
  const coords = coordenadasDeRuta(ruta);
  if (coords.length === 0) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }
  return [[minLng, minLat], [maxLng, maxLat]];
}
