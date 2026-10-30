/**
 * Dominio de la importación masiva (Fase 1 / v0.2.0).
 *
 * Todo lo que puede probarse sin React vive acá: parseo de texto, mapeo de
 * columnas CSV, validación de filas, clasificación de resultados del lote,
 * estados por fila, detección de duplicados y armado de la solicitud.
 *
 * Contrato de referencia: docs/contrato-api.md §4 `POST /api/geocodificar-lote/`.
 */

import { normalizarTexto } from './elementos.js';
import { parsearCSV } from './csv.js';

export const MAX_FILAS_IMPORTACION = 100;
export const MAX_FILAS_BLOQUE = 10;
export const MAX_CANDIDATOS = 5;
export const RADIO_DUPLICADO_METROS = 5;

export const CAMPOS_IMPORTACION = ['nombre', 'calle', 'altura', 'ciudad', 'provincia'];

export const ETIQUETAS_CAMPO = {
  nombre: 'Nombre',
  calle: 'Calle',
  altura: 'Altura',
  ciudad: 'Ciudad',
  provincia: 'Provincia',
};

export const ESTADOS_CONTRATO = ['encontrada', 'ambigua', 'sin_resultado', 'error'];

export const ESTADOS_FILA = [
  'pendiente',
  'buscando',
  'encontrada',
  'ambigua',
  'sin_resultado',
  'error',
  'cancelada',
  'descartada',
];

export const ETIQUETAS_ESTADO = {
  pendiente: 'Pendiente',
  buscando: 'Buscando',
  encontrada: 'Encontrada',
  ambigua: 'Ambigua',
  sin_resultado: 'Sin resultado',
  error: 'Error',
  cancelada: 'Cancelada',
  descartada: 'Descartada',
};

/** Estados con resultado definitivo (no se vuelven a consultar solos). */
const ESTADOS_RESUELTOS = new Set(['encontrada', 'ambigua', 'sin_resultado', 'error']);

export function esEstadoResuelto(estado) {
  return ESTADOS_RESUELTOS.has(estado);
}

export const PROVINCIAS_AR = [
  'Buenos Aires',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Ciudad Autónoma de Buenos Aires',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán',
];

const ALIAS_PROVINCIA = {
  caba: 'Ciudad Autónoma de Buenos Aires',
  'c a b a': 'Ciudad Autónoma de Buenos Aires',
  'capital federal': 'Ciudad Autónoma de Buenos Aires',
  'ciudad autonoma de buenos aires': 'Ciudad Autónoma de Buenos Aires',
  'bs as': 'Buenos Aires',
  'buenos aires': 'Buenos Aires',
  'sgo del estero': 'Santiago del Estero',
  'santiago del estero': 'Santiago del Estero',
  'tierra del fuego': 'Tierra del Fuego',
  'tierra del fuego antartida e islas del atlantico sur': 'Tierra del Fuego',
  'entre rios': 'Entre Ríos',
  'rio negro': 'Río Negro',
  cordoba: 'Córdoba',
  neuquen: 'Neuquén',
  tucuman: 'Tucumán',
};

for (const provincia of PROVINCIAS_AR) {
  ALIAS_PROVINCIA[normalizarTexto(provincia)] = provincia;
}

function claveSimple(texto) {
  return normalizarTexto(texto).replace(/\s+/g, ' ').trim();
}

/** Devuelve el nombre canónico de una provincia o null si no se reconoce. */
export function resolverProvincia(texto, provincias) {
  const clave = claveSimple(texto);
  if (!clave) return null;
  const lista = Array.isArray(provincias) && provincias.length > 0 ? provincias : PROVINCIAS_AR;
  const canonica = ALIAS_PROVINCIA[clave];
  if (canonica) {
    // Solo se devuelve una provincia que exista en la lista vigente: si el
    // backend no la ofrece, la fila queda incompleta en lugar de inválida.
    return lista.find((p) => claveSimple(p) === claveSimple(canonica)) || null;
  }
  const directa = lista.find((p) => claveSimple(p) === clave);
  return directa || null;
}

