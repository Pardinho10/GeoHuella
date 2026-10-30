import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api', () => ({
  geocodificarLote: vi.fn(),
  obtenerProvincias: vi.fn().mockResolvedValue([]),
  geocodificar: vi.fn(),
  ubicarCoordenadas: vi.fn(),
  calcularRuta: vi.fn(),
  buscarLugaresCercanos: vi.fn(),
}));

import { geocodificarLote } from '../api';
import Importador from '../components/Importador.jsx';

const PROVINCIAS = ['Santiago del Estero', 'Córdoba', 'Buenos Aires'];

function encontrada(fila, extra = {}) {
  const altura = Number(fila.altura) || 0;
  return {
    id: fila.id,
    estado: 'encontrada',
    candidatos: [{
      lat: Number((-27.7 - altura / 10000).toFixed(6)),
      lng: Number((-64.2 - altura / 10000).toFixed(6)),
      nombre: `${fila.calle} ${fila.altura}`,
      direccion: `${fila.calle.toUpperCase()} ${fila.altura}, ${fila.ciudad}`,
      proveedor: 'georef',
      aproximada: false,
    }],
    mensaje: null,
    ...extra,
  };
}

function renderImportador(props = {}) {
  const onAgregar = props.onAgregar || vi.fn((items) => ({ agregados: items.length, noAgregados: 0 }));
  render(
    <Importador
      abierto
      provincias={PROVINCIAS}
      elementos={[]}
      onCerrar={() => {}}
      {...props}
      onAgregar={onAgregar}
    />,
  );
  return { onAgregar };
}

async function pegarTexto(texto) {
  fireEvent.change(screen.getByLabelText('Una dirección por línea'), { target: { value: texto } });
}

async function irARevision(user) {
  await user.click(screen.getByRole('button', { name: 'Revisar direcciones' }));
  await screen.findByRole('button', { name: /^Geocodificar \d+ direcci/ });
}

function direcciones(cantidad) {
  return Array.from({ length: cantidad }, (_, i) => (
    `Calle ${i + 1} ${100 + i}, Ciudad, Santiago del Estero`
  )).join('\n');
}

beforeEach(() => {
  geocodificarLote.mockReset();
  geocodificarLote.mockImplementation(async (filas) => filas.map((f) => encontrada(f)));
});

describe('Importador — entrada de texto', () => {
  it('detecta una dirección por línea y arma la revisión editable', async () => {
    const user = userEvent.setup();
    renderImportador();

    await pegarTexto('Perú 781, Santiago del Estero, Santiago del Estero\nLibertad 640, Santiago del Estero, Santiago del Estero');
    expect(screen.getByText('2 direcciones detectadas')).toBeInTheDocument();

    await irARevision(user);

    const calles = screen.getAllByLabelText('Calle');
    expect(calles).toHaveLength(2);
    expect(calles[0]).toHaveValue('Perú');
    expect(calles[1]).toHaveValue('Libertad');
    expect(screen.getAllByLabelText('Altura')[0]).toHaveValue('781');
    expect(screen.getAllByLabelText('Provincia')[0]).toHaveValue('Santiago del Estero');
  });

  it('rechaza más de 100 filas con un mensaje explícito', async () => {
    const user = userEvent.setup();
    renderImportador();

    fireEvent.change(screen.getByLabelText('Una dirección por línea'), { target: { value: direcciones(101) } });
    await user.click(screen.getByRole('button', { name: 'Revisar direcciones' }));

    expect(await screen.findByText(/máximo es 100 filas/)).toBeInTheDocument();
    expect(screen.queryAllByLabelText('Calle')).toHaveLength(0);
  });

  it('no inventa ciudad ni provincia y permite completarlas con los defaults', async () => {
    const user = userEvent.setup();
    renderImportador();

    await pegarTexto('Perú 781');

    // Sin defaults explícitos, la fila queda incompleta.
    await irARevision(user);
    expect(screen.getByLabelText('Ciudad')).toHaveValue('');
    expect(screen.getByLabelText('Provincia')).toHaveValue('');

    // Al volver y fijar los defaults, se aplican al crear las filas.
    await user.click(screen.getByRole('button', { name: 'Volver' }));
    await user.type(screen.getByLabelText('Ciudad por defecto'), 'Santiago del Estero');
    await user.selectOptions(screen.getByLabelText('Provincia por defecto'), 'Santiago del Estero');
    await irARevision(user);

    expect(screen.getByLabelText('Ciudad')).toHaveValue('Santiago del Estero');
    expect(screen.getByLabelText('Provincia')).toHaveValue('Santiago del Estero');
  });

  it('bloquea el inicio si quedan filas inválidas', async () => {
    const user = userEvent.setup();
    renderImportador();

    await pegarTexto('Perú 781');
    await irARevision(user);
    await user.click(screen.getByRole('button', { name: /Geocodificar 1 dirección/ }));

    expect(await screen.findByText(/Revisá la fila marcada/)).toBeInTheDocument();
    expect(geocodificarLote).not.toHaveBeenCalled();
  });
});

