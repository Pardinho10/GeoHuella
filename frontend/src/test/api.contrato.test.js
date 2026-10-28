import { describe, it, expect, beforeEach, vi } from 'vitest';
import { obtenerProvincias, geocodificar, ubicarCoordenadas, calcularRuta } from '../api/client.js';

describe('API contrato (fetch simulado)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('provincias: 24 strings', async () => {
    const provs = Array.from({ length: 24 }, (_, i) => `Prov${i}`);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ provincias: provs }),
    }));
    const res = await obtenerProvincias();
    expect(res).toHaveLength(24);
    expect(res.every((p) => typeof p === 'string')).toBe(true);
  });

  it('geocodificación: múltiples candidatos completos', async () => {
    const cand = {
      lat: -34.6, lng: -58.3, direccion: 'AV X 1', provincia: 'CABA',
      localidad: 'San Nicolás', departamento: 'Comuna 1', aproximada: true,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ resultados: [cand, { ...cand, lat: -34.7 }] }),
    }));
    const res = await geocodificar({ calle: 'X', numero: '1', ciudad: 'CABA', provincia: 'CABA' });
    expect(res).toHaveLength(2);
    for (const r of res) {
      expect(r).toHaveProperty('lat');
      expect(r).toHaveProperty('lng');
      expect(r).toHaveProperty('direccion');
      expect(r).toHaveProperty('provincia');
      expect(r).toHaveProperty('localidad');
      expect(r).toHaveProperty('departamento');
      expect(r.aproximada).toBe(true);
    }
  });

  it('404 no_encontrada propaga codigo y mensaje', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 404,
      json: async () => ({ error: { codigo: 'no_encontrada', mensaje: 'No se pudo ubicar la dirección. Revisá la calle, el número y la ciudad.' } }),
    }));
    await expect(
      geocodificar({ calle: 'X', numero: '1', ciudad: 'C', provincia: 'P' })
    ).rejects.toMatchObject({
      codigo: 'no_encontrada',
      message: expect.stringContaining('No se pudo ubicar'),
      sugerencias: [],
    });
  });

  it('404 con sugerencias cercanas las expone al cliente', async () => {
    const sugerencias = [
      { lat: -27.78, lng: -64.26, direccion: '630, Avenida Libertad', provincia: 'Santiago del Estero', localidad: 'Santiago del Estero', departamento: 'Capital', aproximada: true },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 404,
      json: async () => ({ error: { codigo: 'no_encontrada', mensaje: 'Altura no encontrada.', sugerencias } }),
    }));
    await expect(
      geocodificar({ calle: 'Libertad', numero: '640', ciudad: 'Santiago del Estero', provincia: 'Santiago del Estero' })
    ).rejects.toMatchObject({
      codigo: 'no_encontrada',
      sugerencias,
    });
  });

  it('ruta: geometría y métricas completas', async () => {
    const payload = {
      ruta: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[-64.267, -27.784], [-64.265, -27.782]] },
          properties: { summary: { distance: 328.6, duration: 237 } },
        }],
      },
      distancia_metros: 328.6,
      duracion_segundos: 237,
      orden: [0, 1],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
    const res = await calcularRuta({ puntos: [{ lat: -27.784, lng: -64.267 }, { lat: -27.782, lng: -64.265 }] });
    expect(res.ruta.type).toBe('FeatureCollection');
    expect(res.ruta.features[0].geometry.coordinates).toHaveLength(2);
    expect(res.distancia_metros).toBe(328.6);
    expect(res.duracion_segundos).toBe(237);
    expect(res.orden).toEqual([0, 1]);
  });

  it('coordenadas válidas respuesta', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ lat: -27.7951, lng: -64.2615, direccion: 'Santiago del Estero', provincia: 'Santiago del Estero', departamento: 'Capital' }),
    }));
    const res = await ubicarCoordenadas(-27.7951, -64.2615);
    expect(res.lat).toBe(-27.7951);
    expect(res.provincia).toBe('Santiago del Estero');
  });

  it('422 fuera_de_rango', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 422,
      json: async () => ({ error: { codigo: 'fuera_de_rango', mensaje: 'Coordenadas fuera de la caja geográfica acordada para Argentina.' } }),
    }));
    await expect(ubicarCoordenadas(0, 0)).rejects.toMatchObject({ codigo: 'fuera_de_rango' });
  });

  it('502 servicio_no_disponible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 502,
      json: async () => ({ error: { codigo: 'servicio_no_disponible', mensaje: 'El servicio de georreferencia no está disponible.' } }),
    }));
    await expect(obtenerProvincias()).rejects.toMatchObject({ codigo: 'servicio_no_disponible' });
  });

  it('desconexión', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(obtenerProvincias()).rejects.toThrow('No se pudo conectar con el servidor');
  });
});