/* ------------------------------------------------------------------ */
/* Encabezados y mapeo de columnas CSV                                 */
/* ------------------------------------------------------------------ */

const ALIAS_ENCABEZADOS = {
  nombre: ['nombre', 'name', 'titulo', 'title', 'etiqueta', 'label', 'alias', 'lugar'],
  calle: ['calle', 'street', 'address', 'direccion', 'via', 'domicilio', 'street_name'],
  altura: ['altura', 'numero', 'number', 'num', 'nro', 'alt', 'street_number', 'house_number'],
  ciudad: ['ciudad', 'localidad', 'city', 'town', 'municipio', 'localidad_ciudad'],
  provincia: ['provincia', 'province', 'state', 'estado', 'prov', 'state_name'],
};

function claveEncabezado(texto) {
  return normalizarTexto(texto)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Mapeo campo -> índice de columna (-1 = sin asignar). */
export function mapearColumnas(encabezados = []) {
  const claves = (Array.isArray(encabezados) ? encabezados : []).map(claveEncabezado);
  const mapeo = {};
  const usadas = new Set();

  for (const campo of CAMPOS_IMPORTACION) {
    mapeo[campo] = -1;
    const alias = ALIAS_ENCABEZADOS[campo];
    for (let i = 0; i < claves.length; i += 1) {
      if (usadas.has(i)) continue;
      if (alias.includes(claves[i])) {
        mapeo[campo] = i;
        usadas.add(i);
        break;
      }
    }
  }

  return mapeo;
}

/** ¿La primera fila es un encabezado y no un dato? */
export function detectarEncabezado(fila = []) {
  const mapeo = mapearColumnas(fila);
  const coincidencias = CAMPOS_IMPORTACION.filter((campo) => mapeo[campo] >= 0).length;
  if (coincidencias >= 2) return true;
  if (coincidencias >= 1) {
    const tieneNumero = (Array.isArray(fila) ? fila : []).some((celda) => /^\d+$/.test(String(celda).trim()));
    return !tieneNumero;
  }
  return false;
}

/** Mapeo posicional cuando el CSV no trae encabezados. */
export function mapeoPorDefecto(cantidadColumnas = 0) {
  const n = Number.isFinite(cantidadColumnas) ? cantidadColumnas : 0;
  const mapeo = { nombre: -1, calle: -1, altura: -1, ciudad: -1, provincia: -1 };
  if (n >= 5) {
    mapeo.nombre = 0;
    mapeo.calle = 1;
    mapeo.altura = 2;
    mapeo.ciudad = 3;
    mapeo.provincia = 4;
  } else if (n >= 4) {
    mapeo.calle = 0;
    mapeo.altura = 1;
    mapeo.ciudad = 2;
    mapeo.provincia = 3;
  } else if (n >= 3) {
    mapeo.calle = 0;
    mapeo.altura = 1;
    mapeo.ciudad = 2;
  } else if (n >= 2) {
    mapeo.calle = 0;
    mapeo.altura = 1;
  } else if (n >= 1) {
    mapeo.calle = 0;
  }
  return mapeo;
}

/**
 * Analiza un CSV completo: filas de datos, encabezados, mapeo sugerido.
 * No valida contenido: eso lo hace `validarFila`.
 */
export function analizarCSV(texto) {
  const { filas, delimitador, comillasSinCerrar, vacio } = parsearCSV(texto);
  const primera = filas[0] || [];
  const tieneEncabezado = filas.length > 0 && detectarEncabezado(primera);
  const cantidadColumnas = filas.reduce((max, fila) => Math.max(max, fila.length), primera.length);

  const encabezados = tieneEncabezado
    ? primera.map((celda, i) => String(celda).trim() || `Columna ${i + 1}`)
    : Array.from({ length: cantidadColumnas }, (_, i) => `Columna ${i + 1}`);

  const mapeo = tieneEncabezado ? mapearColumnas(primera) : mapeoPorDefecto(cantidadColumnas);
  const datos = tieneEncabezado ? filas.slice(1) : filas;

  return {
    filas: datos,
    encabezados,
    tieneEncabezado,
    mapeo,
    delimitador,
    comillasSinCerrar,
    vacio,
    columnas: cantidadColumnas,
  };
}

/** Aplica un mapeo de columnas y devuelve datos crudos por campo. */
export function datosCrudosDeCSV(analisis, mapeo) {
  const mapa = mapeo || analisis?.mapeo || mapeoPorDefecto(0);
  const valor = (fila, campo) => {
    const indice = mapa[campo];
    if (indice === undefined || indice === null || indice < 0) return '';
    return String(fila?.[indice] ?? '').trim();
  };

  return (analisis?.filas || []).map((fila) => {
    const datos = {};
    for (const campo of CAMPOS_IMPORTACION) datos[campo] = valor(fila, campo);
    return datos;
  });
}

/* ------------------------------------------------------------------ */
/* Parseo de texto pegado (una dirección por línea)                    */
/* ------------------------------------------------------------------ */

const SEPARADOR_SEGMENTOS = /\s*[;|]\s*|\s*,\s*/;

function dividirSegmentos(texto) {
  return String(texto || '')
    .split(SEPARADOR_SEGMENTOS)
    .map((segmento) => segmento.trim())
    .filter(Boolean);
}

/** Extrae `{ calle, altura }` de un segmento como "Perú 781" o "781". */
function extraerAltura(segmento) {
  const texto = String(segmento || '').trim();
  const coincidencia = texto.match(/^(.*?)[\s,]*(\d{1,6})$/);
  if (!coincidencia) return null;
  const calle = coincidencia[1].trim();
  return { calle, altura: coincidencia[2] };
}

/**
 * Parsea una línea a campos estructurados. Nunca inventa ciudad ni provincia.
 * Reconoce: `nombre: X | resto`, `[X] resto`, separadores `;`, `|` y `,`.
 * @returns {{nombre:string, calle:string, altura:string, ciudad:string, provincia:string, linea:string}|null}
 */
export function parsearLineaTexto(linea, opciones = {}) {
  const provincias = opciones.provincias;
  const original = String(linea ?? '').trim();
  if (!original) return null;

  let nombre = '';
  let resto = original;

  const conEtiqueta = resto.match(/^\s*nombre\s*:\s*([^|;]+?)\s*[|;]\s*(.+)$/i);
  if (conEtiqueta) {
    nombre = conEtiqueta[1].trim();
    resto = conEtiqueta[2].trim();
  } else {
    const conCorchetes = resto.match(/^\[([^\]]+)\]\s*(.+)$/);
    if (conCorchetes) {
      nombre = conCorchetes[1].trim();
      resto = conCorchetes[2].trim();
    }
  }

  const segmentos = dividirSegmentos(resto);
  if (segmentos.length === 0) return null;

  // Provincia: se busca desde el final, pero nunca el único segmento.
  let provincia = '';
  let indiceProvincia = -1;
  for (let i = segmentos.length - 1; i >= 1; i -= 1) {
    const encontrada = resolverProvincia(segmentos[i], provincias);
    if (encontrada) {
      provincia = encontrada;
      indiceProvincia = i;
      break;
    }
  }

  const sinProvincia = segmentos.filter((_, i) => i !== indiceProvincia);

  // Altura: último segmento con un número final.
  let indiceAltura = -1;
  let calleDelSegmento = '';
  let altura = '';
  for (let i = sinProvincia.length - 1; i >= 0; i -= 1) {
    const extraido = extraerAltura(sinProvincia[i]);
    if (extraido) {
      indiceAltura = i;
      calleDelSegmento = extraido.calle;
      altura = extraido.altura;
      break;
    }
  }

  let calle = '';
  let ciudad = '';
  let antes = [];

  if (indiceAltura >= 0) {
    if (calleDelSegmento) {
      calle = calleDelSegmento;
      antes = sinProvincia.slice(0, indiceAltura);
    } else {
      calle = sinProvincia[indiceAltura - 1] || '';
      antes = sinProvincia.slice(0, Math.max(0, indiceAltura - 1));
    }
    const despues = sinProvincia.slice(indiceAltura + 1);
    ciudad = despues.join(' - ');
  } else {
    calle = sinProvincia[0] || '';
    const despues = sinProvincia.slice(1);
    ciudad = despues.join(' - ');
  }

  if (!nombre && antes.length > 0) nombre = antes.join(' - ');

  return {
    nombre: nombre.trim(),
    calle: calle.trim(),
    altura: altura.trim(),
    ciudad: ciudad.trim(),
    provincia,
    linea: original,
  };
}

