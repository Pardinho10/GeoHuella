/**
 * Parser CSV mínimo y sin dependencias para la importación masiva (v0.2.0).
 *
 * Cubre lo acordado en docs/fase-1-importacion-masiva.md:
 * - BOM opcional al inicio (UTF-8 con BOM).
 * - Delimitador coma o punto y coma (se detecta del encabezado).
 * - Campos entrecomillados con `"` y comillas escapadas `""`.
 * - Comas y saltos de línea dentro de campos entrecomillados.
 * - Saltos CRLF, LF y CR.
 * - Archivo vacío o malformado: se devuelve lo recuperable más un aviso.
 */

export const DELIMITADOR_COMA = ',';
export const DELIMITADOR_PUNTO_Y_COMA = ';';

export function quitarBOM(texto) {
  const t = String(texto ?? '');
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
}

/** Cuenta delimitadores fuera de comillas en la primera línea lógica. */
function contarDelimitadores(texto) {
  let enComillas = false;
  let comas = 0;
  let puntoYComas = 0;

  for (let i = 0; i < texto.length; i += 1) {
    const caracter = texto[i];
    if (caracter === '"') {
      if (enComillas && texto[i + 1] === '"') {
        i += 1;
        continue;
      }
      enComillas = !enComillas;
      continue;
    }
    if (enComillas) continue;
    if (caracter === '\n' || caracter === '\r') break;
    if (caracter === DELIMITADOR_COMA) comas += 1;
    else if (caracter === DELIMITADOR_PUNTO_Y_COMA) puntoYComas += 1;
  }

  return { comas, puntoYComas };
}

/** Detecta el delimitador mirando el encabezado (fuera de comillas). */
export function detectarDelimitador(texto) {
  const limpio = quitarBOM(texto);
  const { comas, puntoYComas } = contarDelimitadores(limpio);
  if (comas === 0 && puntoYComas === 0) return DELIMITADOR_COMA;
  return puntoYComas > comas ? DELIMITADOR_PUNTO_Y_COMA : DELIMITADOR_COMA;
}

/**
 * Parsea texto CSV.
 * @param {string} texto
 * @param {{ delimitador?: string }} [opciones]
 * @returns {{ filas: string[][], delimitador: string, comillasSinCerrar: boolean, vacio: boolean }}
 */
export function parsearCSV(texto, opciones = {}) {
  const limpio = quitarBOM(texto);
  const delimitador = opciones.delimitador || detectarDelimitador(limpio);
  const filas = [];

  let campo = '';
  let fila = [];
  let enComillas = false;
  let i = 0;

  const cerrarCampo = () => {
    fila.push(campo);
    campo = '';
  };
  const cerrarFila = () => {
    cerrarCampo();
    filas.push(fila);
    fila = [];
  };

  while (i < limpio.length) {
    const caracter = limpio[i];

    if (enComillas) {
      if (caracter === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"';
          i += 2;
          continue;
        }
        enComillas = false;
        i += 1;
        continue;
      }
      campo += caracter;
      i += 1;
      continue;
    }

    if (caracter === '"') {
      enComillas = true;
      i += 1;
      continue;
    }

    if (caracter === delimitador) {
      cerrarCampo();
      i += 1;
      continue;
    }

    if (caracter === '\r' || caracter === '\n') {
      if (caracter === '\r' && limpio[i + 1] === '\n') i += 1;
      cerrarFila();
      i += 1;
      continue;
    }

    campo += caracter;
    i += 1;
  }

  const comillasSinCerrar = enComillas;
  if (campo !== '' || fila.length > 0) cerrarFila();

  // Se descartan las filas totalmente vacías (líneas en blanco, CR extra, etc.).
  const resultado = filas.filter((f) => f.some((celda) => String(celda).trim() !== ''));

  return {
    filas: resultado,
    delimitador,
    comillasSinCerrar,
    vacio: resultado.length === 0,
  };
}
