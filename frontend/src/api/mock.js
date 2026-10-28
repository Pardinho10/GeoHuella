const PROVINCIAS = [
  'Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes',
  'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza',
  'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis',
  'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego',
  'Tucumán', 'Ciudad Autónoma de Buenos Aires',
];

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


export async function calcularRuta({ puntos = [], perfil = 'walking', volver_al_inicio = false } = {}) {
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
  };
}
