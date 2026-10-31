import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dialogo, { useDialogos } from '../components/Dialogo.jsx';

function Arnes() {
  const { alerta, confirmar, elemento } = useDialogos();
  const [registro, setRegistro] = useState('—');

  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          setRegistro('alerta-abierta');
          await alerta({ titulo: 'Aviso del sistema', mensaje: 'Mensaje de alerta' });
          setRegistro('alerta-cerrada');
        }}
      >
        abrir alerta
      </button>
      <button
        type="button"
        onClick={async () => {
          const ok = await confirmar({
            titulo: 'Confirmar acción',
            mensaje: 'Mensaje de confirmación',
            detalle: 'No se puede deshacer.',
            confirmar: 'Hacerlo',
            cancelar: 'Volver',
          });
          setRegistro(ok ? 'confirmado' : 'cancelado');
        }}
      >
        abrir confirmación
      </button>
      <span data-testid="registro">{registro}</span>
      {elemento}
    </div>
  );
}

describe('Dialogo', () => {
  it('muestra título, mensaje y detalle con una sola acción', async () => {
    const onConfirmar = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialogo
        titulo="Aviso"
        mensaje="Se agregaron 2 de 3."
        detalle="Quitá alguna huella para sumar el resto."
        confirmar="Entendido"
        onConfirmar={onConfirmar}
        onCancelar={vi.fn()}
      />,
    );

    const dialogo = screen.getByRole('dialog', { name: 'Aviso' });
    expect(dialogo).toHaveTextContent('Se agregaron 2 de 3.');
    expect(dialogo).toHaveTextContent('Quitá alguna huella para sumar el resto.');
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(onConfirmar).toHaveBeenCalledTimes(1);
  });

  it('en modo peligro ofrece cancelar con el estilo de la app', async () => {
    const onCancelar = vi.fn();
    const onConfirmar = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialogo
        titulo="Quitar huella"
        mensaje="¿Quitar «Casa» del mapa?"
        tonalidad="peligro"
        confirmar="Quitar"
        cancelar="Cancelar"
        onConfirmar={onConfirmar}
        onCancelar={onCancelar}
      />,
    );

    const confirmar = screen.getByRole('button', { name: 'Quitar' });
    expect(confirmar).toHaveClass('btn-peligro');

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancelar).toHaveBeenCalledTimes(1);
    expect(onConfirmar).not.toHaveBeenCalled();
  });
});

describe('useDialogos', () => {
  it('la alerta resuelve al cerrarla con su botón', async () => {
    const user = userEvent.setup();
    render(<Arnes />);

    await user.click(screen.getByRole('button', { name: 'abrir alerta' }));
    expect(await screen.findByRole('dialog', { name: 'Aviso del sistema' })).toBeInTheDocument();
    expect(screen.getByTestId('registro')).toHaveTextContent('alerta-abierta');

    await user.click(screen.getByRole('button', { name: 'Entendido' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('registro')).toHaveTextContent('alerta-cerrada');
  });

  it('la confirmación resuelve true al aceptar y false al cancelar', async () => {
    const user = userEvent.setup();
    render(<Arnes />);

    await user.click(screen.getByRole('button', { name: 'abrir confirmación' }));
    expect(await screen.findByRole('dialog', { name: 'Confirmar acción' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Volver' }));
    await waitFor(() => expect(screen.getByTestId('registro')).toHaveTextContent('cancelado'));

    await user.click(screen.getByRole('button', { name: 'abrir confirmación' }));
    await user.click(await screen.findByRole('button', { name: 'Hacerlo' }));
    await waitFor(() => expect(screen.getByTestId('registro')).toHaveTextContent('confirmado'));
  });

  it('Escape cancela la confirmación', async () => {
    const user = userEvent.setup();
    render(<Arnes />);

    await user.click(screen.getByRole('button', { name: 'abrir confirmación' }));
    await screen.findByRole('dialog', { name: 'Confirmar acción' });

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByTestId('registro')).toHaveTextContent('cancelado'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('un diálogo nuevo resuelve como cancelado el anterior', async () => {
    function Doble() {
      const { alerta, confirmar, elemento } = useDialogos();
      const [registro, setRegistro] = useState('—');
      return (
        <div>
          <button
            type="button"
            onClick={async () => {
              const primero = confirmar({ titulo: 'Primero', mensaje: 'A' });
              await alerta({ titulo: 'Segundo', mensaje: 'B' });
              setRegistro(await primero ? 'primero-ok' : 'primero-cancelado');
            }}
          >
            abrir dos
          </button>
          <span data-testid="registro">{registro}</span>
          {elemento}
        </div>
      );
    }

    const user = userEvent.setup();
    render(<Doble />);

    await user.click(screen.getByRole('button', { name: 'abrir dos' }));
    await user.click(await screen.findByRole('button', { name: 'Entendido' }));
    await waitFor(() => expect(screen.getByTestId('registro')).toHaveTextContent('primero-cancelado'));
  });
});
