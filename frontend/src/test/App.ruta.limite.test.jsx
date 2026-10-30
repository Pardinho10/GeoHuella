import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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
  geocodificarLote: vi.fn(),
  ubicarCoordenadas: vi.fn(),
  calcularRuta: vi.fn(),
  buscarLugaresCercanos: vi.fn(),
}));

import { calcularRuta, geocodificarLote } from '../api';
import App from '../App.jsx';
import { CLAVE_ELEMENTOS } from '../lib/storage.js';
import { MAX_PUNTOS_RUTA } from '../lib/ruta.js';

function elementosDe(cantidad) {
  return Array.from({ length: cantidad }, (_, i) => ({
    id: `e${i + 1}`,
    nombre: `Huella ${i + 1}`,
    direccion: `Calle ${i + 1} 100`,
    lat: Number((-27.78 - i * 0.001).toFixed(6)),
    lng: Number((-64.26 - i * 0.001).toFixed(6)),
    color: '#c57b57',
    origen: 'direccion',
    creadoEn: '2026-01-01T00:00:00.000Z',
  }));
}

const RUTA = {
  ruta: {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[-64.26, -27.78], [-64.261, -27.781]] },
      properties: { summary: { distance: 328.6, duration: 237 } },
    }],
  },
  distancia_metros: 328.6,
  duracion_segundos: 237,
  orden: [0, 1],
};

function guardarElementos(cantidad) {
  localStorage.setItem(CLAVE_ELEMENTOS, JSON.stringify(elementosDe(cantidad)));
}

async function abrirRuta(user) {
  await user.click(await screen.findByRole('button', { name: 'Armar ruta entre huellas' }));
  await screen.findByLabelText('Medio de transporte');
}

function checksRuta() {
  return screen.getAllByRole('checkbox', { name: /^Incluir Huella \d+ en la ruta$/ });
}

beforeEach(() => {
  localStorage.clear();
  calcularRuta.mockReset().mockResolvedValue(RUTA);
  geocodificarLote.mockReset();
});

