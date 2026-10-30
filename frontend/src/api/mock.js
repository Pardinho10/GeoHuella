const PROVINCIAS = [
  'Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes',
  'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza',
  'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis',
  'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego',
  'Tucumán', 'Ciudad Autónoma de Buenos Aires',
];

/** Error con la misma forma que los del cliente real. */
function errorMock(mensaje, codigo) {
  const e = new Error(mensaje);
  e.codigo = codigo;
  return e;
}

function normalizarClave(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Hash FNV-1a: resultados deterministas para el mismo texto. */
function hash(texto) {
  let h = 2166136261;
  const t = String(texto || '');
  for (let i = 0; i < t.length; i += 1) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function coordenadasMock(clave) {
  const h = hash(clave);
  const lat = -27.79 + ((h % 900) / 1000) * 0.02;
  const lng = -64.27 + (((h >>> 11) % 900) / 1000) * 0.02;
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
}

function esperar(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const e = new Error('Cancelado');
      e.name = 'AbortError';
      reject(e);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', alAbortar);
      resolve();
    }, ms);
    function alAbortar() {
      clearTimeout(timer);
      const e = new Error('Cancelado');
      e.name = 'AbortError';
      reject(e);
    }
    signal?.addEventListener?.('abort', alAbortar, { once: true });
  });
}

function candidatoMock(fila, { aproximada = false, delta = 0, salt = '' } = {}) {
  const altura = String(Number(fila.altura) + delta);
  const clave = `${normalizarClave(fila.calle)} ${altura} ${normalizarClave(fila.ciudad)}${salt}`;
  const { lat, lng } = coordenadasMock(clave);
  return {
    lat,
    lng,
    nombre: `${fila.calle} ${altura}`,
    direccion: `${String(fila.calle).toUpperCase()} ${altura}, ${fila.ciudad}, ${fila.provincia}`,
    proveedor: 'georef',
    aproximada,
  };
}

/**
 * Mock determinista de `POST /api/geocodificar-lote/`.
 * Marcadores para pruebas end-to-end sin backend:
 * - calle con "ambig": un candidato exacto + uno aproximado.
 * - calle con "error": estado `error` aislado.
 * - calle con "sinresultado" o "zzz": `sin_resultado`.
 * - resto: `encontrada` (o `ambigua` según hash, para cubrir el caso).
 */
function resultadoLoteMock(fila) {
  const clave = normalizarClave(`${fila.calle} ${fila.altura} ${fila.ciudad} ${fila.provincia}`);

  if (/\berror\b/.test(clave)) {
    return { id: fila.id, estado: 'error', candidatos: [], mensaje: 'El proveedor no respondió (mock).' };
  }

  if (/sinresultado|sin resultado|\bzzz\b/.test(clave)) {
    return { id: fila.id, estado: 'sin_resultado', candidatos: [], mensaje: null };
  }

  if (/\bambig/.test(clave)) {
    return {
      id: fila.id,
      estado: 'ambigua',
      candidatos: [
        candidatoMock(fila),
        candidatoMock(fila, { aproximada: true, delta: 2 }),
      ],
      mensaje: null,
    };
  }

  const variante = hash(clave) % 3;
  if (variante === 0) {
    return {
      id: fila.id,
      estado: 'ambigua',
      candidatos: [candidatoMock(fila), candidatoMock(fila, { delta: 0, salt: 'b' })],
      mensaje: null,
    };
  }
  if (variante === 1) {
    return {
      id: fila.id,
      estado: 'ambigua',
      candidatos: [
        candidatoMock(fila),
        candidatoMock(fila, { aproximada: true, delta: 5 }),
      ],
      mensaje: null,
    };
  }

  return { id: fila.id, estado: 'encontrada', candidatos: [candidatoMock(fila)], mensaje: null };
}

export async function geocodificarLote(filas, { signal } = {}) {
  const lista = Array.isArray(filas) ? filas : [];
  if (lista.length === 0) throw errorMock('Enviá al menos una fila.', 'solicitud_invalida');
  if (lista.length > 10) throw errorMock('El lote admite hasta 10 filas.', 'solicitud_invalida');

  for (const fila of lista) {
    if (!fila || !fila.id || !fila.calle || !fila.altura || !fila.ciudad || !fila.provincia) {
      throw errorMock('Revisá los campos indicados.', 'solicitud_invalida');
    }
  }

  // Deja respirar a la UI entre bloques y respeta la cancelación.
  await esperar(0, signal);

  return lista.map(resultadoLoteMock);
}

export async function obtenerProvincias() {
  return [...PROVINCIAS].sort((a, b) => a.localeCompare(b, 'es'));
}

export async function geocodificar(direccion) {
  const { calle = '', numero = '', ciudad = '', provincia = '' } = direccion || {};
  if (!calle || !numero || !ciudad || !provincia) {
    const e = new Error('Revisá los campos indicados.');
    e.codigo = 'solicitud_invalida';
    throw e;
  }
  // Mock candidate
  return [
    {
      lat: -34.603669473,
      lng: -58.380975283,
      direccion: `${String(calle).toUpperCase()} ${numero}, ${ciudad}, ${provincia}`.trim(),
      provincia,
      localidad: ciudad,
      departamento: null,
      aproximada: true,
    },
  ];
}

export async function ubicarCoordenadas(lat, lng) {
  return {
    lat,
    lng,
    direccion: 'Sin dirección disponible (mock)',
    provincia: null,
    departamento: null,
  };
}


export async function calcularRuta({ puntos = [], perfil = 'walking', volver_al_inicio = false, optimizar = false, fin = null } = {}) {
  const coords = puntos.map((p) => [p.lng, p.lat]);
  if (volver_al_inicio && coords.length > 0) coords.push([...coords[0]]);
  if (coords.length < 2) {
    const e = new Error('Se necesitan al menos dos puntos.');
    e.codigo = 'solicitud_invalida';
    throw e;
  }
  const distancia = Math.max(1, coords.length - 1) * 900;
  const duracion = Math.round(distancia / (perfil === 'driving' ? 9 : perfil === 'cycling' ? 4.5 : 1.35));
  return {
    ruta: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { summary: { distance: distancia, duration: duracion } },
      }],
    },
    distancia_metros: distancia,
    duracion_segundos: duracion,
    orden: coords.map((_, i) => i),
    optimizado: Boolean(optimizar),
    fin,
  };
}


export async function buscarLugaresCercanos(lat, lng, limit = 5) {
  const base = [
    { id: 'mock-bar', nombre: 'Ibra Bar', categoria: 'Bar o pub', distancia_metros: 31, direccion: 'Ibra Bar, Perú 780', lat: lat + 0.0001, lng: lng + 0.0001 },
    { id: 'mock-sanatorio', nombre: 'Sanatorio Mock', categoria: 'Hospital', distancia_metros: 120, direccion: 'Sanatorio Mock, Av. Colón 100', lat: lat + 0.0005, lng: lng + 0.0005 },
  ];
  return base.slice(0, Math.max(1, Math.min(Number(limit) || 5, base.length)));
}
