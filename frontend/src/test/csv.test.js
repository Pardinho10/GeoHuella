import { describe, it, expect } from 'vitest';
import { detectarDelimitador, parsearCSV, quitarBOM } from '../lib/csv.js';

describe('csv — BOM, delimitador y saltos de línea', () => {
  it('quita el BOM inicial', () => {
    expect(quitarBOM('\uFEFFcalle,altura')).toBe('calle,altura');
    expect(quitarBOM('calle,altura')).toBe('calle,altura');
  });

  it('detecta coma y punto y coma', () => {
    expect(detectarDelimitador('calle,altura,ciudad')).toBe(',');
    expect(detectarDelimitador('calle;altura;ciudad')).toBe(';');
    expect(detectarDelimitador('calle')).toBe(',');
    // El delimitador real del encabezado gana aunque los datos tengan comas decimales.
    expect(detectarDelimitador('lat;lng\n-27,78;-64,26')).toBe(';');
  });

  it('ignora delimitadores dentro de comillas al detectar', () => {
    expect(detectarDelimitador('"Perú, 781";ciudad;provincia')).toBe(';');
  });

  it('parsea CRLF y LF con BOM', () => {
    const conCrlf = '\uFEFFcalle,altura\r\nPerú,781\r\nLibertad,640\r\n';
    const resultado = parsearCSV(conCrlf);
    expect(resultado.filas).toEqual([
      ['calle', 'altura'],
      ['Perú', '781'],
      ['Libertad', '640'],
    ]);
  });

  it('parsea saltos CR solos', () => {
    expect(parsearCSV('a,b\rc,d').filas).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('csv — comillas', () => {
  it('conserva comas y punto y coma dentro de campos entrecomillados', () => {
    const texto = 'nombre,calle,altura,ciudad\n"Casa, de Ana","Perú, 781",781,"Santiago; del Estero"';
    const { filas, delimitador } = parsearCSV(texto);
    expect(delimitador).toBe(',');
    expect(filas[1]).toEqual(['Casa, de Ana', 'Perú, 781', '781', 'Santiago; del Estero']);
  });

  it('soporta saltos de línea dentro de comillas', () => {
    const { filas } = parsearCSV('nombre,calle\n"Linea\ncortada",Perú');
    expect(filas).toHaveLength(2);
    expect(filas[1][0]).toBe('Linea\ncortada');
  });

  it('desescapa comillas dobles', () => {
    const { filas } = parsearCSV('nombre,calle\n"La ""Casa""",Perú');
    expect(filas[1][0]).toBe('La "Casa"');
  });

  it('marca comillas sin cerrar pero devuelve lo recuperable', () => {
    const { filas, comillasSinCerrar } = parsearCSV('calle,altura\n"Perú,781');
    expect(comillasSinCerrar).toBe(true);
    expect(filas[1]).toEqual(['Perú,781']);
  });
});

describe('csv — casos vacíos y malformados', () => {
  it('texto vacío no produce filas', () => {
    expect(parsearCSV('').filas).toEqual([]);
    expect(parsearCSV('   ').filas).toEqual([]);
    expect(parsearCSV('\uFEFF\r\n').filas).toEqual([]);
  });

  it('descarta líneas en blanco intermedias', () => {
    const { filas } = parsearCSV('a,b\n\n\nc,d\n');
    expect(filas).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('tolera filas con menos columnas que el encabezado', () => {
    const { filas } = parsearCSV('calle,altura,ciudad\nPerú,781');
    expect(filas[1]).toEqual(['Perú', '781']);
  });

  it('punto y coma con comas decimales no rompe columnas', () => {
    const { filas } = parsearCSV('calle;altura;ciudad\nPerú;781;Santiago del Estero');
    expect(filas[1]).toEqual(['Perú', '781', 'Santiago del Estero']);
  });
});
