import { describe, it, expect, beforeEach, vi } from 'vitest';
import { obtenerProvincias, geocodificar, ubicarCoordenadas, calcularRuta } from '../api/client.js';

describe('api client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('obtenerProvincias fetch correcto', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ provincias: ['Buenos Aires', 'Córdoba'] }),
    }));
    const res = await obtenerProvincias();
    expect(res).toEqual(['Buenos Aires', 'Córdoba']);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/provincias/'), expect.any(Object));
  });

  it('geocodificar devuelve resultados', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ resultados: [{ lat: 1, lng: 2, direccion: 'X', provincia: 'P', localidad: 'L', departamento: null, aproximada: true }] }),
    }));
    const res = await geocodificar({ calle: 'A', numero: '1', ciudad: 'C', provincia: 'P' });
    expect(res).toHaveLength(1);
    expect(res[0].direccion).toBe('X');
  });

  it('ubicarCoordenadas error de contrato lanza con codigo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: { codigo: 'fuera_de_rango', mensaje: 'Coordenadas fuera de rango' } }),
    }));
    await expect(ubicarCoordenadas(0, 0)).rejects.toMatchObject({ codigo: 'fuera_de_rango' });
  });

  it('calcularRuta envía puntos y perfil y devuelve la ruta', async () => {
    const payload = {
      ruta: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] } }] },
      distancia_metros: 100,
      duracion_segundos: 60,
      orden: [0, 1],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    }));
    const res = await calcularRuta({
      puntos: [{ lat: 2, lng: 1 }, { lat: 4, lng: 3 }],
      perfil: 'driving',
      volver_al_inicio: true,
      optimizar: true,
    });
    expect(res).toEqual(payload);
    const [, options] = fetch.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({
      puntos: [{ lat: 2, lng: 1 }, { lat: 4, lng: 3 }],
      perfil: 'driving',
      volver_al_inicio: true,
      optimizar: true,
    });
  });

  it('calcularRuta envía el punto final cuando se indica', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ruta: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] } }] },
        distancia_metros: 100,
        duracion_segundos: 60,
        orden: [0, 1],
      }),
    }));
    await calcularRuta({
      puntos: [{ lat: 2, lng: 1 }, { lat: 4, lng: 3 }],
      fin: 1,
    });
    const [, options] = fetch.mock.calls[0];
    expect(JSON.parse(options.body).fin).toBe(1);
    expect(JSON.parse(options.body).optimizar).toBe(false);
  });

  it('calcularRuta propaga el error del backend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: { codigo: 'routing_no_configurado', mensaje: 'El servicio de rutas no está configurado.' } }),
    }));
    await expect(calcularRuta({ puntos: [{ lat: 2, lng: 1 }, { lat: 4, lng: 3 }] }))
      .rejects.toMatchObject({ codigo: 'routing_no_configurado' });
  });

  it('calcularRuta rechaza una respuesta sin geometría', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ruta: { type: 'FeatureCollection', features: [] } }),
    }));
    await expect(calcularRuta({ puntos: [{ lat: 2, lng: 1 }, { lat: 4, lng: 3 }] }))
      .rejects.toMatchObject({ codigo: 'ruta_invalida' });
  });

  it('fallo de conexión lanza error amigable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(obtenerProvincias()).rejects.toThrow('No se pudo conectar con el servidor');
  });
});