describe('App — límite de 20 huellas en la ruta', () => {
  it('avisa con cifras cuando la lista supera el máximo', async () => {
    guardarElementos(25);
    const user = userEvent.setup();
    render(<App />);

    await abrirRuta(user);

    const aviso = screen.getByText(/Tenés 25 huellas y la ruta admite hasta 20/);
    expect(aviso).toBeInTheDocument();
    expect(aviso).toHaveAttribute('role', 'status');
    expect(aviso).toHaveAttribute('id', 'ruta-aviso-limite');
    expect(aviso).toHaveTextContent('subconjunto');
    expect(screen.getByText('0 de 20')).toBeInTheDocument();
  });

  it('no avisa cuando la lista entra en el máximo, ni al seleccionar todas', async () => {
    guardarElementos(12);
    const user = userEvent.setup();
    render(<App />);

    await abrirRuta(user);
    expect(screen.queryByText(/admite hasta 20/)).not.toBeInTheDocument();

    for (const check of checksRuta()) {
      await user.click(check);
    }

    expect(screen.getByText('12 de 20')).toBeInTheDocument();
    expect(screen.queryByText(/Seleccionaste el máximo/)).not.toBeInTheDocument();
    expect(checksRuta().every((check) => !check.disabled)).toBe(true);
  });

  it('con exactamente 20 huellas no hay aviso de excedente ni de tope', async () => {
    guardarElementos(MAX_PUNTOS_RUTA);
    const user = userEvent.setup();
    render(<App />);

    await abrirRuta(user);
    expect(screen.queryByText(/admite hasta 20/)).not.toBeInTheDocument();

    for (const check of checksRuta()) {
      await user.click(check);
    }

    expect(screen.getByText('20 de 20')).toBeInTheDocument();
    expect(screen.queryByText(/Seleccionaste el máximo/)).not.toBeInTheDocument();
    expect(screen.queryByText(/máximo alcanzado/)).not.toBeInTheDocument();
  });

  it('la selección se detiene en 20 y explica cómo seguir', async () => {
    guardarElementos(25);
    const user = userEvent.setup();
    render(<App />);

    await abrirRuta(user);

    const botones = checksRuta();
    for (let i = 0; i < MAX_PUNTOS_RUTA; i += 1) {
      await user.click(botones[i]);
    }

    expect(screen.getByText('20 de 20 · máximo alcanzado')).toBeInTheDocument();
    const avisoMaximo = screen.getByText(/Seleccionaste el máximo de 20 huellas/);
    expect(avisoMaximo).toHaveAttribute('id', 'ruta-aviso-maximo');
    expect(avisoMaximo).toHaveTextContent('desmarcá una de las elegidas');

    const restantes = checksRuta().slice(MAX_PUNTOS_RUTA);
    expect(restantes).toHaveLength(5);
    expect(restantes.every((check) => check.disabled)).toBe(true);
    expect(restantes[0]).toHaveAttribute('aria-describedby', 'ruta-aviso-maximo');
    expect(restantes[0]).toHaveAttribute('title', expect.stringContaining('Máximo de 20'));

    // El botón de la fila tampoco suma una huella 21.
    await user.click(screen.getByRole('button', { name: 'Seleccionar Huella 21 para la ruta' }));
    expect(screen.getByText('20 de 20 · máximo alcanzado')).toBeInTheDocument();

    // Se puede trazar con las 20 elegidas.
    await user.click(screen.getByRole('button', { name: 'Trazar ruta' }));
    await waitFor(() => expect(calcularRuta).toHaveBeenCalledTimes(1));
    expect(calcularRuta.mock.calls[0][0].puntos).toHaveLength(20);
    expect(await screen.findByText(/Ruta activa · Caminando/)).toBeInTheDocument();
  });

  it('desmarcar una huella libera el cupo para incluir otra', async () => {
    guardarElementos(21);
    const user = userEvent.setup();
    render(<App />);

    await abrirRuta(user);
    const iniciales = checksRuta();
    for (let i = 0; i < MAX_PUNTOS_RUTA; i += 1) {
      await user.click(iniciales[i]);
    }
    expect(checksRuta()[20].disabled).toBe(true);

    await user.click(checksRuta()[0]);

    expect(screen.getByText('19 de 20')).toBeInTheDocument();
    expect(screen.queryByText(/Seleccionaste el máximo/)).not.toBeInTheDocument();
    const ultima = checksRuta()[20];
    expect(ultima.disabled).toBe(false);
    await user.click(ultima);
    expect(screen.getByText('20 de 20 · máximo alcanzado')).toBeInTheDocument();
  });

  it('el filtro no altera el total ni el límite y el aviso lo informa', async () => {
    guardarElementos(25);
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText('Filtrar huellas'), 'Huella 2');
    expect(screen.getByText('7 de 25 huellas')).toBeInTheDocument();

    await abrirRuta(user);

    const aviso = screen.getByText(/admite hasta 20/);
    expect(aviso).toHaveTextContent('El filtro muestra 7 de 25.');
    expect(checksRuta()).toHaveLength(7);

    for (const check of checksRuta()) {
      await user.click(check);
    }
    expect(screen.getByText('7 de 20')).toBeInTheDocument();
    expect(screen.queryByText(/Seleccionaste el máximo/)).not.toBeInTheDocument();

    // Al limpiar el filtro reaparecen todas; la selección se conserva.
    await user.click(screen.getByRole('button', { name: 'Limpiar filtro' }));
    expect(checksRuta()).toHaveLength(25);
    expect(screen.getByText('7 de 20')).toBeInTheDocument();

    const nuevas = checksRuta().filter((check) => !check.checked);
    for (let i = 0; i < 13; i += 1) {
      await user.click(nuevas[i]);
    }
    expect(screen.getByText('20 de 20 · máximo alcanzado')).toBeInTheDocument();
  });

  it('permite limpiar la selección sin borrar huellas', async () => {
    guardarElementos(5);
    const user = userEvent.setup();
    render(<App />);

    await abrirRuta(user);
    const checks = checksRuta();
    await user.click(checks[0]);
    await user.click(checks[1]);
    await user.click(checks[2]);
    expect(screen.getByText('3 de 20')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Limpiar selección de la ruta' }));

    expect(screen.getByText('0 de 20')).toBeInTheDocument();
    expect(checksRuta().every((check) => !check.checked)).toBe(true);
    expect(screen.getByRole('button', { name: 'Seleccionar Huella 1 para la ruta' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(CLAVE_ELEMENTOS))).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Trazar ruta' })).toBeDisabled();
  });

  it('las huellas importadas entran al flujo de ruta existente', async () => {
    const user = userEvent.setup();
    geocodificarLote.mockImplementation(async (filas) => filas.map((fila, indice) => ({
      id: fila.id,
      estado: 'encontrada',
      candidatos: [{
        lat: -27.7 - indice / 1000,
        lng: -64.2 - indice / 1000,
        direccion: `${fila.calle.toUpperCase()} ${fila.altura}, ${fila.ciudad}`,
        aproximada: false,
      }],
      mensaje: null,
    })));

    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Importar direcciones/ }));
    fireEvent.change(screen.getByLabelText('Una dirección por línea'), {
      target: { value: 'Perú 781, Santiago del Estero, Santiago del Estero\nLibertad 640, Santiago del Estero, Santiago del Estero' },
    });
    await user.click(screen.getByRole('button', { name: 'Revisar direcciones' }));
    await user.click(await screen.findByRole('button', { name: /^Geocodificar 2 direcciones/ }));
    await user.click(await screen.findByRole('button', { name: 'Agregar 2 huellas al mapa' }));

    const dialogo = screen.getByRole('dialog', { name: 'Importar direcciones' });
    await user.click(within(dialogo).getByRole('button', { name: 'Cerrar' }));

    await abrirRuta(user);
    await user.click(screen.getByRole('checkbox', { name: 'Incluir Elemento 1 en la ruta' }));
    await user.click(screen.getByRole('checkbox', { name: 'Incluir Elemento 2 en la ruta' }));
    await user.click(screen.getByRole('button', { name: 'Trazar ruta' }));

    await waitFor(() => expect(calcularRuta).toHaveBeenCalledTimes(1));
    const [primero, segundo] = calcularRuta.mock.calls[0][0].puntos;
    expect(primero.lat).toBeCloseTo(-27.7, 6);
    expect(primero.lng).toBeCloseTo(-64.2, 6);
    expect(segundo.lat).toBeCloseTo(-27.701, 6);
    expect(segundo.lng).toBeCloseTo(-64.201, 6);
    expect(await screen.findByText(/Ruta activa · Caminando/)).toBeInTheDocument();
    // Sin aviso de límite: solo hay 2 huellas importadas.
    expect(screen.queryByText(/admite hasta 20/)).not.toBeInTheDocument();
  });
});