describe('Importador — CSV', () => {
  it('detecta encabezados, muestra el mapeo y arma filas', async () => {
    const user = userEvent.setup();
    renderImportador();

    await user.click(screen.getByRole('tab', { name: 'Subir CSV' }));
    fireEvent.change(screen.getByLabelText('O pegá el CSV'), {
      target: {
        value: '\uFEFFname,street,number,city,state\r\nCasa,Perú,781,Santiago del Estero,Santiago del Estero\r\n',
      },
    });

    const mapeo = await screen.findByRole('region', { name: 'Mapeo de columnas' });
    expect(within(mapeo).getByLabelText('Calle')).toHaveValue('1');
    expect(within(mapeo).getByLabelText('Altura')).toHaveValue('2');

    await irARevision(user);

    expect(screen.getByLabelText('Calle')).toHaveValue('Perú');
    expect(screen.getByLabelText('Nombre (opcional)')).toHaveValue('Casa');
    expect(screen.getByLabelText('Ciudad')).toHaveValue('Santiago del Estero');
  });

  it('permite corregir el mapeo de columnas a mano', async () => {
    const user = userEvent.setup();
    renderImportador();

    await user.click(screen.getByRole('tab', { name: 'Subir CSV' }));
    fireEvent.change(screen.getByLabelText('O pegá el CSV'), {
      target: {
        value: 'calle,altura,provincia,ciudad\nPerú,781,Córdoba,Córdoba\n',
      },
    });

    const mapeo = await screen.findByRole('region', { name: 'Mapeo de columnas' });
    await user.selectOptions(within(mapeo).getByLabelText('Ciudad'), '3');
    await user.selectOptions(within(mapeo).getByLabelText('Provincia'), '2');

    await irARevision(user);

    expect(screen.getByLabelText('Ciudad')).toHaveValue('Córdoba');
    expect(screen.getByLabelText('Provincia')).toHaveValue('Córdoba');
  });

  it('acepta punto y coma con comas dentro de campos entrecomillados', async () => {
    const user = userEvent.setup();
    renderImportador();

    await user.click(screen.getByRole('tab', { name: 'Subir CSV' }));
    fireEvent.change(screen.getByLabelText('O pegá el CSV'), {
      target: { value: 'calle;altura;ciudad;provincia\r\n"Perú, 781";781;"Santiago; Centro";Santiago del Estero\r\n' },
    });

    await irARevision(user);

    expect(screen.getByLabelText('Calle')).toHaveValue('Perú, 781');
    expect(screen.getByLabelText('Ciudad')).toHaveValue('Santiago; Centro');
  });
});

