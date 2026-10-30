import { describe, it, expect, vi } from 'vitest';
import { armarBloques, ejecutarLote } from '../lib/lote.js';
import {
  aplicarResultado,
  aplicarResultados,
  MAX_FILAS_BLOQUE,
  marcarBuscando,
  marcarCanceladas,
  marcarError,
  pendientesDeGeocodificar,
  crearFilasDesdeDatos,
} from '../lib/importacion.js';

function filasDe(cantidad) {
  return Array.from({ length: cantidad }, (_, i) => ({
    id: `fila-${i + 1}`,
    calle: `Calle ${i + 1}`,
    altura: String(100 + i),
    ciudad: 'Ciudad',
    provincia: 'Provincia',
    estado: 'pendiente',
    candidatos: [],
    candidatoElegido: null,
    seleccionada: false,
    descartada: false,
    coordsManuales: null,
    errores: {},
  }));
}

describe('armarBloques', () => {
  it('nunca supera 10 filas por bloque', () => {
    const bloques = armarBloques(filasDe(100));
    expect(bloques).toHaveLength(10);
    expect(bloques.every((b) => b.length <= MAX_FILAS_BLOQUE)).toBe(true);
    expect(bloques.flat()).toHaveLength(100);
  });

  it('el último bloque conserva el remanente', () => {
    const bloques = armarBloques(filasDe(23), 10);
    expect(bloques.map((b) => b.length)).toEqual([10, 10, 3]);
  });

  it('no arma bloques vacíos', () => {
    expect(armarBloques([])).toEqual([]);
    expect(armarBloques(null)).toEqual([]);
  });
});

describe('ejecutarLote — secuencialidad', () => {
  it('envía bloques en orden, sin paralelismo y de hasta 10 filas', async () => {
    const filas = filasDe(23);
    const llamadas = [];
    let enVuelo = 0;
    let maxEnVuelo = 0;

    const resultado = await ejecutarLote({
      filas,
      enviarBloque: async (bloque) => {
        enVuelo += 1;
        maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
        llamadas.push(bloque.map((f) => f.id));
        await new Promise((r) => setTimeout(r, 1));
        enVuelo -= 1;
        return bloque.map((f) => ({ id: f.id, estado: 'encontrada', candidatos: [], mensaje: null }));
      },
    });

    expect(maxEnVuelo).toBe(1);
    expect(llamadas).toEqual([
      filas.slice(0, 10).map((f) => f.id),
      filas.slice(10, 20).map((f) => f.id),
      filas.slice(20).map((f) => f.id),
    ]);
    expect(resultado).toMatchObject({ bloquesEnviados: 3, filasEnviadas: 23, cancelado: false });
  });

  it('100 filas producen 10 solicitudes de 10', async () => {
    const envios = [];
    await ejecutarLote({
      filas: filasDe(100),
      enviarBloque: async (bloque) => {
        envios.push(bloque.length);
        return bloque.map((f) => ({ id: f.id, estado: 'encontrada', candidatos: [], mensaje: null }));
      },
    });
    expect(envios).toEqual(Array(10).fill(10));
  });

  it('propaga el AbortSignal a cada solicitud', async () => {
    const control = new AbortController();
    const senales = [];
    await ejecutarLote({
      filas: filasDe(3),
      control,
      enviarBloque: async (bloque, info) => {
        senales.push(info.signal);
        return bloque.map((f) => ({ id: f.id, estado: 'encontrada', candidatos: [], mensaje: null }));
      },
    });
    expect(senales.every((s) => s === control.signal)).toBe(true);
  });
});

