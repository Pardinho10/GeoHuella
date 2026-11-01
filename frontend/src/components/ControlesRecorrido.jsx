import React from 'react';
import { ETIQUETAS_ICONO } from './IconosRecorrido.jsx';

/**
 * Controles accesibles de la animación del recorrido.
 * - Reproducir/Pausar con etiqueta estable.
 * - Reiniciar vuelve al inicio y pausa (no borra la ruta).
 * - Con movimiento reducido no hay auto-play; se ofrecen pasos manuales.
 */
export default function ControlesRecorrido({
  perfil = 'walking',
  progreso = 0,
  reproduciendo = false,
  completado = false,
  reducido = false,
  duracionMs = 0,
  onReproducir = () => {},
  onPausar = () => {},
  onReiniciar = () => {},
  onPaso = () => {},
}) {
  const porcentaje = Math.round(Math.min(1, Math.max(0, Number(progreso) || 0)) * 100);
  const segundos = Math.max(1, Math.round((Number(duracionMs) || 0) / 1000));

  return (
    <div className="recorrido-controles" role="group" aria-label="Animación del recorrido" data-perfil={perfil}>
      <div className="recorrido-barra">
        <div
          className="recorrido-progreso"
          role="progressbar"
          aria-label="Progreso del recorrido"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={porcentaje}
          aria-valuetext={`${porcentaje} % del recorrido`}
        >
          <span style={{ width: `${porcentaje}%` }} />
        </div>
        <span className="recorrido-porcentaje" aria-hidden="true">{porcentaje}%</span>
      </div>

      <div className="recorrido-acciones">
        <button
          type="button"
          className="btn btn-soft btn-xs"
          onClick={reproduciendo ? onPausar : onReproducir}
          aria-label={reproduciendo ? 'Pausar recorrido' : 'Reproducir recorrido'}
        >
          {reproduciendo ? 'Pausar' : completado ? 'Reproducir de nuevo' : 'Reproducir'}
        </button>
        <button
          type="button"
          className="btn btn-soft btn-xs"
          onClick={onReiniciar}
          aria-label="Reiniciar recorrido"
          disabled={porcentaje === 0 && !completado}
        >
          Reiniciar
        </button>
        {reducido && (
          <>
            <button
              type="button"
              className="btn btn-soft btn-xs"
              onClick={() => onPaso(-1)}
              aria-label="Paso atrás"
            >
              Paso atrás
            </button>
            <button
              type="button"
              className="btn btn-soft btn-xs"
              onClick={() => onPaso(1)}
              aria-label="Paso adelante"
            >
              Paso adelante
            </button>
          </>
        )}
      </div>

      {completado && (
        <p className="recorrido-estado" role="status" aria-live="polite">
          Recorrido completado.
        </p>
      )}

      <p className="recorrido-nota">
        {reducido
          ? `Movimiento reducido activo (${ETIQUETAS_ICONO[perfil] || 'recorrido'}): la animación no arranca sola. Usá Reproducir o los pasos manuales.`
          : `Animación de ~${segundos} s sobre la geometría de la ruta; no usa la duración real del viaje (${ETIQUETAS_ICONO[perfil] || 'recorrido'}).`}
      </p>
    </div>
  );
}
