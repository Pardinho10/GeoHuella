import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  avanzarProgreso,
  construirRecorrido,
  coordenadasDeTramo,
  DURACION_MAXIMA_MS,
  DURACION_MINIMA_MS,
  distanciasAcumuladas,
  duracionAnimacionMs,
  interpolarEnRecorrido,
  observarMovimientoReducido,
  PASO_MANUAL,
  prefiereMovimientoReducido,
  rumboEntre,
} from '../lib/animacion.js';

function rutaDe({ coordenadas, volverInicio = false, perfil = 'walking', wayPoints = null, props = {} } = {}) {
  return {
    perfil,
    volverInicio,
    distancia_metros: 1000,
    duracion_segundos: 600,
    ruta: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coordenadas },
        properties: {
          summary: { distance: 1000, duration: 600 },
          ...(wayPoints ? { way_points: wayPoints } : {}),
          ...props,
        },
      }],
    },
  };
}

// Ida A→B→C y regreso C→B→A (la geometría del proveedor ya viene con ese sentido).
const A = [-64.27, -27.79];
const B = [-64.26, -27.78];
const C = [-64.25, -27.77];
const IDA = [A, B, C];
const VUELTA = [A, B, C, B, A];
const RUTA_IDA = rutaDe({ coordenadas: IDA });
const RUTA_VUELTA = rutaDe({ coordenadas: VUELTA, volverInicio: true, wayPoints: [0, 2, 4] });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('duracionAnimacionMs — duración UX acotada', () => {
  it('usa 5 s por km en el rango medio', () => {
    expect(duracionAnimacionMs(4000)).toBe(20000);
    expect(duracionAnimacionMs(8000)).toBe(40000);
  });

  it('acota distancias cortas y largas para no animar horas reales', () => {
    expect(duracionAnimacionMs(100)).toBe(DURACION_MINIMA_MS);
    expect(duracionAnimacionMs(1200000)).toBe(DURACION_MAXIMA_MS);
    expect(duracionAnimacionMs(0)).toBe(DURACION_MINIMA_MS);
    expect(duracionAnimacionMs(Number.NaN)).toBe(DURACION_MINIMA_MS);
  });

  it('nunca supera 45 s', () => {
    expect(DURACION_MAXIMA_MS).toBe(45000);
    expect(duracionAnimacionMs(500000)).toBeLessThanOrEqual(DURACION_MAXIMA_MS);
  });
});

describe('construirRecorrido — geometría del proveedor', () => {
  it('conserva el orden exacto de la ida sin invertir coordenadas', () => {
    const recorrido = construirRecorrido(RUTA_IDA);
    expect(recorrido.coordenadas).toEqual(IDA);
    expect(recorrido.regreso).toBeNull();
    expect(recorrido.ida).toEqual({ inicio: 0, fin: 2 });
    expect(recorrido.perfil).toBe('walking');
    expect(recorrido.distanciaMetros).toBeGreaterThan(0);
  });

  it('en ida y vuelta recorre la ida y después el regreso, sin duplicar el punto de giro', () => {
    const recorrido = construirRecorrido(RUTA_VUELTA);
    expect(recorrido.coordenadas).toEqual(VUELTA);
    expect(recorrido.idaYVuelta).toBe(true);
    expect(recorrido.regreso).toEqual({ inicio: 3, fin: 4 });
    expect(recorrido.ida).toEqual({ inicio: 0, fin: 2 });
    // El giro (C) aparece una sola vez: ida termina en el índice 2.
    expect(recorrido.coordenadas[2]).toEqual(C);
    expect(recorrido.coordenadas[3]).toEqual(B);
  });

  it('si el regreso no comparte el punto de giro, lo agrega completo', () => {
    const D = [-64.245, -27.765];
    const ruta = rutaDe({ coordenadas: [A, B, C, D, B, A], volverInicio: true, wayPoints: [0, 3, 5] });
    const recorrido = construirRecorrido(ruta);
    expect(recorrido.coordenadas).toEqual([A, B, C, D, B, A]);
    expect(recorrido.regreso).toEqual({ inicio: 4, fin: 5 });
    expect(recorrido.coordenadas[4]).toEqual(B);
  });

  it('descarta puntos repetidos consecutivos sin cambiar el sentido', () => {
    const recorrido = construirRecorrido(rutaDe({ coordenadas: [A, A, B, B, C] }));
    expect(recorrido.coordenadas).toEqual([A, B, C]);
  });

  it('devuelve null si la geometría no alcanza para animar', () => {
    expect(construirRecorrido(null)).toBeNull();
    expect(construirRecorrido(rutaDe({ coordenadas: [] }))).toBeNull();
    expect(construirRecorrido(rutaDe({ coordenadas: [A] }))).toBeNull();
    expect(construirRecorrido({ perfil: 'walking' })).toBeNull();
  });

  it('coordenadasDeTramo y distanciasAcumuladas son coherentes', () => {
    expect(coordenadasDeTramo(RUTA_IDA.ruta)).toEqual(IDA);
    expect(coordenadasDeTramo(null)).toEqual([]);
    const acumuladas = distanciasAcumuladas(IDA);
    expect(acumuladas[0]).toBe(0);
    expect(acumuladas[1]).toBeGreaterThan(0);
    expect(acumuladas[2]).toBeGreaterThan(acumuladas[1]);
  });
});