describe('Importador — proceso por bloques', () => {
  it('procesa en bloques de 10 con progreso y agrega solo lo seleccionado', async () => {
    const user = userEvent.setup();
    const { onAgregar } = renderImportador();

    const pendientes = [];
    geocodificarLote.mockImplementation((filas) => new Promise((resolve) => {
      pendientes.push(() => resolve(filas.map((f) => encontrada(f))));
    }));

    await pegarTexto(direcciones(12));
    await irARevision(user);
    await user.click(screen.getByRole('button', { name: /Geocodificar 12 direcciones/ }));

    const barra = await screen.findByRole('progressbar', { name: 'Progreso de la geocodificación' });
    expect(barra).toHaveAttribute('aria-valuemax', '12');
    expect(barra).toHaveAttribute('aria-valuenow', '0');

    // Un solo bloque en vuelo: nunca hay dos solicitudes abiertas.
    await waitFor(() => expect(pendientes).toHaveLength(1));
    expect(geocodificarLote.mock.calls[0][0]).toHaveLength(10);
    expect(geocodificarLote.mock.calls[0][1].signal).toBeTruthy();

    pendientes.shift()();
    await waitFor(() => expect(pendientes).toHaveLength(1));
    expect(geocodificarLote.mock.calls).toHaveLength(2);
    expect(geocodificarLote.mock.calls[1][0]).toHaveLength(2);

    pendientes.shift()();
    const boton = await screen.findByRole('button', { name: 'Agregar 12 huellas al mapa' });
    await user.click(boton);

    expect(onAgregar).toHaveBeenCalledTimes(1);
    const items = onAgregar.mock.calls[0][0];
    expect(items).toHaveLength(12);
    expect(items[0]).toMatchObject({ origen: 'direccion' });
    expect(items[0].direccion).toContain('CALLE 1');
    // Las filas agregadas se quitan de la lista para no duplicarlas.
    expect(screen.queryByRole('button', { name: /Agregar \d+ huellas al mapa/ })).toBeDisabled();
  });

  it('cancelar entre bloques conserva lo resuelto y no envía más bloques', async () => {
    const user = userEvent.setup();
    let llamadas = 0;

    geocodificarLote.mockImplementation((filas, { signal } = {}) => {
      llamadas += 1;
      if (llamadas === 1) return Promise.resolve(filas.map((f) => encontrada(f)));
      return new Promise((_, reject) => {
        signal?.addEventListener('abort', () => {
          const e = new Error('Cancelado');
          e.name = 'AbortError';
          reject(e);
        }, { once: true });
      });
    });

    renderImportador();
    await pegarTexto(direcciones(12));
    await irARevision(user);
    await user.click(screen.getByRole('button', { name: /Geocodificar 12 direcciones/ }));

    await waitFor(() => expect(llamadas).toBe(2));
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));

    expect(await screen.findByText(/Cancelaste la importación/)).toBeInTheDocument();
    expect(llamadas).toBe(2);
    expect(screen.getAllByText('Encontrada')).toHaveLength(10);
    expect(screen.getAllByText('Cancelada')).toHaveLength(2);
  });

  it('reintentar una fila no reinicia las filas ya resueltas', async () => {
    const user = userEvent.setup();
    geocodificarLote.mockImplementation(async (filas) => filas.map((f) => (
      f.altura === '101'
        ? { id: f.id, estado: 'error', candidatos: [], mensaje: 'Proveedor caído.' }
        : encontrada(f)
    )));

    renderImportador();
    await pegarTexto(direcciones(2));
    await irARevision(user);
    await user.click(screen.getByRole('button', { name: /Geocodificar 2 direcciones/ }));

    expect(await screen.findByText('Proveedor caído.')).toBeInTheDocument();
    expect(screen.getAllByText('Encontrada')).toHaveLength(1);

    geocodificarLote.mockImplementation(async (filas) => filas.map((f) => encontrada(f)));
    const botones = screen.getAllByRole('button', { name: 'Reintentar' });
    await user.click(botones[1]);

    await waitFor(() => expect(screen.getAllByText('Encontrada')).toHaveLength(2));
    const ultimaLlamada = geocodificarLote.mock.calls.at(-1)[0];
    expect(ultimaLlamada).toHaveLength(1);
    expect(ultimaLlamada[0].altura).toBe('101');
  });
});

