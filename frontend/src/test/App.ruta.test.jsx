import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@vis.gl/react-maplibre', () => ({
  Map: ({ children }) => <div data-testid="map">{children}</div>,
  Marker: ({ children }) => <div data-testid="marker">{children}</div>,
  Popup: ({ children }) => <div>{children}</div>,
  NavigationControl: () => null,
  Source: ({ children }) => <div data-testid="route-source">{children}</div>,
  Layer: () => null,
  useMap: () => ({
    current: { flyTo: vi.fn(), fitBounds: vi.fn(), getZoom: () => 4 },
  }),
}));

vi.mock('../api', () => ({
  obtenerProvincias: vi.fn().mockResolvedValue(['Santiago del Estero']),
  geocodificar: vi.fn(),
  ubicarCoordenadas: vi.fn(),
  calcularRuta: vi.fn(),
}));

import { calcularRuta } from '../api';
import App from '../App.jsx';
import { CLAVE_ELEMENTOS } from '../lib/storage.js';

const ELEMENTOS = [
  {
    id: 'a', nombre: 'Casa', direccion: 'Perú 781', lat: -27.784, lng: -64.267,
    color: '#c57b57', origen: 'direccion', creadoEn: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'b', nombre: 'Trabajo', direccion: 'Perú 782', lat: -27.782, lng: -64.265,
    color: '#f1ab86', origen: 'direccion', creadoEn: '2026-01-01T00:00:00.000Z',
  },
];

const RUTA = {
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

describe('App rutas', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(CLAVE_ELEMENTOS, JSON.stringify(ELEMENTOS));
    calcularRuta.mockReset().mockResolvedValue(RUTA);
  });

  it('selecciona huellas, traza la ruta y muestra distancia y duración', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Casa')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Armar ruta entre huellas' }));
    await user.click(screen.getByRole('checkbox', { name: 'Incluir Casa en la ruta' }));
    await user.click(screen.getByRole('checkbox', { name: 'Incluir Trabajo en la ruta' }));
    await user.click(screen.getByRole('button', { name: 'Trazar ruta' }));

    await waitFor(() => {
      expect(calcularRuta).toHaveBeenCalledWith({
        puntos: [{ lat: -27.784, lng: -64.267 }, { lat: -27.782, lng: -64.265 }],
        perfil: 'walking',
        volver_al_inicio: false,
        optimizar: false,
      });
    });
    expect(await screen.findByText('Ruta activa · Caminando')).toBeInTheDocument();
    expect(screen.getByText('329 m')).toBeInTheDocument();
    expect(screen.getByText(/4 min · 2 huellas/)).toBeInTheDocument();
    expect(screen.getByTestId('route-source')).toBeInTheDocument();
  });

  it('usa el perfil elegido y permite quitar la ruta', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Casa')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Armar ruta entre huellas' }));
    await user.click(screen.getByRole('button', { name: 'Auto' }));
    await user.click(screen.getByRole('checkbox', { name: 'Incluir Casa en la ruta' }));
    await user.click(screen.getByRole('checkbox', { name: 'Incluir Trabajo en la ruta' }));
    await user.click(screen.getByRole('button', { name: 'Trazar ruta' }));

    await waitFor(() => expect(calcularRuta).toHaveBeenCalledWith(expect.objectContaining({ perfil: 'driving' })));
    expect(await screen.findByText('Ruta activa · Auto')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Quitar ruta' }));
    expect(screen.queryByText('Ruta activa · Auto')).not.toBeInTheDocument();
    expect(screen.queryByTestId('route-source')).not.toBeInTheDocument();
  });

  it('muestra el error del backend sin romper la lista', async () => {
    calcularRuta.mockRejectedValue(new Error('El servicio de rutas no está configurado.'));
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Casa')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Armar ruta entre huellas' }));
    await user.click(screen.getByRole('checkbox', { name: 'Incluir Casa en la ruta' }));
    await user.click(screen.getByRole('checkbox', { name: 'Incluir Trabajo en la ruta' }));
    await user.click(screen.getByRole('button', { name: 'Trazar ruta' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('El servicio de rutas no está configurado.');
    expect(screen.getAllByText('Casa').length).toBeGreaterThan(0);
  });

  it('permite elegir el punto de inicio', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Casa')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Armar ruta entre huellas' }));
    await user.click(screen.getByRole('checkbox', { name: 'Incluir Casa en la ruta' }));
    await user.click(screen.getByRole('checkbox', { name: 'Incluir Trabajo en la ruta' }));

    const selector = await screen.findByLabelText('Punto de inicio');
    await user.selectOptions(selector, 'b');
    await user.click(screen.getByRole('button', { name: 'Trazar ruta' }));

    await waitFor(() => {
      expect(calcularRuta).toHaveBeenCalledWith({
        puntos: [{ lat: -27.782, lng: -64.265 }, { lat: -27.784, lng: -64.267 }],
        perfil: 'walking',
        volver_al_inicio: false,
        optimizar: false,
      });
    });
    expect(await screen.findByText(/inicio: Trabajo/)).toBeInTheDocument();
  });

  it('permite optimizar el orden', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Casa')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Armar ruta entre huellas' }));
    await user.click(screen.getByRole('checkbox', { name: 'Optimizar orden' }));
    await user.click(screen.getByRole('checkbox', { name: 'Incluir Casa en la ruta' }));
    await user.click(screen.getByRole('checkbox', { name: 'Incluir Trabajo en la ruta' }));
    await user.click(screen.getByRole('button', { name: 'Trazar ruta' }));

    await waitFor(() => expect(calcularRuta).toHaveBeenCalledWith(expect.objectContaining({ optimizar: true })));
    expect(await screen.findByText(/orden optimizado/)).toBeInTheDocument();
  });

  it('permite volver al inicio', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Casa')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Armar ruta entre huellas' }));
    await user.click(screen.getByRole('checkbox', { name: 'Volver al inicio' }));
    await user.click(screen.getByRole('checkbox', { name: 'Incluir Casa en la ruta' }));
    await user.click(screen.getByRole('checkbox', { name: 'Incluir Trabajo en la ruta' }));
    await user.click(screen.getByRole('button', { name: 'Trazar ruta' }));

    await waitFor(() => expect(calcularRuta).toHaveBeenCalledWith(expect.objectContaining({ volver_al_inicio: true })));
    expect(await screen.findByText(/ida y vuelta/)).toBeInTheDocument();
  });
});
