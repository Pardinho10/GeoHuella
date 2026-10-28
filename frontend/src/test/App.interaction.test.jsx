import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@vis.gl/react-maplibre', () => ({
  Map: ({ children }) => <div data-testid="map">{children}</div>,
  Marker: ({ children }) => <div data-testid="marker">{children}</div>,
  Popup: ({ children }) => <div>{children}</div>,
  NavigationControl: () => null,
  useMap: () => ({
    current: { flyTo: vi.fn(), fitBounds: vi.fn(), getZoom: () => 4 },
  }),
}));

vi.mock('../api', () => ({
  obtenerProvincias: vi.fn().mockResolvedValue(['Buenos Aires']),
  geocodificar: vi.fn().mockResolvedValue([
    { lat: -34.6, lng: -58.3, direccion: 'AV TEST 1', provincia: 'Buenos Aires', localidad: 'X', departamento: null, aproximada: true },
  ]),
  ubicarCoordenadas: vi.fn(),
}));

import { geocodificar, ubicarCoordenadas } from '../api';
import App from '../App.jsx';

describe('App interacción candidatos', () => {
  beforeEach(() => {
    localStorage.clear();
    geocodificar.mockReset().mockResolvedValue([
      { lat: -34.6, lng: -58.3, direccion: 'AV TEST 1', provincia: 'Buenos Aires', localidad: 'X', departamento: null, aproximada: true },
    ]);
    ubicarCoordenadas.mockReset().mockResolvedValue({ direccion: 'Santiago del Estero' });
  });

  it('seleccionar candidato y confirmar agrega un elemento (sin doble toggle)', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Buenos Aires')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Calle'), 'Test');
    await user.type(screen.getByLabelText('Altura'), '1');
    await user.type(screen.getByLabelText('Ciudad'), 'Ciudad');
    await user.selectOptions(screen.getByLabelText('Provincia'), 'Buenos Aires');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    const checkbox = await screen.findByRole('checkbox');
    // un solo toggle al hacer clic en el checkbox
    await user.click(checkbox);
    expect(checkbox).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Agregar seleccionados' }));

    await waitFor(() => {
      expect(screen.getAllByText('Elemento 1').length).toBeGreaterThan(0);
    });
  });

  it('muestra errores bajo los campos y no consulta con datos inválidos', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Buenos Aires')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(await screen.findByText('Ingresá la calle.')).toBeInTheDocument();
    expect(screen.getByText('Ingresá la altura.')).toBeInTheDocument();
    expect(screen.getByText('Ingresá la ciudad.')).toBeInTheDocument();
    expect(screen.getByText('Elegí una provincia.')).toBeInTheDocument();
    expect(geocodificar).not.toHaveBeenCalled();
  });

  it('muestra ubicaciones cercanas y agrega la sugerencia elegida', async () => {
    geocodificar.mockRejectedValueOnce(Object.assign(new Error('No encontramos esa altura exacta.'), {
      codigo: 'no_encontrada',
      sugerencias: [
        { lat: -27.7885, lng: -64.2621, direccion: '630, Avenida Libertad, Santiago del Estero', provincia: 'Santiago del Estero', localidad: 'Santiago del Estero', departamento: 'Capital', aproximada: true },
      ],
    }));
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Buenos Aires')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Calle'), 'Calle Libertad');
    await user.type(screen.getByLabelText('Altura'), '640');
    await user.type(screen.getByLabelText('Ciudad'), 'Santiago del Estero');
    await user.selectOptions(screen.getByLabelText('Provincia'), 'Buenos Aires');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(await screen.findByText('Ubicaciones cercanas')).toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox');
    await user.click(checkbox);
    expect(checkbox).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Agregar sugerencias' }));
    await waitFor(() => expect(screen.getAllByText('Elemento 1').length).toBeGreaterThan(0));
  });
});

describe('App interacción coordenadas', () => {
  it('usa el nombre ingresado al agregar un punto por coordenadas', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Buenos Aires')).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: 'Coordenadas' }));
    await user.type(screen.getByLabelText('Nombre opcional'), 'Punto céntrico');
    await user.type(screen.getByLabelText('Latitud'), '-27,7951');
    await user.type(screen.getByLabelText('Longitud'), '-64,2615');
    await user.click(screen.getByRole('button', { name: 'Agregar punto' }));

    expect((await screen.findAllByText('Punto céntrico')).length).toBeGreaterThan(0);
  });
});
