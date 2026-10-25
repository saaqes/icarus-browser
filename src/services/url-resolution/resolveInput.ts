/**
 * Interpreta el texto de la barra de direcciones o del buscador: dirección web,
 * dirección personalizada, búsqueda, página interna o protocolo bloqueado.
 *
 * Las direcciones se aceptan tal como se escriben (`google.com`, `bot.deriv.me`,
 * `localhost:3000`, `https://ejemplo.com/ruta?x#y`): solo se añade `https://`
 * (o `http://` para localhost y direcciones IP) cuando falta el protocolo.
 */

import type { CustomAddress } from '../../types/customAddress';
import type { SearchProviderId } from '../../types/settings';
import type { PageEntry } from '../../types/tabs';
import { resolveCustomAddress } from '../custom-addresses/mapping';
import { buildSearchUrl } from '../search/providers';
import { INTERNAL_PROTOCOL, parseInternalUrl } from './internalPages';
import { getProtocol, isDangerousProtocol, normalizeUserUrl, parseWebUrl, WEB_PROTOCOLS } from './urlUtils';

export type InputResolution =
  | { kind: 'empty' }
  | { kind: 'url'; url: string }
  /** Dirección personalizada: `address` es lo escrito (normalizado) y `url` el destino real. */
  | { kind: 'custom'; url: string; address: string; entry: CustomAddress }
  | { kind: 'search'; url: string; query: string; providerId: SearchProviderId }
  | { kind: 'internal'; page: PageEntry }
  | { kind: 'internal-unknown'; text: string }
  | { kind: 'blocked'; protocol: string; dangerous: boolean };

export interface ResolveContext {
  providerId: SearchProviderId;
  customAddresses: CustomAddress[];
}

export function resolveInput(text: string, context: ResolveContext): InputResolution {
  const value = text.trim();
  if (!value) return { kind: 'empty' };

  const search = (): InputResolution => ({
    kind: 'search',
    query: value,
    providerId: context.providerId,
    url: buildSearchUrl(context.providerId, value),
  });

  const web = (url: URL, explicitProtocol: boolean): InputResolution => {
    const custom = resolveCustomAddress(url, context.customAddresses, explicitProtocol);
    return custom ? { kind: 'custom', url: custom.url, address: custom.address, entry: custom.entry } : { kind: 'url', url: url.href };
  };

  // Con espacios siempre es una búsqueda (p. ej. "cómo funciona javascript: ...").
  if (/\s/.test(value)) return search();

  const protocol = getProtocol(value);
  const isHostWithPort = protocol !== null && /^[^:/]+:\d+(?:[/?#]|$)/.test(value);
  if (protocol && !isHostWithPort) {
    if (protocol === INTERNAL_PROTOCOL) {
      const page = parseInternalUrl(value);
      return page ? { kind: 'internal', page } : { kind: 'internal-unknown', text: value };
    }
    if ((WEB_PROTOCOLS as readonly string[]).includes(protocol)) {
      const url = parseWebUrl(value);
      if (url && !url.username && !url.password) return web(url, true);
      return search();
    }
    return { kind: 'blocked', protocol, dangerous: isDangerousProtocol(protocol) };
  }

  const normalized = normalizeUserUrl(value);
  if (normalized.ok) return web(normalized.parsed, false);
  return search();
}
