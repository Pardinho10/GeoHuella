import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

import { calcularRuta } from '../api';
import App from '../App.jsx';
import { CLAVE_ELEMENTOS } from '../lib/storage.js';

const A = [-64.27, -27.79];
const B = [-64.26, -27.78];
const C = [-64.25, -27.77];

const ELEMENTOS = [
  {
    id: 'a', nombre: 'Casa', direccion: 'Perú 781', lat: A[1], lng: A[0],
    color: '#c57b57', origen: 'direccion', creadoEn: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'b', nombre: 'Trabajo', direccion: 'Perú 782', lat: B[1], lng: B[0],
    color: '#f1ab86', origen: 'direccion', creadoEn: '2026-01-01T00:00:00.000Z',
  },
];

function respuestaRuta({ coordenadas, wayPoints = null, volverInicio = false, distancia = 1500 }) {
  return {
    ruta: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coordenadas },
        properties: {
          summary: { distance: distancia, duration: 1200 },
          ...(wayPoints ? { way_points: wayPoints } : {}),
        },
      }],
    },
    distancia_metros: distancia,
    duracion_segundos: 1200,
    orden: coordenadas.map((_, i) => i),
    volverInicio,
  };
}

const RUTA_IDA = respuestaRuta({ coordenadas: [A, B, C] });
const RUTA_VUELTA = respuestaRuta({
  coordenadas: [A, B, C, B, A],
  wayPoints: [0, 2, 4],
  volverInicio: true,
  distancia: 3000,
});

