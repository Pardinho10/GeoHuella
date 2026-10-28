const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

function url(path) {
  return `${BASE}${path}`;
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(url(path), {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
  } catch (err) {
    const e = new Error('No se pudo conectar con el servidor');
    e.codigo = 'conexion';
    throw e;
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error(data?.error?.mensaje || 'Error del servidor');
    err.codigo = data?.error?.codigo || 'error';
    err.campos = data?.error?.campos || null;
    err.sugerencias = Array.isArray(data?.error?.sugerencias)
      ? data.error.sugerencias
      : [];
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function obtenerProvincias() {
  const data = await request('/api/provincias/');
  return Array.isArray(data?.provincias) ? data.provincias : [];
}

export async function geocodificar(direccion) {
  const data = await request('/api/geocodificar/', {
    method: 'POST',
    body: JSON.stringify(direccion || {}),
  });
  return Array.isArray(data?.resultados) ? data.resultados : [];
}

export async function ubicarCoordenadas(lat, lng) {
  return request('/api/ubicar-coordenadas/', {
    method: 'POST',
    body: JSON.stringify({ lat, lng }),
  });
}


export async function calcularRuta({ puntos, perfil = 'walking', volver_al_inicio = false, optimizar = false } = {}) {
  const data = await request('/api/ruta/', {
    method: 'POST',
    body: JSON.stringify({
      puntos: Array.isArray(puntos) ? puntos : [],
      perfil,
      volver_al_inicio,
      optimizar: Boolean(optimizar),
    }),
  });
  if (!Array.isArray(data?.ruta?.features) || data.ruta.features.length === 0) {
    const e = new Error('El servidor devolvió una ruta inválida.');
    e.codigo = 'ruta_invalida';
    throw e;
  }
  return data;
}
