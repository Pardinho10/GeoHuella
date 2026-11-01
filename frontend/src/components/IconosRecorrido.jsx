import React from 'react';

/**
 * Iconos del recorrido animado. Dibujados a mano, sin dependencias ni emojis.
 * Auto y bici están vistos desde arriba y apuntan hacia arriba (norte), de modo
 * que rotarlos con el rumbo del segmento sea correcto. El caminante se dibuja
 * de perfil y no se rota.
 */

const BASE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  'aria-hidden': 'true',
  focusable: 'false',
};

export function IconoAuto({ size = 26 }) {
  return (
    <svg {...BASE} width={size} height={size} data-icono-perfil="driving">
      <rect x="5.4" y="2.4" width="13.2" height="19.2" rx="4.4" fill="currentColor" />
      <rect x="7.9" y="5.4" width="8.2" height="4.3" rx="1.6" fill="#1b120a" opacity="0.92" />
      <rect x="7.9" y="14.4" width="8.2" height="3.6" rx="1.5" fill="#1b120a" opacity="0.55" />
      <rect x="4.4" y="7.2" width="1.7" height="2.8" rx="0.85" fill="currentColor" />
      <rect x="17.9" y="7.2" width="1.7" height="2.8" rx="0.85" fill="currentColor" />
      <rect x="4.4" y="14.2" width="1.7" height="2.8" rx="0.85" fill="currentColor" />
      <rect x="17.9" y="14.2" width="1.7" height="2.8" rx="0.85" fill="currentColor" />
    </svg>
  );
}

export function IconoBici({ size = 26 }) {
  return (
    <svg {...BASE} width={size} height={size} data-icono-perfil="cycling">
      <circle cx="12" cy="5.6" r="2.9" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="12" cy="18.4" r="2.9" stroke="currentColor" strokeWidth="1.9" />
      <path d="M12 8.5v7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M8.9 11.7h6.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 11.7 9.9 9.4M12 11.7l2.1-2.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.8" />
    </svg>
  );
}

export function IconoCaminante({ size = 26 }) {
  return (
    <svg {...BASE} width={size} height={size} data-icono-perfil="walking">
      <circle cx="12.6" cy="4.3" r="2.1" fill="currentColor" />
      <path
        d="M12.3 7.3v4.9M12.3 9.1 8.9 11.4M12.3 9.1l3.4 2.3M12.3 12.2 9.9 16.3 7.8 20M12.3 12.2l2.5 4.1 1.5 3.7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const ICONOS_RECORRIDO = {
  driving: IconoAuto,
  cycling: IconoBici,
  walking: IconoCaminante,
};

/** Etiqueta accesible del perfil. */
export const ETIQUETAS_ICONO = {
  driving: 'Auto',
  cycling: 'Bicicleta',
  walking: 'Persona caminando',
};

export default function IconoPerfil({ perfil = 'walking', size = 26 }) {
  const Icono = ICONOS_RECORRIDO[perfil] || IconoCaminante;
  return <Icono size={size} />;
}
