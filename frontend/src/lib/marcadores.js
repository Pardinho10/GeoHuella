/**
 * Estrategia de marcadores coincidentes (F1, fundación):
 *
 * - Las coordenadas guardadas (lat/lng) NUNCA se mutan. La lista, tooltip,
 *   popup y ajuste de vista usan siempre la posición geográfica real.
 * - Cuando dos o más elementos comparten la misma coordenada, se aplica un
 *   desplazamiento visual en PÍXELES sobre el marcador de MapLibre en pantalla,
 *   calculado de forma estable según el zoom actual y el conjunto de puntos.
 * - El desplazamiento se recalcula en cada cambio de zoom/set de puntos;
 *   se permite un conector visual sutil entre el icono desplazado y la
 *   posición real.
 * - La implementación del offset ya está en App.jsx mediante el componente
 *   Pin y la opción offset de Marker de MapLibre; este módulo provee el
 *   cálculo determinista de offsets.
 */

export function agruparPorCoordenada(elementos) {
  const grupos = new Map();
  for (const el of elementos || []) {
    const key = `${el.lat},${el.lng}`;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(el);
  }
  return grupos;
}

// Devuelve offsets en píxeles para un grupo de N marcadores coincidentes.
export function offsetsParaGrupo(n) {
  if (n <= 1) return [{ x: 0, y: 0 }];
  const radio = 12; // px
  const out = [];
  for (let i = 0; i < n; i++) {
    const ang = (2 * Math.PI * i) / n;
    out.push({ x: Math.round(Math.cos(ang) * radio), y: Math.round(Math.sin(ang) * radio) });
  }
  return out;
}

export function anclajeParaOffset(offset = { x: 0, y: 0 }) {
  return [9 - (offset?.x || 0), 9 - (offset?.y || 0)];
}

/**
 * Agrupa por coordenada exacta y devuelve offsets solo para grupos repetidos.
 * El offset es en píxeles, por lo que la separación visual es estable al
 * cambiar el zoom sin alterar las coordenadas guardadas.
 */
export function offsetsPorCoordenada(items) {
  const grupos = new Map();
  (items || []).forEach((item, index) => {
    const key = `${item.lat},${item.lng}`;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(index);
  });

  const offsets = new Map();
  for (const indices of grupos.values()) {
    if (indices.length < 2) continue;
    const grupoOffsets = offsetsParaGrupo(indices.length);
    indices.forEach((index, position) => offsets.set(index, grupoOffsets[position]));
  }
  return offsets;
}
