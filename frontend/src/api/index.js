import * as real from './client.js';
import * as mock from './mock.js';

const usarMock = String(import.meta.env.VITE_USAR_MOCK || '').toLowerCase() === 'true';

const impl = usarMock ? mock : real;

export const obtenerProvincias = impl.obtenerProvincias;
export const geocodificar = impl.geocodificar;
export const ubicarCoordenadas = impl.ubicarCoordenadas;
export { usarMock };
