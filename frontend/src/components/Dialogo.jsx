import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Modal from 'react-bootstrap/Modal';

/**
 * Diálogo modal de la app para **alertas** y **confirmaciones**.
 *
 * Reemplaza los diálogos nativos del navegador (`window.alert`,
 * `window.confirm`) manteniendo el lenguaje visual del panel: fondo cálido,
 * tipografía Poppins en el título y botones del sistema.
 *
 * - `tonalidad="info"` (default): mensaje informativo, un solo botón.
 * - `tonalidad="peligro"`: acción destructiva; el botón de confirmación usa el
 *   estilo de peligro y hay un botón para cancelar.
 */
export default function Dialogo({
  titulo,
  mensaje,
  detalle = null,
  tonalidad = 'info',
  confirmar = 'Aceptar',
  cancelar = null,
  onConfirmar = () => {},
  onCancelar = () => {},
}) {
  const tituloId = useId();
  const mensajeId = useId();
  const peligro = tonalidad === 'peligro';

  return (
    <Modal
      show
      centered
      animation={false}
      onHide={onCancelar}
      dialogClassName="dialogo"
      contentClassName={`dialogo-caja${peligro ? ' dialogo-caja--peligro' : ''}`}
      aria-labelledby={tituloId}
      aria-describedby={mensajeId}
    >
      <Modal.Header className="dialogo-head">
        <h2 className="dialogo-titulo" id={tituloId}>{titulo}</h2>
      </Modal.Header>
      <Modal.Body className="dialogo-cuerpo">
        <p className="dialogo-mensaje" id={mensajeId}>{mensaje}</p>
        {detalle && <p className="dialogo-detalle">{detalle}</p>}
      </Modal.Body>
      <Modal.Footer className="dialogo-pie">
        {cancelar && (
          <button type="button" className="btn btn-soft" onClick={onCancelar}>
            {cancelar}
          </button>
        )}
        <button
          type="button"
          className={`btn ${peligro ? 'btn-peligro' : 'btn-primary'}`}
          onClick={onConfirmar}
          autoFocus
        >
          {confirmar}
        </button>
      </Modal.Footer>
    </Modal>
  );
}

/**
 * Estado de diálogos para un componente.
 *
 * ```js
 * const { alerta, confirmar, elemento } = useDialogos();
 * await alerta({ titulo: 'Listo', mensaje: 'Se guardó el punto.' });
 * if (await confirmar({ titulo: '¿Quitar?', mensaje: '…', tonalidad: 'peligro' })) { … }
 * ```
 *
 * Ambas funciones devuelven una promesa: `alerta` resuelve cuando se cierra y
 * `confirmar` resuelve `true` solo si se eligió la acción principal.
 * El componente dueño debe renderizar `elemento` en su árbol.
 */
export function useDialogos() {
  const [dialogo, setDialogo] = useState(null);
  const resolver = useRef(null);

  const cerrar = useCallback((resultado) => {
    const pendiente = resolver.current;
    resolver.current = null;
    setDialogo(null);
    if (pendiente) pendiente(resultado);
  }, []);

  const abrir = useCallback((config) => new Promise((resolve) => {
    // Si había otro diálogo abierto, se resuelve como cancelado.
    if (resolver.current) {
      const previo = resolver.current;
      resolver.current = null;
      previo(false);
    }
    resolver.current = resolve;
    setDialogo(config);
  }), []);

  useEffect(() => () => {
    // Al desmontar, ninguna promesa queda colgada.
    if (resolver.current) {
      const pendiente = resolver.current;
      resolver.current = null;
      pendiente(false);
    }
  }, []);

  const alerta = useCallback((config) => abrir({
    tonalidad: 'info',
    confirmar: 'Entendido',
    ...config,
  }), [abrir]);

  const confirmar = useCallback((config) => abrir({
    tonalidad: 'peligro',
    confirmar: 'Aceptar',
    cancelar: 'Cancelar',
    ...config,
  }), [abrir]);

  const elemento = dialogo ? (
    <Dialogo
      {...dialogo}
      onConfirmar={() => cerrar(true)}
      onCancelar={() => cerrar(false)}
    />
  ) : null;

  return { alerta, confirmar, elemento, abierto: Boolean(dialogo) };
}
