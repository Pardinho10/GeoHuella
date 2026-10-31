import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock de MapLibre que expone la pintura de cada capa para poder auditarla.
vi.mock('@vis.gl/react-maplibre', () => ({
  Map: ({ children }) => <div data-testid="map">{children}</div>,
  Marker: () => null,
  Popup: () => null,
  NavigationControl: () => null,
  Source: ({ children }) => <div>{children}</div>,
  Layer: ({ id, paint }) => (
    <div
      data-testid="capa-ruta"
      data-capa={id}
      data-color={paint['line-color']}
      data-ancho={String(paint['line-width'])}
      data-desplazamiento={paint['line-offset'] === undefined ? '' : String(paint['line-offset'])}
      data-guion={Array.isArray(paint['line-dasharray']) ? paint['line-dasharray'].join('-') : ''}
    />
  ),
  useMap: () => ({
    current: { flyTo: vi.fn(), fitBounds: vi.fn(), getZoom: () => 12 },
  }),
}));

import Mapa from '../components/Mapa.jsx';
import { TRAMOS_RUTA } from '../lib/ruta.js';

const RUTA_VUELTA = {
  volverInicio: true,
  ruta: {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { way_points: [0, 2] },
      geometry: {
        type: 'LineString',
        coordinates: [[-64.267, -27.784], [-64.265, -27.782], [-64.267, -27.784]],
      },
    }],
  },
};

const RUTA_SENCILLA = {
  volverInicio: false,
  ruta: {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[-64.267, -27.784], [-64.265, -27.782]] },
    }],
  },
};

function props(extra = {}) {
  return {
    elementos: [],
    candidatos: [],
    sugerencias: [],
    seleccionados: new Set(),
    sugerenciasSeleccionadas: new Set(),
    popup: null,
    setPopup: vi.fn(),
    foco: null,
    fitAll: 0,
    ruta: null,
    fitRuta: 0,
    lugares: [],
    origenLugares: null,
    lugarActivo: null,
    onSeleccionarLugar: vi.fn(),
    onToggleSeleccionado: vi.fn(),
    onToggleSugerencia: vi.fn(),
    onFoco: vi.fn(),
    ...extra,
  };
}

function capas() {
  return Object.fromEntries(
    screen.getAllByTestId('capa-ruta').map((el) => [el.dataset.capa, el.dataset]),
  );
}

describe('capas de ruta en el mapa', () => {
  it('dibuja ida y regreso con color, trama, grosor y desplazamiento distintos', () => {
    render(<Mapa {...props({ ruta: RUTA_VUELTA })} />);

    const porId = capas();
    expect(Object.keys(porId).sort()).toEqual([
      'ruta-ida', 'ruta-ida-borde', 'ruta-regreso', 'ruta-regreso-borde',
    ]);

    // Colores distintos (ida cálida de la paleta, regreso acero).
    expect(porId['ruta-ida'].color).toBe(TRAMOS_RUTA.ida.color);
    expect(porId['ruta-regreso'].color).toBe(TRAMOS_RUTA.regreso.color);
    expect(porId['ruta-ida'].color).not.toBe(porId['ruta-regreso'].color);

    // La ida es continua y el regreso discontinuo; los halos son continuos.
    expect(porId['ruta-ida'].guion).toBe('');
    expect(porId['ruta-regreso'].guion).toBe(TRAMOS_RUTA.regreso.guion.join('-'));
    expect(porId['ruta-ida-borde'].guion).toBe('');
    expect(porId['ruta-regreso-borde'].guion).toBe('');

    // Al volver por la misma calle no se tapan: la ida queda centrada y el
    // regreso corrido al costado, lejos del ancho de la ida.
    expect(Number(porId['ruta-ida'].desplazamiento)).toBe(TRAMOS_RUTA.ida.desplazamiento);
    expect(Number(porId['ruta-regreso'].desplazamiento)).toBe(TRAMOS_RUTA.regreso.desplazamiento);
    expect(Number(porId['ruta-ida'].desplazamiento)).toBe(0);
    expect(Math.abs(Number(porId['ruta-regreso'].desplazamiento)))
      .toBeGreaterThan(Number(porId['ruta-ida'].ancho) / 2 + Number(porId['ruta-regreso'].ancho) / 2);

    // La ida es más gruesa que el regreso y el halo supera al trazo.
    expect(Number(porId['ruta-ida'].ancho)).toBeGreaterThan(Number(porId['ruta-regreso'].ancho));
    expect(Number(porId['ruta-ida-borde'].ancho)).toBeGreaterThan(Number(porId['ruta-ida'].ancho));
  });

  it('sin vuelta al inicio dibuja un único trazo continuo', () => {
    render(<Mapa {...props({ ruta: RUTA_SENCILLA })} />);

    const porId = capas();
    expect(Object.keys(porId).sort()).toEqual(['ruta-ida', 'ruta-ida-borde']);
    expect(porId['ruta-ida'].guion).toBe('');
    expect(porId['ruta-ida'].color).toBe(TRAMOS_RUTA.ida.color);
  });

  it('sin ruta no dibuja capas de ruta', () => {
    render(<Mapa {...props()} />);
    expect(screen.queryAllByTestId('capa-ruta')).toHaveLength(0);
  });
});
