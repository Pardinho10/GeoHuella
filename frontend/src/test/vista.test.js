import { describe, it, expect, vi } from 'vitest';
import { boundsParaElementos, ajustarVista } from '../lib/vista.js';
import { offsetsPorCoordenada } from '../lib/marcadores.js';

describe('boundsParaElementos', () => {
  it('devuelve null sin elementos', () => {
    expect(boundsParaElementos([])).toBeNull();
    expect(boundsParaElementos(null)).toBeNull();
  });

  it('calcula el bounding box de todos los elementos', () => {
    const elementos = [
      { lat: -34.6, lng: -58.4 },
      { lat: -31.4, lng: -64.2 },
      { lat: -27.8, lng: -64.3 },
    ];
    expect(boundsParaElementos(elementos)).toEqual([-64.3, -34.6, -58.4, -27.8]);
  });

  it('ignora elementos con coordenadas inválidas', () => {
    const elementos = [
      { lat: -34.6, lng: -58.4 },
      { lat: null, lng: -64.2 },
      { lat: 'x', lng: 'y' },
    ];
    expect(boundsParaElementos(elementos)).toEqual([-58.4, -34.6, -58.4, -34.6]);
  });
});

describe('ajustarVista', () => {
  it('usa flyTo con un único punto y no fitBounds', () => {
    const map = { flyTo: vi.fn(), fitBounds: vi.fn(), getZoom: () => 4 };
    expect(ajustarVista(map, [{ lat: -34.6, lng: -58.4 }], { animar: false })).toBe(true);
    expect(map.flyTo).toHaveBeenCalledTimes(1);
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.flyTo.mock.calls[0][0].center).toEqual([-58.4, -34.6]);
  });

  it('usa fitBounds con un bounding box para varios puntos', () => {
    const map = { flyTo: vi.fn(), fitBounds: vi.fn(), getZoom: () => 4 };
    const elementos = [
      { lat: -34.6, lng: -58.4 },
      { lat: -31.4, lng: -64.2 },
      { lat: -27.8, lng: -64.3 },
    ];
    expect(ajustarVista(map, elementos, { animar: false })).toBe(true);
    expect(map.fitBounds).toHaveBeenCalledWith(
      [-64.3, -34.6, -58.4, -27.8],
      expect.objectContaining({ padding: 40, maxZoom: 15 }),
    );
  });
});

describe('offsetsPorCoordenada', () => {
  it('solo separa coordenadas exactamente iguales', () => {
    const items = [
      { lat: 1, lng: 2 },
      { lat: 1, lng: 2 },
      { lat: 1.0005, lng: 2.0005 },
    ];
    const offsets = offsetsPorCoordenada(items);
    expect(offsets.has(0)).toBe(true);
    expect(offsets.has(1)).toBe(true);
    expect(offsets.has(2)).toBe(false);
  });
});