describe('Importador — selección, duplicados y aproximados', () => {
  it('marca duplicados contra los puntos guardados y no los preselecciona', async () => {
    const user = userEvent.setup();
    const elementos = [{
      id: 'el-1',
      nombre: 'Casa',
      direccion: 'CALLE 1 100, Ciudad, Santiago del Estero',
      lat: -27.77751,
      lng: -64.26501,
      color: '#c57b57',
      origen: 'direccion',
      creadoEn: '2026-01-01T00:00:00.000Z',
    }];

    renderImportador({ elementos });
    await pegarTexto(direcciones(2));
    await irARevision(user);
    await user.click(screen.getByRole('button', { name: /Geocodificar 2 direcciones/ }));

    expect(await screen.findByText(/Duplicado:/)).toBeInTheDocument();
    const checkboxDuplicado = screen.getByRole('checkbox', { name: 'Agregar la fila 1 al mapa' });
    expect(checkboxDuplicado).not.toBeChecked();

    const sano = screen.getByRole('checkbox', { name: 'Agregar la fila 2 al mapa' });
    expect(sano).toBeChecked();
    expect(screen.getByRole('button', { name: 'Agregar 1 huella al mapa' })).toBeEnabled();
  });

  it('un candidato aproximado y una ambigua requieren elección explícita', async () => {
    const user = userEvent.setup();
    geocodificarLote.mockImplementation(async (filas) => filas.map((f) => ({
      id: f.id,
      estado: 'ambigua',
      candidatos: [
        { lat: -27.77, lng: -64.26, direccion: 'CALLE 1 100', aproximada: false },
        { lat: -27.78, lng: -64.27, direccion: 'CALLE 1 102', aproximada: true },
      ],
      mensaje: null,
    })));

    renderImportador();
    await pegarTexto(direcciones(1));
    await irARevision(user);
    await user.click(screen.getByRole('button', { name: /Geocodificar 1 dirección/ }));

    expect(await screen.findByText('Aproximada')).toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox', { name: 'Agregar la fila 1 al mapa' });
    expect(checkbox).not.toBeChecked();
    expect(screen.getAllByRole('radio').every((radio) => !radio.checked)).toBe(true);
    expect(screen.getByRole('button', { name: 'Agregar 0 huellas al mapa' })).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: /Aproximada/ }));
    expect(screen.getByRole('checkbox', { name: 'Agregar la fila 1 al mapa' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Agregar 1 huella al mapa' })).toBeEnabled();
  });

  it('permite descartar una fila y no la cuenta', async () => {
    const user = userEvent.setup();
    renderImportador();
    await pegarTexto(direcciones(2));
    await irARevision(user);
    await user.click(screen.getByRole('button', { name: /Geocodificar 2 direcciones/ }));

    await screen.findByRole('button', { name: 'Agregar 2 huellas al mapa' });
    await user.click(screen.getAllByRole('button', { name: 'Descartar' })[0]);

    expect(await screen.findByRole('button', { name: 'Agregar 1 huella al mapa' })).toBeInTheDocument();
  });

  it('permite cargar coordenadas manuales cuando no hay resultado', async () => {
    const user = userEvent.setup();
    geocodificarLote.mockImplementation(async (filas) => filas.map((f) => ({
      id: f.id, estado: 'sin_resultado', candidatos: [], mensaje: null,
    })));

    renderImportador();
    await pegarTexto(direcciones(1));
    await irARevision(user);
    await user.click(screen.getByRole('button', { name: /Geocodificar 1 dirección/ }));

    expect(await screen.findByText('Sin resultado')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Coordenadas' }));
    await user.type(screen.getByLabelText('Latitud'), '-27,7951');
    await user.type(screen.getByLabelText('Longitud'), '-64,2615');
    await user.click(screen.getByRole('button', { name: 'Usar coordenadas' }));

    expect(await screen.findByRole('button', { name: 'Agregar 1 huella al mapa' })).toBeEnabled();
  });

  it('al cerrar durante un lote cancela y espera el resultado antes de desmontar', async () => {
    const user = userEvent.setup();
    const onCerrar = vi.fn();
    let rechazar;
    geocodificarLote.mockImplementation((_, { signal } = {}) => new Promise((_, reject) => {
      rechazar = reject;
      signal?.addEventListener('abort', () => {
        const error = new Error('Cancelado');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }));
    renderImportador({ onCerrar });
    await pegarTexto(direcciones(1));
    await irARevision(user);
    await user.click(screen.getByRole('button', { name: /Geocodificar 1 dirección/ }));
    await waitFor(() => expect(rechazar).toBeTypeOf('function'));

    await user.click(screen.getByRole('button', { name: 'Cerrar importación' }));
    expect(onCerrar).not.toHaveBeenCalled();
    expect(await screen.findByText(/Cancelaste la importación/)).toBeInTheDocument();
    expect(onCerrar).not.toHaveBeenCalled();
  });

  it('cierra el diálogo con el botón de cerrar cuando no hay proceso activo', async () => {
    const user = userEvent.setup();
    const onCerrar = vi.fn();
    renderImportador({ onCerrar });

    await user.click(screen.getByRole('button', { name: 'Cerrar importación' }));
    expect(onCerrar).toHaveBeenCalled();
  });
});
