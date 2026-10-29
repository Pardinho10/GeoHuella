import { describe, it, expect } from 'vitest';
import {
  agregarCandidatos, parsearCoordenada, parsearParPegado, enRangoArgentina,
  normalizarTexto,
} from '../lib/elementos.js';

describe('elementos', () => {
  it('paleta cíclica y nombres automáticos incrementan contador', () => {
    const res = agregarCandidatos(
      [{ lat: 1, lng: 2, direccion: 'D1' }, { lat: 3, lng: 4, direccion: 'D2' }],
      '',
      [],
      0
    );
    expect(res.agregados).toHaveLength(2);
    expect(res.agregados[0].nombre).toBe('Elemento 1');
    expect(res.agregados[1].nombre).toBe('Elemento 2');
    expect(res.contador).toBe(2);
    expect(res.elementos).toHaveLength(2);
  });

  it('nombre personalizado no incrementa contador', () => {
    const res = agregarCandidatos([{ lat: 1, lng: 2, direccion: 'D' }], 'Mi punto', [], 5);
    expect(res.agregados[0].nombre).toBe('Mi punto');
    expect(res.contador).toBe(5);
  });

  it('borrar no reduce contador (simulado: nuevo agregado sigue)', () => {
    let els = [];
    let c = 0;
    const r1 = agregarCandidatos([{ lat: 1, lng: 2, direccion: 'D' }], '', els, c);
    els = r1.elementos; c = r1.contador;
    // borrar
    els = els.filter(() => false);
    const r2 = agregarCandidatos([{ lat: 3, lng: 4, direccion: 'D2' }], '', els, c);
    expect(r2.agregados[0].nombre).toBe('Elemento 2');
    expect(r2.contador).toBe(2);
  });

  it('límite 200: no guarda más', () => {
    const muchos = Array.from({ length: 205 }, (_, i) => ({ lat: i, lng: i, direccion: `D${i}` }));
    const res = agregarCandidatos(muchos, '', [], 0);
    expect(res.agregados).toHaveLength(200);
    expect(res.noAgregados).toBe(5);
  });

  it('parsearCoordenada acepta coma o punto', () => {
    expect(parsearCoordenada('-27,7951')).toBeCloseTo(-27.7951);
    expect(parsearCoordenada('-27.7951')).toBeCloseTo(-27.7951);
    expect(parsearCoordenada('abc')).toBeNull();
  });

  it('parsearParPegado formatos', () => {
    expect(parsearParPegado('-27.7951, -64.2615')).toEqual({ lat: -27.7951, lng: -64.2615 });
    expect(parsearParPegado('-27,7951; -64,2615')).toEqual({ lat: -27.7951, lng: -64.2615 });
    expect(parsearParPegado('foo')).toBeNull();
  });

  it('parsearParPegado rechaza ambiguos/adicionales', () => {
    expect(parsearParPegado('-27,7951, -64,2615')).toBeNull();
    expect(parsearParPegado('-27.7951, -64.2615, -1')).toBeNull();
    expect(parsearParPegado('-27,7951; -64,2615; -1')).toBeNull();
    expect(parsearParPegado('-27,7951;')).toBeNull();
    expect(parsearParPegado(',-64.2615')).toBeNull();
  });

  it('normaliza texto para búsquedas sin acentos', () => {
    expect(normalizarTexto('Perú 781')).toBe('peru 781');
    expect(normalizarTexto('  AVENIDA CÓRDOBA ')).toBe('avenida cordoba');
    expect(normalizarTexto(null)).toBe('');
  });

  it('enRangoArgentina', () => {
    expect(enRangoArgentina(-27.7951, -64.2615)).toBe(true);
    expect(enRangoArgentina(0, 0)).toBe(false);
  });

  it('agregar por coordenadas reutiliza lógica y avisa si no caben', () => {
    const full = Array.from({ length: 200 }, (_, i) => ({ id: String(i), nombre: `E${i}`, direccion: null, lat: i, lng: i, color: '#fff', origen: 'direccion', creadoEn: '2026-01-01T00:00:00.000Z' }));
    const res = agregarCandidatos([{ lat: 1, lng: 2, direccion: 'Sin dirección disponible', origen: 'coordenadas' }], '', full, 5);
    expect(res.agregados).toHaveLength(0);
    expect(res.noAgregados).toBe(1);
    expect(res.contador).toBe(5);
  });
});
