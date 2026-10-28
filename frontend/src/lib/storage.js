export const CLAVE_ELEMENTOS = 'piloto-mapa:elementos:v1';
export const CLAVE_CONTADOR = 'piloto-mapa:contador:v1';
export const MAX_ELEMENTOS = 200;

const COLORES = ['#c57b57', '#f1ab86', '#f7dba7', '#9cafb7'];

export function colorParaIndice(i) {
  return COLORES[i % COLORES.length];
}

export const PALETA_SEGURA = [...COLORES];

export function colorSeguro(color) {
  if (typeof color !== 'string') return COLORES[0];
  if (PALETA_SEGURA.includes(color)) return color;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color.trim())) return color.trim();
  return COLORES[0];
}

function esNumeroFinito(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

const ORIGENES_VALIDOS = new Set(['direccion', 'coordenadas']);

function validarElemento(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  if (typeof e.id !== 'string' || !e.id.trim()) return null;
  if (typeof e.nombre !== 'string' || !e.nombre.trim()) return null;
  if (e.direccion !== null && typeof e.direccion !== 'string') return null;
  if (!esNumeroFinito(e.lat) || !esNumeroFinito(e.lng)) return null;
  if (typeof e.color !== 'string' || !e.color.trim()) return null;
  if (typeof e.origen !== 'string' || !ORIGENES_VALIDOS.has(e.origen)) return null;
  if (typeof e.creadoEn !== 'string' || !e.creadoEn.trim()) return null;
  return e;
}

export function cargarElementos() {
  try {
    const raw = window.localStorage.getItem(CLAVE_ELEMENTOS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out = [];
    for (const item of parsed) {
      const v = validarElemento(item);
      if (v) out.push(v);
    }
    return out.slice(0, 200);
  } catch {
    return [];
  }
}

export function guardarElementos(elementos) {
  try {
    window.localStorage.setItem(CLAVE_ELEMENTOS, JSON.stringify(elementos));
    return true;
  } catch {
    return false;
  }
}

export function cargarContador() {
  try {
    const raw = window.localStorage.getItem(CLAVE_CONTADOR);
    if (raw === null) return 0;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  } catch {
    return 0;
  }
}

export function guardarContador(n) {
  try {
    window.localStorage.setItem(CLAVE_CONTADOR, String(Math.floor(n)));
    return true;
  } catch {
    return false;
  }
}
