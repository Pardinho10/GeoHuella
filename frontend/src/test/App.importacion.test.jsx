import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@vis.gl/react-maplibre', () => ({
  Map: ({ children }) => <div data-testid="map">{children}</div>,
  Marker: ({ children }) => <div data-testid="marker">{children}</div>,
  Popup: ({ children }) => <div>{children}</div>,
  NavigationControl: () => null,
  Source: ({ children }) => <div>{children}</div>,
  Layer: () => null,
  useMap: () => ({
    current: { flyTo: vi.fn(), fitBounds: vi.fn(), getZoom: () => 4 },
  }),
}));

vi.mock('../api', () => ({
  obtenerProvincias: vi.fn().mockResolvedValue(['Santiago del Estero']),
  geocodificar: vi.fn(),
  geocodificarLote: vi.fn(),
  ubicarCoordenadas: vi.fn(),
  calcularRuta: vi.fn(),
  buscarLugaresCercanos: vi.fn(),
}));

import { geocodificarLote } from '../api';
import App from '../App.jsx';
import { CLAVE_ELEMENTOS, CLAVE_CONTADOR } from '../lib/storage.js';

function encontrada(fila, indice) {
  return {
    id: fila.id,
    estado: 'encontrada',
    candidatos: [{
      lat: -27.7 - indice / 1000,
      lng: -64.2 - indice / 1000,
      direccion: `${fila.calle.toUpperCase()} ${fila.altura}, ${fila.ciudad}, ${fila.provincia}`,
      proveedor: 'georef',
      aproximada: false,
    }],
    mensaje: null,
  };
}

beforeEach(() => {
  localStorage.clear();
  geocodificarLote.mockReset().mockImplementation(async (filas) => filas.map((f, i) => encontrada(f, i)));
});

describe('App — importación persistente', () => {
  it('agrega las huellas importadas a localStorage usando la estructura existente', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Importar')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Importar direcciones/ }));

    fireEvent.change(screen.getByLabelText('Una dirección por línea'), {
      target: { value: 'Perú 781, Santiago del Estero, Santiago del Estero\nLibertad 640, Santiago del Estero, Santiago del Estero' },
    });
    await user.click(screen.getByRole('button', { name: 'Revisar direcciones' }));

    await user.click(await screen.findByRole('button', { name: /^Geocodificar 2 direcciones/ }));
    const agregar = await screen.findByRole('button', { name: 'Agregar 2 huellas al mapa' });
    await user.click(agregar);

    expect(await screen.findByText(/Se agregaron 2 huellas/)).toBeInTheDocument();

    await waitFor(() => {
      const guardados = JSON.parse(localStorage.getItem(CLAVE_ELEMENTOS) || '[]');
      expect(guardados).toHaveLength(2);
      expect(guardados[0]).toMatchObject({
        nombre: 'Elemento 1',
        origen: 'direccion',
      });
      expect(guardados[0].lat).toBeCloseTo(-27.7, 5);
      expect(guardados[0].direccion).toContain('PERÚ 781');
      expect(guardados.every((el) => typeof el.id === 'string' && el.color)).toBe(true);
    });

    expect(JSON.parse(localStorage.getItem(CLAVE_CONTADOR))).toBe(2);

    // Las huellas quedan en la lista del mapa con su nombre automático.
    await waitFor(() => expect(screen.getAllByText('Elemento 1').length).toBeGreaterThan(0));
  });

  it('permite usar el nombre de la fila importada', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Importar')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Importar direcciones/ }));

    fireEvent.change(screen.getByLabelText('Una dirección por línea'), {
      target: { value: '[Casa de Ana] Perú 781, Santiago del Estero, Santiago del Estero' },
    });
    await user.click(screen.getByRole('button', { name: 'Revisar direcciones' }));
    await user.click(await screen.findByRole('button', { name: /^Geocodificar 1 dirección/ }));
    await user.click(await screen.findByRole('button', { name: 'Agregar 1 huella al mapa' }));

    await waitFor(() => {
      const guardados = JSON.parse(localStorage.getItem(CLAVE_ELEMENTOS) || '[]');
      expect(guardados[0].nombre).toBe('Casa de Ana');
    });
    // Un nombre explícito no consume el contador automático.
    expect(JSON.parse(localStorage.getItem(CLAVE_CONTADOR))).toBe(0);
  });

  it('el mock de la capa API permite probar el flujo end-to-end sin backend', async () => {
    vi.resetModules();
    vi.doUnmock('../api');
    const mock = await import('../api/mock.js');

    const filas = [
      { id: 'fila-1', calle: 'Perú', altura: '781', ciudad: 'Santiago del Estero', provincia: 'Santiago del Estero' },
      { id: 'fila-2', calle: 'Ambig Freed', altura: '10', ciudad: 'Santiago del Estero', provincia: 'Santiago del Estero' },
      { id: 'fila-3', calle: 'Calle Error', altura: '20', ciudad: 'Santiago del Estero', provincia: 'Santiago del Estero' },
      { id: 'fila-4', calle: 'zzz', altura: '30', ciudad: 'Santiago del Estero', provincia: 'Santiago del Estero' },
    ];

    const resultados = await mock.geocodificarLote(filas);
    expect(resultados).toHaveLength(4);
    expect(resultados.map((r) => r.estado)).toContain('error');
    expect(resultados.map((r) => r.estado)).toContain('sin_resultado');
    expect(resultados[1].candidatos.some((c) => c.aproximada)).toBe(true);

    // Determinista entre llamadas.
    const otra = await mock.geocodificarLote(filas);
    expect(otra).toEqual(resultados);

    // Rechaza lotes inválidos o mayores a 10.
    await expect(mock.geocodificarLote([])).rejects.toMatchObject({ codigo: 'solicitud_invalida' });
    const once = Array.from({ length: 11 }, (_, i) => ({ ...filas[0], id: `f-${i}` }));
    await expect(mock.geocodificarLote(once)).rejects.toMatchObject({ codigo: 'solicitud_invalida' });
  });
});
