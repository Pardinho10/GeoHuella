import { describe, it, expect, vi, afterEach } from 'vitest';

const FILA = {
  id: 'fila-1',
  calle: 'Perú',
  altura: '781',
  ciudad: 'Santiago del Estero',
  provincia: 'Santiago del Estero',
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('capa API — selección de mock', () => {
  it('VITE_USAR_MOCK=true enruta geocodificarLote al mock determinista', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_USAR_MOCK', 'true');
    const api = await import('../api/index.js');

    expect(api.usarMock).toBe(true);

    const resultados = await api.geocodificarLote([FILA]);
    expect(resultados).toHaveLength(1);
    expect(resultados[0].id).toBe('fila-1');
    expect(['encontrada', 'ambigua', 'sin_resultado', 'error']).toContain(resultados[0].estado);
    expect(resultados[0].candidatos.length).toBeLessThanOrEqual(5);

    const otra = await api.geocodificarLote([FILA]);
    expect(otra).toEqual(resultados);
  });

  it('VITE_USAR_MOCK=false usa el cliente real (fetch)', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_USAR_MOCK', 'false');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        resultados: [{ id: 'fila-1', estado: 'encontrada', candidatos: [], mensaje: null }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const api = await import('../api/index.js');
    expect(api.usarMock).toBe(false);

    const resultados = await api.geocodificarLote([FILA]);
    expect(resultados[0].estado).toBe('encontrada');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opciones] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/geocodificar-lote/');
    expect(opciones.method).toBe('POST');
    expect(JSON.parse(opciones.body)).toEqual({ filas: [FILA] });

    vi.unstubAllGlobals();
  });
});