/** Parsea texto pegado completo: una dirección por línea, ignora vacías. */
export function parsearTextoDirecciones(texto, opciones = {}) {
  const lineas = String(texto ?? '').split(/\r\n|\r|\n/);
  const filas = [];
  for (const linea of lineas) {
    const fila = parsearLineaTexto(linea, opciones);
    if (fila) filas.push(fila);
  }
  return filas;
}

/* ------------------------------------------------------------------ */
/* Filas de importación                                                */
/* ------------------------------------------------------------------ */

export function completarConDefectos(datos, opciones = {}) {
  const completos = {};
  for (const campo of CAMPOS_IMPORTACION) {
    completos[campo] = String(datos?.[campo] ?? '').trim();
  }
  const ciudadDefecto = String(opciones.ciudadDefecto ?? '').trim();
  const provinciaDefecto = String(opciones.provinciaDefecto ?? '').trim();
  if (!completos.ciudad && ciudadDefecto) completos.ciudad = ciudadDefecto;
  if (!completos.provincia && provinciaDefecto) completos.provincia = provinciaDefecto;
  return completos;
}

export function crearFila(datos, indice, opciones = {}) {
  const completos = completarConDefectos(datos, opciones);
  return {
    id: `fila-${indice + 1}`,
    ...completos,
    estado: 'pendiente',
    candidatos: [],
    candidatoElegido: null,
    mensaje: null,
    seleccionada: false,
    descartada: false,
    incluirDuplicado: false,
    coordsManuales: null,
    errores: {},
  };
}

