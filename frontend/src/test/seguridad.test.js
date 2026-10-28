import { describe, it, expect } from 'vitest';
import { colorSeguro } from '../lib/storage.js';
import { anclajeParaOffset } from '../lib/marcadores.js';

describe('seguridad marcadores', () => {
  it('colorSeguro acepta paleta y hex estricto, rechaza arbitrario', () => {
    expect(colorSeguro('#ff0000')).toBe('#ff0000');
    expect(colorSeguro('#c57b57')).toBe('#c57b57');
    expect(colorSeguro('javascript:alert(1)')).toBe('#c57b57');
    expect(colorSeguro('<script>')).toBe('#c57b57');
    expect(colorSeguro(null)).toBe('#c57b57');
  });

  it('anclajeParaOffset desplaza hitbox junto al icono', () => {
    expect(anclajeParaOffset({ x: 5, y: -3 })).toEqual([4, 12]);
    expect(anclajeParaOffset()).toEqual([9, 9]);
  });
});
