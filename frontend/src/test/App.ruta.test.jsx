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
  buscarLugaresCercanos: vi.fn(),
}));

import { calcularRuta, buscarLugaresCercanos } from '../api';
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
    buscarLugaresCercanos.mockReset().mockResolvedValue([
      {
        id: 'bar', nombre: 'Ibra Bar', categoria: 'Bar o pub', distancia_metros: 31,
        direccion: 'Ibra Bar, Perú 780', lat: -27.7839, lng: -64.2669,
      },
    ]);
  });

  it('muestra la versión de la aplicación', () => {
    render(<App />);
    expect(screen.getByText('v0.2.0')).toBeInTheDocument();
  });

  it('permite editar el nombre de una huella', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Casa')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Editar Casa' }));
    const input = screen.getByLabelText('Nombre de Casa');
    await user.clear(input);
    await user.type(input, 'Casa nueva');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Casa nueva')).toBeInTheDocument();
  });

  it('valida que el nombre editado no quede vacío', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Casa')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Editar Casa' }));
    await user.clear(screen.getByLabelText('Nombre de Casa'));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('El nombre no puede estar vacío.');
  });

  it('permite reordenar huellas', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Casa')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Bajar Casa' }));

    const labels = screen.getAllByRole('button', { name: /^Centrar mapa en / })
      .map((button) => button.getAttribute('aria-label'));
    expect(labels).toEqual(['Centrar mapa en Trabajo', 'Centrar mapa en Casa']);
  });

  it('filtra huellas por nombre o dirección', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Casa')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Filtrar huellas'), 'trabajo');

    expect(screen.getByRole('button', { name: 'Centrar mapa en Trabajo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Centrar mapa en Casa' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Limpiar filtro' }));
    expect(await screen.findByRole('button', { name: 'Centrar mapa en Casa' })).toBeInTheDocument();
  });

  it('muestra lugares cercanos de una huella', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Casa')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Ver lugares cerca de Casa' }));

    await waitFor(() => {
      expect(buscarLugaresCercanos).toHaveBeenCalledWith(-27.784, -64.267, 5);
    });
    expect((await screen.findAllByText('Ibra Bar')).length).toBeGreaterThan(0);
    expect(screen.getByText('Bar o pub')).toBeInTheDocument();
    expect(screen.getByText('31 m')).toBeInTheDocument();

    const marcador = screen.getByRole('button', { name: 'Ver Ibra Bar en el mapa' });
    expect(marcador).toBeInTheDocument();
    await user.click(marcador);
    expect(await screen.findByText('Lugar cercano')).toBeInTheDocument();
    expect(screen.getByText('Bar o pub · 31 m')).toBeInTheDocument();
    expect(screen.getAllByText('Ibra Bar, Perú 780').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Cerrar lugares cercanos' }));
    expect(screen.queryByText('Ibra Bar')).not.toBeInTheDocument();
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
    expect(screen.getAllByTestId('route-source').length).toBeGreaterThan(0);
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
    expect(screen.queryAllByTestId('route-source')).toHaveLength(0);
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

  it('permite elegir el punto final', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Casa')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Armar ruta entre huellas' }));
    await user.click(screen.getByRole('checkbox', { name: 'Incluir Casa en la ruta' }));
    await user.click(screen.getByRole('checkbox', { name: 'Incluir Trabajo en la ruta' }));

    await user.selectOptions(await screen.findByLabelText('Punto de inicio'), 'b');
    await user.selectOptions(await screen.findByLabelText('Punto final'), 'a');
    await user.click(screen.getByRole('button', { name: 'Trazar ruta' }));

    await waitFor(() => {
      expect(calcularRuta).toHaveBeenCalledWith({
        puntos: [{ lat: -27.782, lng: -64.265 }, { lat: -27.784, lng: -64.267 }],
        perfil: 'walking',
        volver_al_inicio: false,
        optimizar: false,
        fin: 1,
      });
    });
    expect(await screen.findByText(/inicio: Trabajo/)).toBeInTheDocument();
    expect(screen.getByText(/fin: Casa/)).toBeInTheDocument();
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
    expect(screen.getByText('Regreso')).toBeInTheDocument();
  });
});
