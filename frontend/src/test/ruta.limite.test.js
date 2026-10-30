import { describe, it, expect } from 'vitest';
import {
  analizarLimiteRuta,
  MAX_PUNTOS_RUTA,
  mensajeExcedenteRuta,
  mensajeMaximoRuta,
} from '../lib/ruta.js';

describe('analizarLimiteRuta', () => {
  it('mantiene el máximo histórico de 20', () => {
    expect(MAX_PUNTOS_RUTA).toBe(20);
    expect(analizarLimiteRuta({ total: 30 }).max).toBe(20);
  });

  it('sin excedente cuando la lista entra en el máximo', () => {
    const estado = analizarLimiteRuta({ total: 20, seleccionados: 5 });
    expect(estado.hayExcedente).toBe(false);
    expect(estado.excedentes).toBe(0);
    expect(estado.alcanzoMaximo).toBe(false);
    expect(estado.faltanParaMaximo).toBe(15);
    expect(estado.hayDisponibles).toBe(true);
  });

  it('con 21 o más huellas hay excedente explícito', () => {
    expect(analizarLimiteRuta({ total: 21 }).excedentes).toBe(1);
    const estado = analizarLimiteRuta({ total: 25 });
    expect(estado.hayExcedente).toBe(true);
    expect(estado.excedentes).toBe(5);
  });

  it('detecta el tope alcanzado y cuántas quedan fuera', () => {
    const estado = analizarLimiteRuta({ total: 25, seleccionados: 20 });
    expect(estado.alcanzoMaximo).toBe(true);
    expect(estado.faltanParaMaximo).toBe(0);
    expect(estado.quedanFuera).toBe(5);
    expect(estado.hayDisponibles).toBe(true);
  });

  it('nunca informa más de 20 seleccionadas', () => {
    const estado = analizarLimiteRuta({ total: 25, seleccionados: 99 });
    expect(estado.seleccionados).toBe(20);
  });

  it('conserva el total de la lista aunque el filtro muestre menos', () => {
    const estado = analizarLimiteRuta({ total: 25, visibles: 7, seleccionados: 0 });
    expect(estado.total).toBe(25);
    expect(estado.visibles).toBe(7);
    expect(estado.hayExcedente).toBe(true);
  });

  it('tolera entradas inválidas o vacías', () => {
    const estado = analizarLimiteRuta();
    expect(estado).toMatchObject({ total: 0, seleccionados: 0, max: 20, hayExcedente: false });
    expect(analizarLimiteRuta({ total: -3, seleccionados: null }).total).toBe(0);
  });
});

describe('mensajes del límite de ruta', () => {
  it('explica que hay que elegir un subconjunto y que es un solo tramo', () => {
    const mensaje = mensajeExcedenteRuta(analizarLimiteRuta({ total: 25 }));
    expect(mensaje).toContain('25 huellas');
    expect(mensaje).toContain('hasta 20');
    expect(mensaje).toContain('subconjunto');
    expect(mensaje).toContain('un solo tramo');
  });

  it('agrega el alcance del filtro cuando está activo', () => {
    const mensaje = mensajeExcedenteRuta(
      analizarLimiteRuta({ total: 25, visibles: 7 }),
      { filtroActivo: true },
    );
    expect(mensaje).toContain('El filtro muestra 7 de 25.');
  });

  it('no menciona el filtro si muestra todo', () => {
    const mensaje = mensajeExcedenteRuta(
      analizarLimiteRuta({ total: 25, visibles: 25 }),
      { filtroActivo: true },
    );
    expect(mensaje).not.toContain('El filtro');
  });

  it('explica cómo seguir al llegar al máximo', () => {
    const mensaje = mensajeMaximoRuta(analizarLimiteRuta({ total: 25, seleccionados: 20 }));
    expect(mensaje).toContain('máximo de 20 huellas de 25');
    expect(mensaje).toContain('desmarcá una');
    expect(mensaje).toContain('limpiá la selección');
  });
});