export function crearFilasDesdeDatos(lista, opciones = {}) {
  return (Array.isArray(lista) ? lista : []).map((datos, i) => crearFila(datos, i, opciones));
}

/* ------------------------------------------------------------------ */
/* Validación                                                          */
/* ------------------------------------------------------------------ */

export function validarFila(fila, opciones = {}) {
  const errores = {};
  const provincias = opciones.provincias;
  const nombre = String(fila?.nombre ?? '').trim();
  const calle = String(fila?.calle ?? '').trim();
  const altura = String(fila?.altura ?? '').trim();
  const ciudad = String(fila?.ciudad ?? '').trim();
  const provincia = String(fila?.provincia ?? '').trim();

  if (nombre.length > 80) errores.nombre = 'Usá hasta 80 caracteres.';

  if (!calle) errores.calle = 'Ingresá la calle.';
  else if (calle.length > 120) errores.calle = 'Usá hasta 120 caracteres.';

  if (!altura) errores.altura = 'Ingresá la altura.';
  else if (!/^\d+$/.test(altura)) errores.altura = 'La altura debe contener solo números.';
  else if (altura.length > 6) errores.altura = 'Usá hasta 6 dígitos.';

  if (!ciudad) errores.ciudad = 'Ingresá la ciudad.';
  else if (ciudad.length > 80) errores.ciudad = 'Usá hasta 80 caracteres.';

  if (!provincia) errores.provincia = 'Elegí una provincia.';
  else if (Array.isArray(provincias) && provincias.length > 0 && !provincias.includes(provincia)) {
    errores.provincia = 'Elegí una provincia de la lista.';
  }

  return errores;
}

export function esFilaValida(fila, opciones = {}) {
  return Object.keys(validarFila(fila, opciones)).length === 0;
}

