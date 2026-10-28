import { describe, it, expect, beforeEach } from 'vitest';
import {
  cargarElementos, guardarElementos, cargarContador, guardarContador,
  CLAVE_ELEMENTOS, CLAVE_CONTADOR,
} from '../lib/storage.js';

beforeEach(() => {
  localStorage.clear();
});

describe('storage', () => {
  it('carga vacío si no hay datos', () => {
    expect(cargarElementos()).toEqual([]);
    expect(cargarContador()).toBe(0);
  });

  it('guarda y carga elementos', () => {
    const els = [{ id: '1', nombre: 'A', direccion: null, lat: 1, lng: 2, color: '#fff', origen: 'direccion', creadoEn: '2026-01-01T00:00:00.000Z' }];
    expect(guardarElementos(els)).toBe(true);
    expect(cargarElementos()).toEqual(els);
  });

  it('descarta datos corruptos', () => {
    localStorage.setItem(CLAVE_ELEMENTOS, '{bad json');
    expect(cargarElementos()).toEqual([]);
    localStorage.setItem(CLAVE_CONTADOR, 'abc');
    expect(cargarContador()).toBe(0);
  });

  it('descarta elementos inválidos y limita a 200', () => {
    const valid = { id: '1', nombre: 'A', direccion: null, lat: 1, lng: 2, color: '#fff', origen: 'direccion', creadoEn: '2026-01-01T00:00:00.000Z' };
    const invalid = { ...valid, id: '2', origen: 'otro' };
    const arr = [valid, invalid];
    // 205 validos
    const many = Array.from({ length: 205 }, (_, i) => ({ ...valid, id: String(i) }));
    localStorage.setItem(CLAVE_ELEMENTOS, JSON.stringify([...arr, ...many]));
    const loaded = cargarElementos();
    expect(loaded).toHaveLength(200);
    expect(loaded.every((e) => e.origen === 'direccion')).toBe(true);
  });

  it('contador monotónico guarda/carga', () => {
    guardarContador(5);
    expect(cargarContador()).toBe(5);
    localStorage.setItem(CLAVE_CONTADOR, '3.7');
    expect(cargarContador()).toBe(3);
  });
});

describe('storage no disponible', () => {
  it('cargarElementos devuelve [] si localStorage lanza', () => {
    const orig = window.localStorage.getItem;
    window.localStorage.getItem = () => { throw new Error('boom'); };
    expect(cargarElementos()).toEqual([]);
    window.localStorage.getItem = orig;
  });

  it('guardarElementos devuelve false si localStorage lanza', () => {
    const desc = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      get() { throw new Error('boom'); },
      configurable: true,
    });
    expect(guardarElementos([{ id: '1', nombre: 'A', direccion: null, lat: 1, lng: 2, color: '#fff', origen: 'direccion', creadoEn: '2026-01-01T00:00:00.000Z' }])).toBe(false);
    if (desc) Object.defineProperty(window, 'localStorage', desc);
  });
});
