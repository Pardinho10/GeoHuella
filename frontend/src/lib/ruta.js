export const MAX_PUNTOS_RUTA = 20;

/**
 * Estado del límite de huellas por ruta (un solo tramo, máximo 20).
 * Se calcula sobre la lista completa, no sobre el filtro visible: el filtro
 * solo cambia qué huellas se ven, nunca el total ni la selección.
 */
export function analizarLimiteRuta({ total = 0, visibles = null, seleccionados = 0, max = MAX_PUNTOS_RUTA } = {}) {
  const entero = (valor) => {
    const n = Math.floor(Number(valor));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const maximo = Math.max(1, entero(max));
  const totalHuellas = entero(total);
  const seleccion = Math.min(entero(seleccionados), maximo);
  const visiblesHuellas = visibles === null || visibles === undefined ? totalHuellas : entero(visibles);
  const excedentes = Math.max(0, totalHuellas - maximo);
  const quedanFuera = Math.max(0, totalHuellas - seleccion);

  return {
    total: totalHuellas,
    visibles: visiblesHuellas,
    seleccionados: seleccion,
    max: maximo,
    excedentes,
    hayExcedente: excedentes > 0,
    faltanParaMaximo: Math.max(0, maximo - seleccion),
    alcanzoMaximo: seleccion >= maximo,
    quedanFuera,
    hayDisponibles: quedanFuera > 0,
  };
}

/** Aviso contextual cuando hay más huellas que el máximo de la ruta. */
export function mensajeExcedenteRuta(estado, { filtroActivo = false } = {}) {
  const total = Number(estado?.total) || 0;
  const max = Number(estado?.max) || MAX_PUNTOS_RUTA;
  const visibles = Number(estado?.visibles) || 0;
  const base = `Tenés ${total} huellas y la ruta admite hasta ${max}. Elegí un subconjunto de hasta ${max}: el recorrido se calcula en un solo tramo.`;
  if (!filtroActivo || visibles >= total) return base;
  return `${base} El filtro muestra ${visibles} de ${total}.`;
}

/** Aviso cuando la selección llegó al tope y todavía quedan huellas fuera. */
export function mensajeMaximoRuta(estado) {
  const max = Number(estado?.max) || MAX_PUNTOS_RUTA;
  const total = Number(estado?.total) || max;
  return `Seleccionaste el máximo de ${max} huellas de ${total}. Para incluir otra, desmarcá una de las elegidas o limpiá la selección.`;
}

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


function coleccionLinea(coordenadas) {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coordenadas },
    }],
  };
}

function indiceMasLejano(coordenadas) {
  if (coordenadas.length < 2) return 0;
  const [lng0, lat0] = coordenadas[0];
  let mejor = 0;
  let mejorDistancia = -1;
  coordenadas.forEach(([lng, lat], indice) => {
    const distancia = (lng - lng0) ** 2 + (lat - lat0) ** 2;
    if (distancia > mejorDistancia) {
      mejorDistancia = distancia;
      mejor = indice;
    }
  });
  return mejor;
}

export function tramosDeRuta(ruta) {
  const feature = ruta?.ruta?.features?.[0];
  const coordenadas = feature?.geometry?.coordinates;
  if (!Array.isArray(coordenadas) || coordenadas.length < 2) {
    return { ida: ruta?.ruta || null, regreso: null };
  }
  if (!ruta?.volverInicio) {
    return { ida: ruta.ruta, regreso: null };
  }

  const wayPoints = feature?.properties?.way_points;
  let corte = null;
  if (Array.isArray(wayPoints) && wayPoints.length >= 2) {
    const candidato = wayPoints[wayPoints.length - 2];
    if (Number.isInteger(candidato) && candidato > 0 && candidato < coordenadas.length - 1) {
      corte = candidato;
    }
  }
  if (corte === null) {
    const candidato = indiceMasLejano(coordenadas);
    if (candidato > 0 && candidato < coordenadas.length - 1) corte = candidato;
  }
  if (corte === null) {
    return { ida: ruta.ruta, regreso: null };
  }

  return {
    ida: coleccionLinea(coordenadas.slice(0, corte + 1)),
    regreso: coleccionLinea(coordenadas.slice(corte)),
  };
}
