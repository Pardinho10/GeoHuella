import { describe, it, expect } from 'vitest';
import {
  formatearDistancia,
  formatearDuracion,
  etiquetaPerfil,
  boundsDeRuta,
  tramosDeRuta,
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


describe('tramos de ida y regreso', () => {
  const feature = {
    type: 'Feature',
    properties: { way_points: [0, 2, 4, 5] },
    geometry: {
      type: 'LineString',
      coordinates: [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [0, 0]],
    },
  };

  it('separa la ida y el regreso usando way_points', () => {
    const tramos = tramosDeRuta({
      volverInicio: true,
      ruta: { type: 'FeatureCollection', features: [feature] },
    });
    expect(tramos.ida.features[0].geometry.coordinates).toHaveLength(5);
    expect(tramos.regreso.features[0].geometry.coordinates).toHaveLength(2);
    expect(tramos.ida.features[0].geometry.coordinates.at(-1)).toEqual([4, 4]);
    expect(tramos.regreso.features[0].geometry.coordinates[0]).toEqual([4, 4]);
  });

  it('no separa cuando la ruta no vuelve al inicio', () => {
    const ruta = { volverInicio: false, ruta: { type: 'FeatureCollection', features: [feature] } };
    const tramos = tramosDeRuta(ruta);
    expect(tramos.regreso).toBeNull();
    expect(tramos.ida).toBe(ruta.ruta);
  });
});