/** Valida todas las filas: no se geocodifica nada si alguna es inválida. */
export function validarFilas(filas, opciones = {}) {
  const erroresPorId = {};
  let invalidas = 0;

  for (const fila of Array.isArray(filas) ? filas : []) {
    const errores = validarFila(fila, opciones);
    if (Object.keys(errores).length > 0) {
      erroresPorId[fila.id] = errores;
      invalidas += 1;
    }
  }

  return { valido: invalidas === 0, invalidas, erroresPorId };
}

/** Cuerpo exacto de una fila para `POST /api/geocodificar-lote/`. */
export function aSolicitud(fila) {
  return {
    id: String(fila?.id ?? ''),
    calle: String(fila?.calle ?? '').trim(),
    altura: String(fila?.altura ?? '').trim(),
    ciudad: String(fila?.ciudad ?? '').trim(),
    provincia: String(fila?.provincia ?? '').trim(),
  };
}

/* ------------------------------------------------------------------ */
/* Resultados del lote                                                 */
/* ------------------------------------------------------------------ */

const CAJA_ARGENTINA = { latMin: -56, latMax: -21, lngMin: -74, lngMax: -53 };

export function normalizarCandidato(candidato) {
  const lat = Number(candidato?.lat);
  const lng = Number(candidato?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < CAJA_ARGENTINA.latMin || lat > CAJA_ARGENTINA.latMax) return null;
  if (lng < CAJA_ARGENTINA.lngMin || lng > CAJA_ARGENTINA.lngMax) return null;
  const nombre = typeof candidato?.nombre === 'string' && candidato.nombre.trim() ? candidato.nombre.trim() : null;
  return {
    lat,
    lng,
    nombre,
    direccion: typeof candidato?.direccion === 'string' ? candidato.direccion : '',
    proveedor: typeof candidato?.proveedor === 'string' ? candidato.proveedor : null,
    // Ante un `aproximada` ausente se asume aproximada: preferimos pedir una
    // selección explícita antes que agregar una interpolación como exacta.
    aproximada: candidato?.aproximada === undefined || candidato?.aproximada === null
      ? true
      : Boolean(candidato.aproximada),
  };
}

export function normalizarCandidatos(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .map(normalizarCandidato)
    .filter(Boolean)
    .slice(0, MAX_CANDIDATOS);
}

export function derivarEstado(candidatos) {
  const lista = Array.isArray(candidatos) ? candidatos : [];
  if (lista.length === 0) return 'sin_resultado';
  if (lista.length === 1 && !lista[0].aproximada) return 'encontrada';
  return 'ambigua';
}

/**
 * Aplica un resultado del contrato a una fila, coherentizando estado y
 * candidatos. Los aproximados nunca quedan preseleccionados.
 */
export function aplicarResultado(fila, resultado) {
  const candidatos = normalizarCandidatos(resultado?.candidatos);
  let estado = ESTADOS_CONTRATO.includes(resultado?.estado)
    ? resultado.estado
    : derivarEstado(candidatos);

  if (estado === 'encontrada' && (candidatos.length !== 1 || candidatos[0]?.aproximada)) {
    estado = candidatos.length === 0 ? 'sin_resultado' : 'ambigua';
  }
  if (estado === 'ambigua' && candidatos.length === 0) estado = 'sin_resultado';
  if ((estado === 'sin_resultado' || estado === 'error') && candidatos.length > 0) estado = 'ambigua';

  let mensaje = typeof resultado?.mensaje === 'string' && resultado.mensaje.trim()
    ? resultado.mensaje.trim()
    : null;
  if (!mensaje && estado === 'sin_resultado') mensaje = 'No se encontró la dirección.';
  if (!mensaje && estado === 'error') mensaje = 'No se pudo consultar esta fila.';

  let candidatoElegido = null;
  if (estado === 'encontrada') {
    candidatoElegido = 0;
  } else if (estado === 'ambigua') {
    // No elegir automáticamente entre varios resultados ni aceptar una
    // ubicación aproximada sin una acción explícita de la persona.
    candidatoElegido = null;
  }

  // Solo una coincidencia exacta y única se preselecciona; todo lo demás
  // (ambigua, aproximada) requiere una elección explícita.
  const preseleccionada = estado === 'encontrada'
    && candidatoElegido === 0
    && Boolean(candidatos[0])
    && !candidatos[0].aproximada;

  return {
    ...fila,
    estado,
    candidatos,
    candidatoElegido,
    mensaje,
    coordsManuales: null,
    seleccionada: preseleccionada,
    errores: {},
  };
}

