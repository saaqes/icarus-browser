/**
 * Direcciones personalizadas.
 *
 * El usuario asigna a un destino real (p. ej. `https://bot.deriv.me/`) la dirección
 * que quiere ver en la barra (p. ej. `https://miweb.com/`). Mientras se navega
 * dentro del destino, la barra muestra la dirección personalizada con la misma
 * ruta, consulta y fragmento; al escribir la dirección personalizada, ICARUS
 * navega al destino real equivalente.
 *
 * La resolución es interna de ICARUS: Chromium siempre carga el sitio real, con su
 * propio certificado y origen. La dirección personalizada no es un dominio de
 * Internet salvo que exista por sí misma (y entonces ICARUS la sustituye).
 */

export interface CustomAddress {
  id: string;
  /** Destino real: `protocolo://host[:puerto]/ruta-base`, sin consulta ni fragmento. */
  target: string;
  /** Dirección que muestra la barra. Siempre con el mismo protocolo que el destino. */
  address: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CustomAddressInput = Pick<CustomAddress, 'target' | 'address' | 'enabled'>;