describe('interpolarEnRecorrido — interpolación y rumbo', () => {
  it('arranca en el primer punto y termina en el último', () => {
    const recorrido = construirRecorrido(RUTA_IDA);
    expect(interpolarEnRecorrido(recorrido, 0)).toMatchObject({ lat: A[1], lng: A[0], tramo: 'ida' });
    expect(interpolarEnRecorrido(recorrido, 1)).toMatchObject({ lat: C[1], lng: C[0] });
  });

  it('interpola linealmente en una recta horizontal', () => {
    const recorrido = construirRecorrido(rutaDe({ coordenadas: [[-64.3, -27.8], [-64.2, -27.8]] }));
    const medio = interpolarEnRecorrido(recorrido, 0.5);
    expect(medio.lng).toBeCloseTo(-64.25, 6);
    expect(medio.lat).toBeCloseTo(-27.8, 6);
    expect(medio.rumbo).toBeCloseTo(90, 1);
    expect(medio.tramo).toBe('ida');
  });

  it('calcula el rumbo en los cuatro sentidos', () => {
    expect(rumboEntre([-64.26, -27.8], [-64.26, -27.7])).toBeCloseTo(0, 3);
    expect(rumboEntre([-64.26, -27.8], [-64.16, -27.8])).toBeCloseTo(90, 1);
    expect(rumboEntre([-64.26, -27.7], [-64.26, -27.8])).toBeCloseTo(180, 3);
    expect(rumboEntre([-64.26, -27.8], [-64.36, -27.8])).toBeCloseTo(270, 1);
    expect(rumboEntre(A, A)).toBe(0);
    expect(rumboEntre(null, A)).toBe(0);
  });

  it('marca el tramo de regreso después del punto de giro', () => {
    const recorrido = construirRecorrido(RUTA_VUELTA);
    const giro = recorrido.acumuladas[2] / recorrido.distanciaMetros;
    expect(interpolarEnRecorrido(recorrido, giro - 0.001).tramo).toBe('ida');
    expect(interpolarEnRecorrido(recorrido, giro + 0.001).tramo).toBe('regreso');
    expect(interpolarEnRecorrido(recorrido, 0.99).tramo).toBe('regreso');
  });

  it('no teletransporta en el punto de giro', () => {
    const recorrido = construirRecorrido(RUTA_VUELTA);
    const giro = recorrido.acumuladas[2] / recorrido.distanciaMetros;
    const antes = interpolarEnRecorrido(recorrido, giro - 1e-6);
    const despues = interpolarEnRecorrido(recorrido, giro + 1e-6);
    expect(Math.abs(antes.lat - despues.lat)).toBeLessThan(1e-5);
    expect(Math.abs(antes.lng - despues.lng)).toBeLessThan(1e-5);
  });

  it('el rumbo del regreso apunta en sentido contrario al de la ida', () => {
    const recorrido = construirRecorrido(RUTA_VUELTA);
    const ida = interpolarEnRecorrido(recorrido, 0.02);
    const regreso = interpolarEnRecorrido(recorrido, 0.98);
    const diferencia = Math.abs(((ida.rumbo - regreso.rumbo) % 360 + 360) % 360);
    expect(Math.abs(diferencia - 180)).toBeLessThan(1);
  });

  it('acota el progreso fuera de rango y tolera valores inválidos', () => {
    const recorrido = construirRecorrido(RUTA_IDA);
    expect(interpolarEnRecorrido(recorrido, -3)).toMatchObject({ lat: A[1], lng: A[0] });
    expect(interpolarEnRecorrido(recorrido, 42)).toMatchObject({ lat: C[1], lng: C[0] });
    expect(interpolarEnRecorrido(recorrido, Number.NaN)).toMatchObject({ lat: A[1], lng: A[0] });
    expect(interpolarEnRecorrido(null, 0.5)).toBeNull();
  });

  it('conserva el perfil de la ruta', () => {
    expect(construirRecorrido(rutaDe({ coordenadas: IDA, perfil: 'driving' })).perfil).toBe('driving');
    expect(construirRecorrido(rutaDe({ coordenadas: IDA, perfil: 'cycling' })).perfil).toBe('cycling');
    expect(construirRecorrido(rutaDe({ coordenadas: IDA, perfil: undefined })).perfil).toBe('walking');
  });
});

describe('controles — progreso y movimiento reducido', () => {
  it('avanzarProgreso respeta 0..1', () => {
    expect(avanzarProgreso(0, PASO_MANUAL)).toBeCloseTo(0.05, 6);
    expect(avanzarProgreso(0.98, PASO_MANUAL)).toBe(1);
    expect(avanzarProgreso(0.01, -PASO_MANUAL)).toBe(0);
    expect(avanzarProgreso(Number.NaN, 0.1)).toBe(0.1);
    expect(avanzarProgreso(0.5, Number.NaN)).toBe(0.5);
  });

  it('sin matchMedia se asume movimiento reducido (sin auto-play)', () => {
    expect(typeof window.matchMedia).not.toBe('function');
    expect(prefiereMovimientoReducido()).toBe(true);
  });

  it('lee la preferencia del sistema', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    expect(prefiereMovimientoReducido()).toBe(true);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    expect(prefiereMovimientoReducido()).toBe(false);
  });

  it('observarMovimientoReducido notifica y permite desuscribirse', () => {
    const manejadores = [];
    const media = {
      matches: false,
      addEventListener: (evento, manejador) => manejadores.push(manejador),
      removeEventListener: (evento, manejador) => {
        const indice = manejadores.indexOf(manejador);
        if (indice >= 0) manejadores.splice(indice, 1);
      },
    };
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    const cambios = [];
    const desuscribir = observarMovimientoReducido((valor) => cambios.push(valor));

    manejadores[0]({ matches: true });
    expect(cambios).toEqual([true]);

    desuscribir();
    expect(manejadores).toHaveLength(0);
  });

  it('observarMovimientoReducido es inocuo sin matchMedia', () => {
    const desuscribir = observarMovimientoReducido(() => {});
    expect(() => desuscribir()).not.toThrow();
  });
});