export function aplicarResultados(filas, resultados) {
  const porId = new Map(
    (Array.isArray(resultados) ? resultados : [])
      .filter((r) => r && typeof r.id === 'string')
      .map((r) => [r.id, r]),
  );
  return (Array.isArray(filas) ? filas : []).map((fila) => (
    porId.has(fila.id) ? aplicarResultado(fila, porId.get(fila.id)) : fila
  ));
}

/** Marca filas como `buscando` (bloque en vuelo). */
export function marcarBuscando(filas, ids) {
  const conjunto = new Set(ids || []);
  return (Array.isArray(filas) ? filas : []).map((fila) => (
    conjunto.has(fila.id) ? { ...fila, estado: 'buscando', mensaje: null } : fila
  ));
}

/** Marca filas con error de bloque (fallo HTTP/rede, no del proveedor). */
export function marcarError(filas, ids, error) {
  const conjunto = new Set(ids || []);
  const mensaje = error?.message || 'No se pudo consultar el lote.';
  return (Array.isArray(filas) ? filas : []).map((fila) => (
    conjunto.has(fila.id)
      ? { ...fila, estado: 'error', mensaje, seleccionada: false, candidatos: [], candidatoElegido: null }
      : fila
  ));
}

/** Filas que quedaron sin consultar tras cancelar. */
export function marcarCanceladas(filas) {
  return (Array.isArray(filas) ? filas : []).map((fila) => (
    fila.estado === 'pendiente' || fila.estado === 'buscando'
      ? { ...fila, estado: 'cancelada', mensaje: 'Cancelada antes de consultar.' }
      : fila
  ));
}

export function pendientesDeGeocodificar(filas) {
  return (Array.isArray(filas) ? filas : []).filter((fila) => (
    !fila.descartada && (fila.estado === 'pendiente' || fila.estado === 'cancelada' || fila.estado === 'error')
  ));
}

export function contarPorEstado(filas) {
  const conteo = {};
  for (const fila of Array.isArray(filas) ? filas : []) {
    conteo[fila.estado] = (conteo[fila.estado] || 0) + 1;
  }
  return conteo;
}

export function contarResueltas(filas) {
  return (Array.isArray(filas) ? filas : []).filter((fila) => esEstadoResuelto(fila.estado)).length;
}

/* ------------------------------------------------------------------ */
/* Coordenadas y duplicados                                            */
/* ------------------------------------------------------------------ */