describe('ejecutarLote — cancelación', () => {
  it('cancela entre bloques y conserva los resultados ya obtenidos', async () => {
    const filas = filasDe(25);
    let estado = [...filas];
    let bloques = 0;

    const resultado = await ejecutarLote({
      filas,
      debeCancelar: () => bloques >= 1,
      alEnviar: (ids) => { estado = marcarBuscando(estado, ids); },
      alResolver: (res) => { estado = aplicarResultados(estado, res); },
      enviarBloque: async (bloque) => {
        bloques += 1;
        return bloque.map((f) => ({
          id: f.id,
          estado: 'encontrada',
          candidatos: [{ lat: -27.78, lng: -64.26, direccion: 'x', aproximada: false }],
          mensaje: null,
        }));
      },
    });

    expect(resultado.cancelado).toBe(true);
    expect(resultado.bloquesEnviados).toBe(1);
    expect(estado.filter((f) => f.estado === 'encontrada')).toHaveLength(10);
    expect(estado.filter((f) => f.estado === 'pendiente')).toHaveLength(15);

    const trasCancelar = marcarCanceladas(estado);
    expect(trasCancelar.filter((f) => f.estado === 'encontrada')).toHaveLength(10);
    expect(trasCancelar.filter((f) => f.estado === 'cancelada')).toHaveLength(15);
  });

  it('aborta el bloque en vuelo con AbortError y no pierde lo resuelto', async () => {
    const control = new AbortController();
    const filas = filasDe(12);
    let resueltas = 0;

    const promesa = ejecutarLote({
      filas,
      control,
      debeCancelar: () => control.signal.aborted,
      alResolver: (res) => { resueltas += res.length; },
      enviarBloque: (bloque, info) => {
        if (resueltas === 0) {
          return Promise.resolve(bloque.map((f) => ({ id: f.id, estado: 'encontrada', candidatos: [] })));
        }
        return new Promise((_, reject) => {
          info.signal.addEventListener('abort', () => {
            const e = new Error('Cancelado');
            e.name = 'AbortError';
            reject(e);
          }, { once: true });
        });
      },
    });

    await new Promise((r) => setTimeout(r, 5));
    control.abort();
    const resultado = await promesa;

    expect(resultado.cancelado).toBe(true);
    expect(resueltas).toBe(10);
    expect(resultado.filasEnviadas).toBe(12);
  });
});

describe('ejecutarLote — errores', () => {
  it('un error de bloque marca filas con error y sigue con el próximo bloque', async () => {
    const filas = filasDe(12);
    let estado = [...filas];
    const errores = [];
    let llamadas = 0;

    const resultado = await ejecutarLote({
      filas,
      alFallar: (ids, err) => {
        errores.push(err.codigo);
        estado = marcarError(estado, ids, err);
      },
      enviarBloque: async (bloque) => {
        llamadas += 1;
        if (llamadas === 1) {
          const e = new Error('Fila inválida');
          e.codigo = 'solicitud_invalida';
          throw e;
        }
        return bloque.map((f) => ({ id: f.id, estado: 'encontrada', candidatos: [] }));
      },
    });

    expect(resultado.detenido).toBe(false);
    expect(resultado.bloquesEnviados).toBe(2);
    expect(errores).toEqual(['solicitud_invalida']);
    expect(estado.filter((f) => f.estado === 'error')).toHaveLength(10);
  });

  it('se detiene ante un error de conexión sin seguir enviando bloques', async () => {
    const filas = filasDe(30);
    let llamadas = 0;

    const resultado = await ejecutarLote({
      filas,
      enviarBloque: async () => {
        llamadas += 1;
        const e = new Error('No se pudo conectar con el servidor');
        e.codigo = 'conexion';
        throw e;
      },
    });

    expect(llamadas).toBe(1);
    expect(resultado.detenido).toBe(true);
    expect(resultado.motivo).toBe('conexion');
  });

  it('sin filas pendientes no envía nada', async () => {
    const enviar = vi.fn();
    const resultado = await ejecutarLote({ filas: [], enviarBloque: enviar });
    expect(enviar).not.toHaveBeenCalled();
    expect(resultado.bloquesEnviados).toBe(0);
  });
});

