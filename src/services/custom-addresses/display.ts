/**
 * Formato de la dirección en la barra, como en Chrome y Edge.
 *
 * - Sin foco (forma corta): sin `https://` ni `http://`, sin `www.` y sin la barra
 *   final cuando la ruta es solo `/`. La seguridad la indica el icono de la izquierda
 *   («No seguro» en HTTP), no el texto.
 * - Con foco o con «Mostrar siempre las URL completas»: la URL completa.
 */

import { parseWebUrl } from '../url-resolution/urlUtils';

export interface AddressParts {
  /** Protocolo visible (vacío en la forma corta). */
  prefix: string;
  host: string;
  /** Ruta, consulta y fragmento visibles. */
  rest: string;
}

export function formatAddress(href: string, full: boolean): AddressParts {
  const url = parseWebUrl(href);
  if (!url) return { prefix: '', host: href, rest: '' };
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (full) return { prefix: `${url.protocol}//`, host: url.host, rest: path };
  return {
    prefix: '',
    host: url.host.replace(/^www\./, ''),
    rest: path === '/' ? '' : path,
  };
}

/** Texto de la forma corta (p. ej. para el historial y las sugerencias). */
export function shortAddress(href: string): string {
  const parts = formatAddress(href, false);
  return `${parts.host}${parts.rest}`;
}