function stubMotion(reduce) {
  vi.stubGlobal('matchMedia', vi.fn((query) => ({
    matches: query.includes('reduce') ? reduce : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

async function seleccionarElementos(click, { perfil, volverInicio, usarFind = true } = {}) {
  const botonRuta = usarFind
    ? await screen.findByRole('button', { name: 'Armar ruta entre huellas' })
    : screen.getByRole('button', { name: 'Armar ruta entre huellas' });
  await click(botonRuta);
  if (perfil) await click(screen.getByRole('button', { name: perfil }));
  if (volverInicio) await click(screen.getByRole('checkbox', { name: 'Volver al inicio' }));
  await click(screen.getByRole('checkbox', { name: 'Incluir Casa en la ruta' }));
  await click(screen.getByRole('checkbox', { name: 'Incluir Trabajo en la ruta' }));
  await click(screen.getByRole('button', { name: 'Trazar ruta' }));
}

/** Traza una ruta con temporizadores reales (sin auto-play). */
async function trazar(user, opciones = {}) {
  render(<App />);
  await waitFor(() => expect(screen.getByText('Casa')).toBeInTheDocument());
  await seleccionarElementos((el) => user.click(el), opciones);
  return screen.findByTestId('recorrido-marca');
}

/** Traza una ruta con temporizadores falsos usando fireEvent (sin esperas). */
async function trazarConTimersFalsos(opciones = {}) {
  render(<App />);
  await act(async () => { await Promise.resolve(); });
  await seleccionarElementos((el) => fireEvent.click(el), { ...opciones, usarFind: false });
  await act(async () => { await Promise.resolve(); });
}

function marca() {
  return screen.getByTestId('recorrido-marca');
}

function progreso() {
  return Number(screen.getByRole('progressbar', { name: 'Progreso del recorrido' }).getAttribute('aria-valuenow'));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(CLAVE_ELEMENTOS, JSON.stringify(ELEMENTOS));
  calcularRuta.mockReset().mockResolvedValue(RUTA_IDA);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('App — recorrido animado: preferencia de movimiento', () => {
  it('con movimiento reducido no auto-reproduce y ofrece pasos manuales', async () => {
    // jsdom no expone matchMedia: se asume movimiento reducido.
    const user = userEvent.setup();
    await trazar(user);

    expect(screen.getByRole('group', { name: 'Animación del recorrido' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reproducir recorrido' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pausar recorrido' })).not.toBeInTheDocument();
    expect(screen.getByText(/Movimiento reducido activo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paso adelante' })).toBeInTheDocument();
    expect(progreso()).toBe(0);

    for (let i = 0; i < 5; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Paso adelante' }));
    }
    expect(progreso()).toBe(25);

    await user.click(screen.getByRole('button', { name: 'Paso atrás' }));
    expect(progreso()).toBe(20);

    await user.click(screen.getByRole('button', { name: 'Reiniciar recorrido' }));
    expect(progreso()).toBe(0);
    expect(marca().getAttribute('data-lat')).toBe(A[1].toFixed(6));
  });

  it('muestra un único ícono del perfil elegido y lo orienta con el rumbo', async () => {
    const user = userEvent.setup();
    await trazar(user);

    expect(screen.getAllByTestId('recorrido-marca')).toHaveLength(1);
    expect(marca()).toHaveAttribute('data-perfil', 'walking');
    // El caminante no se rota (se dibuja de perfil).
    expect(marca().querySelector('.recorrido-marca-icono').getAttribute('style')).toBeNull();
    expect(marca().querySelector('[data-icono-perfil="walking"]')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Quitar ruta' }));
    expect(screen.queryByTestId('recorrido-marca')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Animación del recorrido' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Armar ruta entre huellas' }));
    await user.click(screen.getByRole('button', { name: 'Auto' }));
    await user.click(screen.getByRole('checkbox', { name: 'Incluir Casa en la ruta' }));
    await user.click(screen.getByRole('checkbox', { name: 'Incluir Trabajo en la ruta' }));
    await user.click(screen.getByRole('button', { name: 'Trazar ruta' }));

    await screen.findByTestId('recorrido-marca');
    expect(marca()).toHaveAttribute('data-perfil', 'driving');
    expect(marca().querySelector('[data-icono-perfil="driving"]')).not.toBeNull();
    // Auto y bici se rotan hacia el sentido de avance de la geometría.
    expect(marca().querySelector('.recorrido-marca-icono').getAttribute('style')).toContain('rotate(');
    expect(screen.getAllByTestId('recorrido-marca')).toHaveLength(1);
  });
});

describe('App — recorrido animado: reproducción', () => {
  it('auto-reproduce, pausa, reanuda, reinicia y completa', async () => {
    stubMotion(false);
    vi.useFakeTimers();

    await trazarConTimersFalsos();

    expect(screen.getByRole('button', { name: 'Pausar recorrido' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Paso adelante' })).not.toBeInTheDocument();
    expect(progreso()).toBe(0);

    await act(async () => { vi.advanceTimersByTime(3000); });
    const avanzado = progreso();
    expect(avanzado).toBeGreaterThan(0);
    expect(marca().getAttribute('data-lat')).not.toBe(A[1].toFixed(6));

    fireEvent.click(screen.getByRole('button', { name: 'Pausar recorrido' }));
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(progreso()).toBe(avanzado);

    fireEvent.click(screen.getByRole('button', { name: 'Reproducir recorrido' }));
    await act(async () => { vi.advanceTimersByTime(4000); });
    expect(progreso()).toBeGreaterThan(avanzado);

    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar recorrido' }));
    expect(progreso()).toBe(0);
    expect(screen.getByRole('button', { name: 'Reproducir recorrido' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reproducir recorrido' }));
    await act(async () => { vi.advanceTimersByTime(120000); });

    expect(progreso()).toBe(100);
    expect(screen.getByText('Recorrido completado.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reproducir recorrido' })).toBeInTheDocument();
    expect(marca().getAttribute('data-lat')).toBe(C[1].toFixed(6));
    expect(marca().getAttribute('data-lng')).toBe(C[0].toFixed(6));
  });
});

describe('App — recorrido animado: estado final', () => {
  it('al completar queda en el punto final con aviso y botón para repetir', async () => {
    const user = userEvent.setup();
    await trazar(user);

    for (let i = 0; i < 20; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Paso adelante' }));
    }

    expect(progreso()).toBe(100);
    expect(screen.getByText('Recorrido completado.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reproducir recorrido' })).toHaveTextContent('Reproducir de nuevo');
    expect(marca().getAttribute('data-lat')).toBe(C[1].toFixed(6));
    expect(marca().getAttribute('data-lng')).toBe(C[0].toFixed(6));

    await user.click(screen.getByRole('button', { name: 'Reiniciar recorrido' }));
    expect(progreso()).toBe(0);
    expect(screen.queryByText('Recorrido completado.')).not.toBeInTheDocument();
    expect(marca().getAttribute('data-lat')).toBe(A[1].toFixed(6));
  });
});

describe('App — recorrido animado: ida y vuelta', () => {
  it('sigue primero la ida y después el regreso, sin saltos', async () => {
    calcularRuta.mockResolvedValue(RUTA_VUELTA);
    const user = userEvent.setup();
    await trazar(user, { volverInicio: true });

    const tramos = [];
    const posiciones = [];
    for (let i = 0; i < 12; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Paso adelante' }));
      tramos.push(marca().getAttribute('data-tramo'));
      posiciones.push([Number(marca().getAttribute('data-lat')), Number(marca().getAttribute('data-lng'))]);
    }

    expect(tramos[0]).toBe('ida');
    expect(tramos).toContain('regreso');
    expect(tramos[tramos.length - 1]).toBe('regreso');
    expect(posiciones[0][0]).toBeGreaterThan(A[1]);

    // Sin teletransporte: cada paso de 5 % se mueve poco en coordenadas.
    for (let i = 1; i < posiciones.length; i += 1) {
      const salto = Math.max(
        Math.abs(posiciones[i][0] - posiciones[i - 1][0]),
        Math.abs(posiciones[i][1] - posiciones[i - 1][1]),
      );
      expect(salto).toBeLessThan(0.01);
    }

    expect(calcularRuta).toHaveBeenCalledWith(expect.objectContaining({
      volver_al_inicio: true,
      puntos: [{ lat: A[1], lng: A[0] }, { lat: B[1], lng: B[0] }],
    }));
    expect(screen.getAllByTestId('recorrido-marca')).toHaveLength(1);
  });
});