describe('clasificación de resultados por fila', () => {
  const base = filasDe(1)[0];

  it('encontrada exacta queda preseleccionada', () => {
    const fila = aplicarResultado(base, {
      id: base.id,
      estado: 'encontrada',
      candidatos: [{ lat: -27.78, lng: -64.26, direccion: 'Perú 781', aproximada: false }],
      mensaje: null,
    });
    expect(fila.estado).toBe('encontrada');
    expect(fila.seleccionada).toBe(true);
    expect(fila.candidatos).toHaveLength(1);
  });

  it('ambigua no queda preseleccionada', () => {
    const fila = aplicarResultado(base, {
      id: base.id,
      estado: 'ambigua',
      candidatos: [
        { lat: -27.78, lng: -64.26, direccion: 'A', aproximada: false },
        { lat: -27.79, lng: -64.27, direccion: 'B', aproximada: false },
      ],
    });
    expect(fila.estado).toBe('ambigua');
    expect(fila.seleccionada).toBe(false);
  });

  it('un único candidato aproximado es ambigua y requiere selección', () => {
    const fila = aplicarResultado(base, {
      id: base.id,
      estado: 'encontrada',
      candidatos: [{ lat: -27.78, lng: -64.26, direccion: 'Perú 783', aproximada: true }],
    });
    expect(fila.estado).toBe('ambigua');
    expect(fila.seleccionada).toBe(false);
  });

  it('un candidato sin el campo aproximada se trata como aproximado', () => {
    const fila = aplicarResultado(base, {
      id: base.id,
      estado: 'encontrada',
      candidatos: [{ lat: -27.78, lng: -64.26, direccion: 'Perú 781' }],
    });
    expect(fila.candidatos[0].aproximada).toBe(true);
    expect(fila.estado).toBe('ambigua');
    expect(fila.seleccionada).toBe(false);
  });

  it('sin candidatos es sin_resultado', () => {
    const fila = aplicarResultado(base, { id: base.id, estado: 'encontrada', candidatos: [] });
    expect(fila.estado).toBe('sin_resultado');
    expect(fila.mensaje).toBeTruthy();
  });

  it('error de proveedor se aísla con mensaje claro', () => {
    const fila = aplicarResultado(base, { id: base.id, estado: 'error', candidatos: [], mensaje: 'Proveedor caído.' });
    expect(fila.estado).toBe('error');
    expect(fila.mensaje).toBe('Proveedor caído.');
    expect(fila.seleccionada).toBe(false);
  });

  it('descarta candidatos inválidos y fuera de Argentina', () => {
    const fila = aplicarResultado(base, {
      id: base.id,
      estado: 'ambigua',
      candidatos: [
        { lat: 40, lng: -64, direccion: 'Madrid' },
        { lat: -27.78, lng: -64.26, direccion: 'Perú 781' },
      ],
    });
    expect(fila.candidatos).toHaveLength(1);
    expect(fila.candidatos[0].direccion).toBe('Perú 781');
  });

  it('aplicarResultados no toca filas ajenas al bloque', () => {
    const filas = filasDe(3);
    const resueltas = aplicarResultados(filas, [
      { id: 'fila-2', estado: 'encontrada', candidatos: [{ lat: -27.78, lng: -64.26, aproximada: false }] },
    ]);
    expect(resueltas[0].estado).toBe('pendiente');
    expect(resueltas[1].estado).toBe('encontrada');
    expect(resueltas[2].estado).toBe('pendiente');
  });

  it('reintentar conserva las filas ya resueltas', () => {
    const filas = [
      { ...filasDe(1)[0], id: 'fila-1', estado: 'encontrada' },
      { ...filasDe(1)[0], id: 'fila-2', estado: 'cancelada' },
      { ...filasDe(1)[0], id: 'fila-3', estado: 'error' },
    ];
    const pendientes = pendientesDeGeocodificar(filas);
    expect(pendientes.map((f) => f.id)).toEqual(['fila-2', 'fila-3']);
  });
});

describe('estados iniciales', () => {
  it('crearFilasDesdeDatos deja filas pendientes sin selección', () => {
    const filas = crearFilasDesdeDatos([{ calle: 'Perú', altura: '781', ciudad: 'C', provincia: 'P' }]);
    expect(filas[0]).toMatchObject({ estado: 'pendiente', seleccionada: false, candidatos: [] });
  });
});
