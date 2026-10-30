/**
 * Ejecución secuencial de la importación en bloques (Fase 1 / v0.2.0).
 *
 * Reglas del contrato y del documento de fase:
 * - Nunca más de `tamano` filas por solicitud (default 10).
 * - Nunca dos bloques en paralelo: una solicitud en vuelo como máximo.
 * - Cancelar evita iniciar bloques nuevos; el bloque en vuelo se aborta con
 *   AbortController (conectado de verdad). Lo ya resuelto se conserva.
 * - Un fallo de bloque marca esas filas con error y no borra el resto.
 */

import { MAX_FILAS_BLOQUE } from './importacion.js';

export function armarBloques(filas, tamano = MAX_FILAS_BLOQUE) {
  const lista = Array.isArray(filas) ? filas : [];
  const tam = Number.isFinite(tamano) && tamano > 0 ? Math.floor(tamano) : MAX_FILAS_BLOQUE;
  const bloques = [];
  for (let i = 0; i < lista.length; i += tam) {
    bloques.push(lista.slice(i, i + tam));
  }
  return bloques;
}

const CODIGOS_QUE_DETIENEN = new Set(['conexion', 'demasiadas_solicitudes']);

/**
 * Procesa las filas en bloques secuenciales.
 *
 * @param {object} opciones
 * @param {Array} opciones.filas filas a procesar (ya filtradas a pendientes)
 * @param {number} [opciones.tamano] tamaño de bloque (máx. 10 por contrato)
 * @param {(filas: Array, info: {signal?: AbortSignal}) => Promise<Array>} opciones.enviarBloque
 * @param {(ids: string[]) => void} [opciones.alEnviar]
 * @param {(resultados: Array, bloque: Array) => void} [opciones.alResolver]
 * @param {(ids: string[], error: Error) => void} [opciones.alFallar]
 * @param {() => boolean} [opciones.debeCancelar]
 * @param {AbortController} [opciones.control]
 * @returns {Promise<{ bloquesEnviados: number, filasEnviadas: number, filasResueltas: number, cancelado: boolean, detenido: boolean, motivo: string|null }>}
 */
export async function ejecutarLote(opciones = {}) {
  const {
    filas,
    tamano = MAX_FILAS_BLOQUE,
    enviarBloque,
    alEnviar = () => {},
    alResolver = () => {},
    alFallar = () => {},
    debeCancelar = () => false,
    control = null,
  } = opciones;

  if (typeof enviarBloque !== 'function') {
    throw new TypeError('ejecutarLote requiere enviarBloque');
  }

  const bloques = armarBloques(filas, Math.min(tamano, MAX_FILAS_BLOQUE));
  let bloquesEnviados = 0;
  let filasEnviadas = 0;
  let filasResueltas = 0;
  let cancelado = false;
  let detenido = false;
  let motivo = null;

  for (const bloque of bloques) {
    if (debeCancelar() || control?.signal?.aborted) {
      cancelado = true;
      motivo = 'cancelado';
      break;
    }

    const ids = bloque.map((fila) => fila.id);
    alEnviar(ids, bloque);
    bloquesEnviados += 1;
    filasEnviadas += bloque.length;

    try {
      const resultados = await enviarBloque(bloque, { signal: control?.signal });
      alResolver(Array.isArray(resultados) ? resultados : [], bloque);
      filasResueltas += bloque.length;
    } catch (error) {
      if (error?.name === 'AbortError' || debeCancelar() || control?.signal?.aborted) {
        cancelado = true;
        motivo = 'cancelado';
        break;
      }
      alFallar(ids, error, bloque);
      filasResueltas += bloque.length;
      if (CODIGOS_QUE_DETIENEN.has(error?.codigo)) {
        detenido = true;
        motivo = error?.codigo || 'error';
        break;
      }
    }
  }

  return { bloquesEnviados, filasEnviadas, filasResueltas, cancelado, detenido, motivo };
}
