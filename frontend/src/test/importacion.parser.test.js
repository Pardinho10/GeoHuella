import { describe, it, expect } from 'vitest';
import {
  analizarCSV,
  completarConDefectos,
  crearFilasDesdeDatos,
  datosCrudosDeCSV,
  detectarEncabezado,
  MAX_FILAS_IMPORTACION,
  mapearColumnas,
  mapeoPorDefecto,
  parsearLineaTexto,
  parsearTextoDirecciones,
  resolverProvincia,
  validarFila,
  validarFilas,
} from '../lib/importacion.js';

const PROVINCIAS = ['Buenos Aires', 'Santiago del Estero', 'Córdoba', 'Tucumán'];

describe('texto pegado — parseo de una dirección por línea', () => {
  it('separa calle, altura, ciudad y provincia', () => {
    const fila = parsearLineaTexto('Perú 781, Santiago del Estero, Santiago del Estero', { provincias: PROVINCIAS });
    expect(fila).toMatchObject({
      calle: 'Perú',
      altura: '781',
      ciudad: 'Santiago del Estero',
      provincia: 'Santiago del Estero',
    });
  });

  it('mantiene nombres de calle con números intermedios', () => {
    const fila = parsearLineaTexto('Avenida 25 de Mayo 100, Córdoba, Córdoba', { provincias: PROVINCIAS });
    expect(fila.calle).toBe('Avenida 25 de Mayo');
    expect(fila.altura).toBe('100');
  });

  it('reconoce nombre con corchetes y con etiqueta', () => {
    const corchetes = parsearLineaTexto('[Casa de Ana] Perú 781, Santiago del Estero, Santiago del Estero', { provincias: PROVINCIAS });
    expect(corchetes.nombre).toBe('Casa de Ana');
    expect(corchetes.calle).toBe('Perú');

    const etiqueta = parsearLineaTexto('nombre: Trabajo | Perú 781, Santiago del Estero, Santiago del Estero', { provincias: PROVINCIAS });
    expect(etiqueta.nombre).toBe('Trabajo');
    expect(etiqueta.altura).toBe('781');
  });

  it('sin ciudad explícita toma la provincia reconocible y no inventa la ciudad', () => {
    const fila = parsearLineaTexto('Perú 781, Santiago del Estero', { provincias: PROVINCIAS });
    expect(fila.provincia).toBe('Santiago del Estero');
    expect(fila.ciudad).toBe('');
  });

  it('toma ciudad y provincia cuando ambas están presentes', () => {
    const fila = parsearLineaTexto('Perú 781, La Banda, Santiago del Estero', { provincias: PROVINCIAS });
    expect(fila.ciudad).toBe('La Banda');
    expect(fila.provincia).toBe('Santiago del Estero');
  });

  it('acepta una línea mínima y deja lo faltante vacío', () => {
    const fila = parsearLineaTexto('Perú 781');
    expect(fila).toMatchObject({ calle: 'Perú', altura: '781', ciudad: '', provincia: '' });
  });

  it('resuelve alias de provincia sin acentos', () => {
    // Con lista explícita, solo se acepta lo que la lista ofrece.
    expect(resolverProvincia('caba', PROVINCIAS)).toBeNull();
    expect(resolverProvincia('cordoba', PROVINCIAS)).toBe('Córdoba');
    // Sin lista se usa la nómina oficial embebida (incluye CABA).
    expect(resolverProvincia('tucuman')).toBe('Tucumán');
    expect(resolverProvincia('caba')).toBe('Ciudad Autónoma de Buenos Aires');
    expect(resolverProvincia('Ciudad Autónoma de Buenos Aires')).toBe('Ciudad Autónoma de Buenos Aires');
    expect(resolverProvincia('Santiago del Estero', PROVINCIAS)).toBe('Santiago del Estero');
  });

  it('ignora líneas vacías y CRLF', () => {
    const filas = parsearTextoDirecciones(
      'Perú 781\r\n\r\n   \nLibertad 640, Santiago del Estero, Santiago del Estero\r\n',
      { provincias: PROVINCIAS },
    );
    expect(filas).toHaveLength(2);
    expect(filas[0].altura).toBe('781');
    expect(filas[1].calle).toBe('Libertad');
  });

  it('no inventa fila para texto vacío', () => {
    expect(parsearTextoDirecciones('')).toEqual([]);
    expect(parsearLineaTexto('   ')).toBeNull();
  });
});

