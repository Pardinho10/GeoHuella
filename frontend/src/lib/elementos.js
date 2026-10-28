import { colorParaIndice, MAX_ELEMENTOS } from './storage.js';

export function nuevoId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `el-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Agrega candidatos como elementos locales.
 * @param {Array} candidatos - lista de candidatos {lat, lng, direccion, ...}
 * @param {string} nombreBase - nombre opcional provisto por el usuario
 * @param {Array} elementos - elementos actuales
 * @param {number} contador - contador actual
 * @returns {{ agregados: Array, noAgregados: number, elementos: Array, contador: number }}
 */
export function agregarCandidatos(candidatos, nombreBase, elementos, contador) {
  const base = Array.isArray(elementos) ? [...elementos] : [];
  const lista = Array.isArray(candidatos) ? candidatos : [];
  const nombreTrim = (nombreBase || '').trim();
  const huecos = Math.max(0, MAX_ELEMENTOS - base.length);
  const aAgregar = lista.slice(0, huecos);
  const noAgregados = lista.length - aAgregar.length;

  let c = typeof contador === 'number' && contador >= 0 ? contador : 0;
  const agregados = aAgregar.map((cand, i) => {
    let nombre;
    if (nombreTrim) {
      nombre = nombreTrim;
    } else {
      c += 1;
      nombre = `Elemento ${c}`;
    }
    const el = {
      id: nuevoId(),
      nombre,
      direccion: cand?.direccion ?? null,
      lat: cand.lat,
      lng: cand.lng,
      color: colorParaIndice(base.length + i),
      origen: cand?.origen || 'direccion',
      creadoEn: new Date().toISOString(),
    };
    base.push(el);
    return el;
  });

  // Si se usaron nombres automáticos, contador ya avanzó en c.
  // Si todos personalizados, c sin cambios.
  const contadorFinal = nombreTrim ? contador : c;

  return {
    agregados,
    noAgregados,
    elementos: base,
    contador: contadorFinal,
  };
}

export function parsearCoordenada(texto) {
  if (texto === null || texto === undefined) return null;
  const t = String(texto).trim();
  if (t === '') return null;
  // admite punto o coma decimal
  const normalizado = t.replace(',', '.');
  const n = Number(normalizado);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Parsea un par pegado: "lat, lng" (punto decimal) o "lat; lng" (coma decimal).
 * Devuelve {lat, lng} o null.
 */
export function parsearParPegado(texto) {
  const t = String(texto || '').trim();
  if (!t) return null;

  // Caso 1: lat; lng con coma decimal
  if (t.includes(';')) {
    const partes = t.split(';');
    if (partes.length !== 2) return null;
    const [a, b] = partes.map((s) => s.trim());
    if (!a || !b) return null;
    // cada parte puede usar coma decimal, pero no punto y coma adicional ni comas de miles
    if (a.includes(';') || b.includes(';')) return null;
    const lat = parsearConComaDecimal(a);
    const lng = parsearConComaDecimal(b);
    if (lat === null || lng === null) return null;
    return { lat, lng };
  }

  // Caso 2: lat, lng con punto decimal (sin comas decimales internas)
  if (t.includes(',')) {
    const partes = t.split(',');
    if (partes.length !== 2) return null;
    const [a, b] = partes.map((s) => s.trim());
    if (!a || !b) return null;
    if (a.includes(',') || b.includes(',')) return null;
    if (a.includes(';') || b.includes(';')) return null;
    // punto decimal: no se permiten comas
    const lat = Number(a);
    const lng = Number(b);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }

  return null;
}

function parsearConComaDecimal(texto) {
  const t = String(texto || '').trim();
  if (!t) return null;
  // rechazar múltiples comas o puntos
  if ((t.match(/,/g) || []).length > 1) return null;
  if ((t.match(/\./g) || []).length > 1) return null;
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return n;
}

export function enRangoArgentina(lat, lng) {
  return lat >= -56 && lat <= -21 && lng >= -74 && lng <= -53;
}
