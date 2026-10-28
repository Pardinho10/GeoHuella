import { describe, it, expect, beforeEach, vi } from 'vitest';
import { obtenerProvincias, geocodificar, ubicarCoordenadas } from '../api/client.js';

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

  it('fallo de conexión lanza error amigable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(obtenerProvincias()).rejects.toThrow('No se pudo conectar con el servidor');
  });
});
