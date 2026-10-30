import { describe, it, expect } from 'vitest';
import {
  coordenadasDeFila,
  detectarDuplicados,
  distanciaMetros,
  itemParaAgregar,
  seleccionadasParaAgregar,
} from '../lib/importacion.js';

function fila(extra = {}) {
  return {
    id: 'fila-1',
    nombre: '',
    calle: 'Perú',
    altura: '781',
    ciudad: 'Santiago del Estero',
    provincia: 'Santiago del Estero',
    estado: 'encontrada',
    candidatos: [{ lat: -27.77751, lng: -64.26501, direccion: 'PERU 781', aproximada: false }],
    candidatoElegido: 0,
    seleccionada: true,
    descartada: false,
    coordsManuales: null,
    errores: {},
    ...extra,
  };
}

const ELEMENTO = {
  id: 'el-1',
  nombre: 'Casa',
  direccion: 'PERU 781, Santiago del Estero, Capital, Santiago del Estero',
  lat: -27.77751,
  lng: -64.26501,
  color: '#c57b57',
  origen: 'direccion',
  creadoEn: '2026-01-01T00:00:00.000Z',
};

describe('distanciaMetros', () => {
  it('calcula metros entre coordenadas cercanas', () => {
    const d = distanciaMetros({ lat: -27.77751, lng: -64.26501 }, { lat: -27.77751, lng: -64.26501 });
    expect(d).toBe(0);
    const cincoMetros = distanciaMetros({ lat: -27.77751, lng: -64.26501 }, { lat: -27.77751, lng: -64.26495 });
    expect(cincoMetros).toBeGreaterThan(1);
    expect(cincoMetros).toBeLessThan(20);
  });
});

describe('coordenadasDeFila', () => {
  it('prefiere las coordenadas manuales sobre el candidato', () => {
    const f = fila({ coordsManuales: { lat: -27.79, lng: -64.27 } });
    expect(coordenadasDeFila(f)).toEqual({ lat: -27.79, lng: -64.27 });
  });

  it('usa el candidato elegido', () => {
    expect(coordenadasDeFila(fila())).toEqual({ lat: -27.77751, lng: -64.26501 });
  });

  it('sin candidato ni manuales no devuelve coordenadas', () => {
    expect(coordenadasDeFila(fila({ candidatoElegido: null }))).toBeNull();
  });
});

describe('duplicados contra puntos existentes', () => {
  it('marca por texto normalizado sin acentos', () => {
    // Coordenadas distintas a propósito: la coincidencia debe venir del texto.
    const lejos = { ...ELEMENTO, lat: -27.9, lng: -64.4 };
    const marcas = detectarDuplicados([fila()], [lejos]);
    expect(marcas.get('fila-1')).toMatchObject({ motivo: 'texto' });
    expect(marcas.get('fila-1').contra).toBe('Casa');
  });

  it('marca por coordenadas a 5 m o menos', () => {
    const marcas = detectarDuplicados(
      [fila({ calle: 'Otra', altura: '999' })],
      [{ ...ELEMENTO, direccion: 'OTRA CALLE 999', lat: -27.77751, lng: -64.26498 }],
    );
    expect(marcas.get('fila-1').motivo).toBe('coordenadas');
  });

  it('no marca cuando el texto y las coordenadas son distintos', () => {
    const marcas = detectarDuplicados(
      [fila({ calle: 'Libertad', altura: '640', candidatoElegido: null, candidatos: [] })],
      [ELEMENTO],
    );
    expect(marcas.size).toBe(0);
  });

  it('no confunde alturas con prefijo común (781 vs 7810)', () => {
    const marcas = detectarDuplicados(
      [fila({ calle: 'Perú', altura: '7810', candidatoElegido: null })],
      [{ ...ELEMENTO, direccion: 'PERU 781, Santiago del Estero' }],
    );
    expect(marcas.size).toBe(0);
  });

  it('ignora filas descartadas', () => {
    const marcas = detectarDuplicados([fila({ descartada: true })], [ELEMENTO]);
    expect(marcas.size).toBe(0);
  });
});

describe('duplicados entre filas', () => {
  it('solo compara contra filas ya seleccionadas', () => {
    const primera = fila({ id: 'fila-1', seleccionada: false, candidatoElegido: null, candidatos: [] });
    const segunda = fila({ id: 'fila-2', seleccionada: false, candidatoElegido: null, candidatos: [] });
    expect(detectarDuplicados([primera, segunda], []).size).toBe(0);

    const marcas = detectarDuplicados(
      [{ ...primera, seleccionada: true, candidatoElegido: 0 }, segunda],
      [],
    );
    expect(marcas.get('fila-2')).toMatchObject({ motivo: 'texto' });
    expect(marcas.get('fila-1')).toBeUndefined();
  });

  it('detecta coordenadas repetidas entre filas seleccionadas', () => {
    const a = fila({ id: 'fila-1', calle: 'A', altura: '1' });
    const b = fila({ id: 'fila-2', calle: 'B', altura: '2' });
    const marcas = detectarDuplicados([a, b], []);
    expect(marcas.get('fila-2').motivo).toBe('coordenadas');
  });
});

describe('selección final', () => {
  it('solo cuenta filas seleccionadas con coordenadas y no descartadas', () => {
    const filas = [
      fila({ id: 'fila-1' }),
      fila({ id: 'fila-2', seleccionada: false }),
      fila({ id: 'fila-3', candidatoElegido: null, seleccionada: true }),
      fila({ id: 'fila-4', descartada: true, seleccionada: true }),
    ];
    expect(seleccionadasParaAgregar(filas).map((f) => f.id)).toEqual(['fila-1']);
  });

  it('un duplicado solo se agrega con inclusión explícita', () => {
    const filas = [fila({ id: 'fila-1' })];
    const marcas = detectarDuplicados(filas, [ELEMENTO]);
    expect(marcas.size).toBe(1);
    expect(seleccionadasParaAgregar(filas, marcas)).toHaveLength(0);
    expect(seleccionadasParaAgregar([{ ...filas[0], incluirDuplicado: true }], marcas)).toHaveLength(1);
  });

  it('itemParaAgregar usa la dirección del candidato o la de los campos', () => {
    expect(itemParaAgregar(fila())).toMatchObject({
      lat: -27.77751,
      lng: -64.26501,
      direccion: 'PERU 781',
      origen: 'direccion',
    });

    const manual = fila({
      candidatoElegido: null,
      candidatos: [],
      coordsManuales: { lat: -27.79, lng: -64.27 },
      nombre: 'Casa',
    });
    expect(itemParaAgregar(manual)).toMatchObject({
      nombre: 'Casa',
      direccion: 'Perú 781, Santiago del Estero, Santiago del Estero',
      origen: 'coordenadas',
    });
  });

  it('itemParaAgregar sin coordenadas devuelve null', () => {
    expect(itemParaAgregar(fila({ candidatoElegido: null }))).toBeNull();
  });
});
