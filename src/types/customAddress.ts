/**
 * Direcciones personalizadas.
 *
 * El usuario asigna a un destino real (p. ej. `https://bot.deriv.me/`) la dirección
 * que quiere ver en la barra (p. ej. `https://miweb.com/`). Mientras se navega
 * dentro del destino, la barra muestra la dirección personalizada con la misma
 * ruta, consulta y fragmento; al escribir la dirección personalizada, ICARUS
 * navega al destino real equivalente.
 *
 * Una entrada puede limitarse a unas secciones del sitio (el fragmento: `#home`,
 * `#usuario`). En ellas gana a la entrada general del mismo destino, así que un sitio
 * puede mostrarse con una dirección en `#inicio` y `#catalogo` y con otra en `#home`.
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
  /** Secciones a las que se limita (`home`, sin `#`, en minúsculas). Sin secciones: todo el destino. */
  sections?: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Lo que se escribe en el editor; las secciones, como texto (`#home, #usuario`). */
export type CustomAddressInput = Pick<CustomAddress, 'target' | 'address' | 'enabled'> & { sections?: string };

/** Entrada ya validada y normalizada (sin `sections` si se aplica a todo el destino). */
export type CustomAddressValue = Pick<CustomAddress, 'target' | 'address' | 'enabled' | 'sections'>;
