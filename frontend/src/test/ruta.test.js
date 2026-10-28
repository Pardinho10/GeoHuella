import { describe, it, expect } from 'vitest';
import {
  formatearDistancia,
  formatearDuracion,
  etiquetaPerfil,
  boundsDeRuta,
} from '../lib/ruta.js';

describe('utilidades de ruta', () => {
  it('formatea distancias', () => {
    expect(formatearDistancia(328.6)).toBe('329 m');
    expect(formatearDistancia(1051.4)).toBe('1,1 km');
    expect(formatearDistancia(125000)).toBe('125 km');
    expect(formatearDistancia(null)).toBe('—');
  });

  it('formatea duraciones', () => {
    expect(formatearDuracion(30)).toBe('1 min');
    expect(formatearDuracion(1800)).toBe('30 min');
    expect(formatearDuracion(5400)).toBe('1 h 30 min');
    expect(formatearDuracion(7200)).toBe('2 h');
    expect(formatearDuracion(-1)).toBe('—');
  });

  it('etiqueta perfiles', () => {
    expect(etiquetaPerfil('walking')).toBe('Caminando');
    expect(etiquetaPerfil('driving')).toBe('Auto');
    expect(etiquetaPerfil('cycling')).toBe('Bici');
  });

  it('calcula bounds de una ruta GeoJSON', () => {
    const ruta = {
      ruta: {
        features: [{
          geometry: {
            type: 'LineString',
            coordinates: [[-64.3, -27.8], [-64.2, -27.7], [-64.25, -27.9]],
          },
        }],
      },
    };
    expect(boundsDeRuta(ruta)).toEqual([[-64.3, -27.9], [-64.2, -27.7]]);
    expect(boundsDeRuta(null)).toBeNull();
  });
});