export function distanciaMetros(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const radioTierra = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * radioTierra * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Coordenadas efectivas de una fila: manuales > candidato elegido. */
export function coordenadasDeFila(fila) {
  const manual = fila?.coordsManuales;
  if (manual && Number.isFinite(manual.lat) && Number.isFinite(manual.lng)) {
    return { lat: manual.lat, lng: manual.lng };
  }
  const indice = fila?.candidatoElegido;
  const candidato = indice !== null && indice !== undefined ? fila?.candidatos?.[indice] : null;
  if (candidato && Number.isFinite(candidato.lat) && Number.isFinite(candidato.lng)) {
    return { lat: candidato.lat, lng: candidato.lng };
  }
  return null;
}

/** Clave de comparación: sin acentos, sin puntuación, espacios colapsados. */
export function claveComparacion(texto) {
  return normalizarTexto(texto).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function textoComparable(fila) {
  return claveComparacion(`${fila?.calle ?? ''} ${fila?.altura ?? ''} ${fila?.ciudad ?? ''} ${fila?.provincia ?? ''}`);
}

export function nucleoComparable(fila) {
  return claveComparacion(`${fila?.calle ?? ''} ${fila?.altura ?? ''}`);
}

function escaparRegex(texto) {
  return String(texto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Coincidencia de texto normalizado, con límites de palabra. */
function textoCoincide(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const corto = a.length <= b.length ? a : b;
  const largo = corto === a ? b : a;
  if (corto.length < 6) return false;
  return new RegExp(`(^|\\s)${escaparRegex(corto)}(\\s|$)`).test(largo);
}

function compararReferencias(actual, referencia) {
  if (actual.coords && referencia.coords
    && distanciaMetros(actual.coords, referencia.coords) <= RADIO_DUPLICADO_METROS) {
    return { motivo: 'coordenadas', contra: referencia.nombre };
  }
  if (textoCoincide(actual.texto, referencia.texto)
    || textoCoincide(actual.nucleo, referencia.texto)
    || textoCoincide(actual.texto, referencia.nucleo)) {
    return { motivo: 'texto', contra: referencia.nombre };
  }
  return null;
}

/**
 * Detecta duplicados contra los puntos ya guardados y entre filas
 * seleccionadas. Devuelve `Map<id, { motivo, contra }>`.
 */
export function detectarDuplicados(filas, elementos = []) {
  const referencias = [];

  for (const elemento of Array.isArray(elementos) ? elementos : []) {
    if (!elemento) continue;
    referencias.push({
      tipo: 'punto',
      nombre: elemento.nombre || 'punto guardado',
      texto: claveComparacion(elemento.direccion || ''),
      nucleo: '',
      coords: Number.isFinite(elemento.lat) && Number.isFinite(elemento.lng)
        ? { lat: elemento.lat, lng: elemento.lng }
        : null,
    });
  }

  const marcas = new Map();
  const filasPrevias = [];
  const lista = Array.isArray(filas) ? filas : [];

  for (const fila of lista) {
    if (!fila || fila.descartada) continue;
    const actual = {
      tipo: 'fila',
      nombre: fila.nombre || `${fila.calle} ${fila.altura}`.trim() || fila.id,
      texto: textoComparable(fila),
      nucleo: nucleoComparable(fila),
      coords: coordenadasDeFila(fila),
    };

    for (const referencia of [...referencias, ...filasPrevias]) {
      const marca = compararReferencias(actual, referencia);
      if (marca) {
        marcas.set(fila.id, marca);
        break;
      }
    }

    // Solo las filas seleccionadas cuentan como referencia para las demás.
    if (fila.seleccionada && !fila.descartada) filasPrevias.push(actual);
  }

  return marcas;
}

/**
 * Filas que efectivamente se van a agregar. Los duplicados detectados quedan
 * afuera salvo que la persona los incluya explícitamente.
 */
export function seleccionadasParaAgregar(filas, duplicados = null) {
  return (Array.isArray(filas) ? filas : []).filter((fila) => {
    if (!fila.seleccionada || fila.descartada) return false;
    if (!coordenadasDeFila(fila)) return false;
    const marca = duplicados && typeof duplicados.get === 'function' ? duplicados.get(fila.id) : null;
    if (marca && !fila.incluirDuplicado) return false;
    return true;
  });
}

/** Ítem listo para `agregarCandidatos` de lib/elementos.js. */
export function itemParaAgregar(fila) {
  const coords = coordenadasDeFila(fila);
  if (!coords) return null;
  const candidato = fila.candidatoElegido !== null && fila.candidatoElegido !== undefined
    ? fila.candidatos?.[fila.candidatoElegido]
    : null;
  const direccion = candidato?.direccion
    || `${fila.calle} ${fila.altura}, ${fila.ciudad}, ${fila.provincia}`;
  return {
    nombre: fila.nombre || '',
    lat: coords.lat,
    lng: coords.lng,
    direccion,
    origen: fila.coordsManuales ? 'coordenadas' : 'direccion',
    aproximada: Boolean(candidato?.aproximada),
  };
}