describe('csv — encabezados en castellano e inglés', () => {
  it('detecta encabezados en castellano y arma el mapeo', () => {
    expect(detectarEncabezado(['nombre', 'calle', 'altura', 'ciudad', 'provincia'])).toBe(true);
    const mapeo = mapearColumnas(['nombre', 'calle', 'altura', 'ciudad', 'provincia']);
    expect(mapeo).toEqual({ nombre: 0, calle: 1, altura: 2, ciudad: 3, provincia: 4 });
  });

  it('detecta encabezados en inglés', () => {
    const analisis = analizarCSV('name,street,number,city,state\nCasa,Perú,781,Santiago del Estero,Santiago del Estero');
    expect(analisis.tieneEncabezado).toBe(true);
    expect(analisis.mapeo).toEqual({ nombre: 0, calle: 1, altura: 2, ciudad: 3, provincia: 4 });
    expect(analisis.filas).toHaveLength(1);
    expect(datosCrudosDeCSV(analisis)[0]).toEqual({
      nombre: 'Casa',
      calle: 'Perú',
      altura: '781',
      ciudad: 'Santiago del Estero',
      provincia: 'Santiago del Estero',
    });
  });

  it('acepta encabezados alternativos (address/direccion, nro, localidad, province)', () => {
    const mapeo = mapearColumnas(['Direccion', 'Nro', 'Localidad', 'Province']);
    expect(mapeo.calle).toBe(0);
    expect(mapeo.altura).toBe(1);
    expect(mapeo.ciudad).toBe(2);
    expect(mapeo.provincia).toBe(3);
  });

  it('no reutiliza la misma columna para dos campos', () => {
    const mapeo = mapearColumnas(['calle', 'calle']);
    expect(mapeo.calle).toBe(0);
    expect(mapeo.altura).toBe(-1);
  });

  it('sin encabezado usa mapeo posicional de 4 columnas', () => {
    const analisis = analizarCSV('Perú,781,Santiago del Estero,Santiago del Estero\nLibertad,640,Santiago del Estero,Santiago del Estero');
    expect(analisis.tieneEncabezado).toBe(false);
    expect(analisis.mapeo).toEqual(mapeoPorDefecto(4));
    expect(analisis.filas).toHaveLength(2);
    expect(datosCrudosDeCSV(analisis)[0].calle).toBe('Perú');
  });

  it('respeta un mapeo editado a mano', () => {
    const analisis = analizarCSV('calle,altura,ciudad,provincia\nPerú,781,Santiago del Estero,Santiago del Estero');
    const mapeoEditado = { nombre: -1, calle: 0, altura: 1, ciudad: 3, provincia: 2 };
    const datos = datosCrudosDeCSV(analisis, mapeoEditado);
    expect(datos[0].ciudad).toBe('Santiago del Estero');
    expect(datos[0].provincia).toBe('Santiago del Estero');
  });

  it('csv con punto y coma, BOM y comillas', () => {
    const texto = '\uFEFFnombre;calle;altura;ciudad;provincia\r\n"Casa; Grande";Perú;781;Santiago del Estero;Santiago del Estero\r\n';
    const analisis = analizarCSV(texto);
    expect(analisis.delimitador).toBe(';');
    expect(datosCrudosDeCSV(analisis)[0]).toMatchObject({
      nombre: 'Casa; Grande',
      calle: 'Perú',
      altura: '781',
    });
  });
});

describe('validación de filas', () => {
  const valida = {
    nombre: '',
    calle: 'Perú',
    altura: '781',
    ciudad: 'Santiago del Estero',
    provincia: 'Santiago del Estero',
  };

  it('fila completa es válida', () => {
    expect(validarFila(valida, { provincias: PROVINCIAS })).toEqual({});
  });

  it('exige calle, altura numérica, ciudad y provincia', () => {
    const errores = validarFila({ nombre: '', calle: '', altura: 'ABC', ciudad: '', provincia: '' }, { provincias: PROVINCIAS });
    expect(Object.keys(errores).sort()).toEqual(['altura', 'calle', 'ciudad', 'provincia']);
  });

  it('respeta longitudes máximas del contrato', () => {
    const errores = validarFila({
      ...valida,
      calle: 'x'.repeat(121),
      altura: '1234567',
      ciudad: 'y'.repeat(81),
      nombre: 'z'.repeat(81),
    }, { provincias: PROVINCIAS });
    expect(errores.calle).toMatch(/120/);
    expect(errores.altura).toMatch(/6/);
    expect(errores.ciudad).toMatch(/80/);
    expect(errores.nombre).toMatch(/80/);
  });

  it('rechaza alturas con separadores o negativos', () => {
    expect(validarFila({ ...valida, altura: '78a' }).altura).toBeDefined();
    expect(validarFila({ ...valida, altura: '-1' }).altura).toBeDefined();
    expect(validarFila({ ...valida, altura: '1.5' }).altura).toBeDefined();
  });

  it('rechaza provincia fuera de la lista oficial cuando se conoce', () => {
    expect(validarFila({ ...valida, provincia: 'Narnia' }, { provincias: PROVINCIAS }).provincia).toBeDefined();
  });

  it('validarFilas identifica las inválidas por id sin cortar el resto', () => {
    const filas = crearFilasDesdeDatos([valida, { ...valida, altura: '' }, valida]);
    const resultado = validarFilas(filas, { provincias: PROVINCIAS });
    expect(resultado.valido).toBe(false);
    expect(resultado.invalidas).toBe(1);
    expect(resultado.erroresPorId['fila-2']).toHaveProperty('altura');
    expect(resultado.erroresPorId['fila-1']).toBeUndefined();
  });
});

describe('valores por defecto explícitos', () => {
  it('completa solo los campos vacíos', () => {
    const completos = completarConDefectos(
      { calle: 'Perú', altura: '781', ciudad: '', provincia: '' },
      { ciudadDefecto: 'Santiago del Estero', provinciaDefecto: 'Santiago del Estero' },
    );
    expect(completos.ciudad).toBe('Santiago del Estero');
    expect(completos.provincia).toBe('Santiago del Estero');

    const respetado = completarConDefectos(
      { calle: 'Perú', altura: '781', ciudad: 'La Banda', provincia: '' },
      { ciudadDefecto: 'Santiago del Estero', provinciaDefecto: 'Santiago del Estero' },
    );
    expect(respetado.ciudad).toBe('La Banda');
  });

  it('sin defaults las filas quedan incompletas y visibles', () => {
    const [fila] = crearFilasDesdeDatos([{ calle: 'Perú', altura: '781' }]);
    expect(fila.ciudad).toBe('');
    expect(fila.provincia).toBe('');
    expect(validarFila(fila).ciudad).toBeDefined();
    expect(fila.estado).toBe('pendiente');
    expect(fila.seleccionada).toBe(false);
  });

  it('límite de importación declarado en 100', () => {
    expect(MAX_FILAS_IMPORTACION).toBe(100);
  });
});
