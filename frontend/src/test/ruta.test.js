import { describe, it, expect } from 'vitest';
import {
  formatearDistancia,
  formatearDuracion,
  etiquetaPerfil,
  boundsDeRuta,
  tramosDeRuta,
  TRAMOS_RUTA,
  pinturaTramo,
  leyendaRuta,
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

describe('estilo y leyenda de tramos de ruta', () => {
  const rutaConVuelta = {
    volverInicio: true,
    ruta: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { way_points: [0, 2, 3] },
        geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 2], [0, 0]] },
      }],
    },
  };
  const rutaSencilla = {
    volverInicio: false,
    ruta: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
      }],
    },
  };

  it('ida y regreso se distinguen por color, grosor, trama y desplazamiento', () => {
    const { ida, regreso } = TRAMOS_RUTA;
    expect(ida.color).not.toBe(regreso.color);
    expect(ida.ancho).toBeGreaterThan(regreso.ancho);
    expect(ida.guion).toBeNull();
    expect(Array.isArray(regreso.guion)).toBe(true);
    // La ida va centrada; el regreso se corre al costado. Como su geometría
    // está invertida, el signo negativo lo manda al lado opuesto de la ida.
    expect(ida.desplazamiento).toBe(0);
    expect(regreso.desplazamiento).toBeLessThan(0);
    expect(Math.abs(regreso.desplazamiento)).toBeGreaterThan(ida.ancho / 2 + regreso.ancho / 2);
  });

  it('el borde es continuo y el guion solo afecta al trazo visible', () => {
    const borde = pinturaTramo(TRAMOS_RUTA.regreso, { borde: true });
    const trazo = pinturaTramo(TRAMOS_RUTA.regreso);
    expect(borde['line-width']).toBeGreaterThan(trazo['line-width']);
    expect(borde['line-dasharray']).toBeUndefined();
    expect(trazo['line-dasharray']).toEqual(TRAMOS_RUTA.regreso.guion);
    expect(trazo['line-color']).toBe(TRAMOS_RUTA.regreso.color);
    expect(borde['line-offset']).toBe(trazo['line-offset']);
  });

  it('la leyenda sigue la elección de ida y vuelta', () => {
    const vuelta = leyendaRuta(rutaConVuelta);
    expect(vuelta.map((t) => t.etiqueta)).toEqual(['Ida', 'Regreso']);
    expect(vuelta[0].color).toBe(TRAMOS_RUTA.ida.color);
    expect(vuelta[1].color).toBe(TRAMOS_RUTA.regreso.color);
    expect(vuelta[1].guion).toEqual(TRAMOS_RUTA.regreso.guion);

    const sencilla = leyendaRuta(rutaSencilla);
    expect(sencilla).toHaveLength(1);
    expect(sencilla[0].etiqueta).toBe('Recorrido');
    expect(sencilla[0].color).toBe(TRAMOS_RUTA.ida.color);
  });

  it('no hay leyenda sin ruta', () => {
    expect(leyendaRuta(null)).toEqual([]);
    expect(leyendaRuta({})).toEqual([]);
  });
});
