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
  obtenerProvincias: vi.fn().mockResolvedValue(['Buenos Aires']),
  geocodificar: vi.fn(),
  ubicarCoordenadas: vi.fn(),
  calcularRuta: vi.fn(),
  buscarLugaresCercanos: vi.fn(),
}));

import { geocodificar } from '../api';
import App from '../App.jsx';
import { CLAVE_ELEMENTOS, CLAVE_CONTADOR } from '../lib/storage.js';

const CANDIDATO = {
  lat: -34.6, lng: -58.3, direccion: 'AV TEST 1', provincia: 'Buenos Aires',
  localidad: 'X', departamento: null, aproximada: true,
};

function elemento(id, nombre) {
  return {
    id, nombre, direccion: `${nombre} 100`, lat: -27.78, lng: -64.26,
    color: '#c57b57', origen: 'direccion', creadoEn: '2026-01-01T00:00:00.000Z',
  };
}

function sembrar(lista) {
  localStorage.setItem(CLAVE_ELEMENTOS, JSON.stringify(lista));
  localStorage.setItem(CLAVE_CONTADOR, String(lista.length));
}

async function buscarYSeleccionar(user) {
  // Con 200 huellas en pantalla, escribir tecla por tecla re-renderiza la lista
  // completa; `fireEvent.change` dispara un solo evento por campo.
  fireEvent.change(screen.getByLabelText('Calle'), { target: { value: 'Test' } });
  fireEvent.change(screen.getByLabelText('Altura'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Ciudad'), { target: { value: 'Ciudad' } });
  fireEvent.change(screen.getByLabelText('Provincia'), { target: { value: 'Buenos Aires' } });
  await user.click(screen.getByRole('button', { name: 'Buscar' }));
  await user.click(await screen.findByRole('checkbox'));
}

describe('App diálogos modales', () => {
  beforeEach(() => {
    localStorage.clear();
    geocodificar.mockReset().mockResolvedValue([CANDIDATO]);
  });

  it('pide confirmación en un modal antes de quitar todas las huellas', async () => {
    sembrar([elemento('a', 'Casa'), elemento('b', 'Trabajo')]);
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Casa')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Quitar todos' }));

    const dialogo = await screen.findByRole('dialog', { name: 'Quitar todas las huellas' });
    expect(dialogo).toHaveTextContent('2 huellas');
    expect(dialogo).toHaveTextContent('no se puede deshacer');

    // Cancelar no borra nada.
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Casa')).toBeInTheDocument();
    expect(screen.getByText('Trabajo')).toBeInTheDocument();

    // Confirmar sí.
    await user.click(screen.getByRole('button', { name: 'Quitar todos' }));
    await screen.findByRole('dialog', { name: 'Quitar todas las huellas' });
    await user.click(screen.getByRole('button', { name: 'Quitar todas' }));

    await waitFor(() => expect(screen.queryByText('Casa')).not.toBeInTheDocument());
    expect(screen.queryByText('Trabajo')).not.toBeInTheDocument();
  });

  it('pide confirmación antes de eliminar una huella suelta', async () => {
    sembrar([elemento('a', 'Casa'), elemento('b', 'Trabajo')]);
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Casa')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Eliminar Casa' }));

    const dialogo = await screen.findByRole('dialog', { name: 'Quitar huella' });
    expect(dialogo).toHaveTextContent('«Casa»');

    await user.click(screen.getByRole('button', { name: 'Quitar' }));
    await waitFor(() => expect(screen.queryByText('Casa')).not.toBeInTheDocument());
    expect(screen.getByText('Trabajo')).toBeInTheDocument();
  });

  it('avisa con un modal cuando se alcanza el límite de 200 huellas', async () => {
    const muchos = Array.from({ length: 200 }, (_, i) => elemento(`e${i}`, `Punto ${i + 1}`));
    sembrar(muchos);
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Punto 1')).toBeInTheDocument());
    await buscarYSeleccionar(user);
    await user.click(screen.getByRole('button', { name: 'Agregar seleccionados' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Límite de huellas alcanzado' });
    expect(dialogo).toHaveTextContent('Se agregaron 0 de 1');
    expect(dialogo).toHaveTextContent('200 huellas');

    await user.click(screen.getByRole('button', { name: 'Entendido' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  }, 30000);

  it('no usa diálogos nativos del navegador', async () => {
    const confirmarNativo = vi.spyOn(window, 'confirm').mockImplementation(() => true);
    const alertaNativa = vi.spyOn(window, 'alert').mockImplementation(() => {});
    sembrar([elemento('a', 'Casa')]);
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Casa')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Quitar todos' }));
    await screen.findByRole('dialog', { name: 'Quitar todas las huellas' });
    await user.click(screen.getByRole('button', { name: 'Quitar todas' }));

    expect(confirmarNativo).not.toHaveBeenCalled();
    expect(alertaNativa).not.toHaveBeenCalled();
    confirmarNativo.mockRestore();
    alertaNativa.mockRestore();
  });
});
