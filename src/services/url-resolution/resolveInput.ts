/**
 * Interpreta el texto de la barra de direcciones: dirección web, dirección
 * personalizada, página interna o protocolo bloqueado.
 *
 * ICARUS no tiene un buscador general: el texto que no es una dirección válida ni un
 * alias se intenta como dominio (se añade `https://`) y, si no resuelve, el motor
 * muestra su página de error real. Nunca se convierte en una búsqueda de Google u otro
 * buscador.
 *
 * Las direcciones se aceptan tal como se escriben (`google.com`, `bot.deriv.me`,
 * `localhost:3000`, `https://ejemplo.com/ruta?x#y`): solo se añade `https://`
 * (o `http://` para localhost y direcciones IP) cuando falta el protocolo.
 */

import type { CustomAddress } from '../../types/customAddress';
import type { SearchProviderId } from '../../types/settings';
import type { PageEntry } from '../../types/tabs';
import { resolveCustomAddress } from '../custom-addresses/mapping';
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

  const web = (url: URL, explicitProtocol: boolean): InputResolution => {
    const custom = resolveCustomAddress(url, context.customAddresses, explicitProtocol);
    return custom ? { kind: 'custom', url: custom.url, address: custom.address, entry: custom.entry } : { kind: 'url', url: url.href };
  };

  // Sin buscador: lo que no es una dirección válida se intenta como dominio. El motor
  // muestra su página de error real si no existe; nunca se busca en un buscador.
  const asDomain = (): InputResolution => {
    const parsed = parseWebUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    return { kind: 'url', url: parsed ? parsed.href : `https://${encodeURIComponent(value)}/` };
  };

  const protocol = getProtocol(value);
  const isHostWithPort = protocol !== null && /^[^:/]+:\d+(?:[/?#]|$)/.test(value);
  if (!/\s/.test(value) && protocol && !isHostWithPort) {
    if (protocol === INTERNAL_PROTOCOL) {
      const page = parseInternalUrl(value);
      return page ? { kind: 'internal', page } : { kind: 'internal-unknown', text: value };
    }
    if ((WEB_PROTOCOLS as readonly string[]).includes(protocol)) {
      const url = parseWebUrl(value);
      if (url && !url.username && !url.password) return web(url, true);
      return asDomain();
    }
    return { kind: 'blocked', protocol, dangerous: isDangerousProtocol(protocol) };
  }

  const normalized = normalizeUserUrl(value);
  if (normalized.ok) return web(normalized.parsed, false);
  return asDomain();
}
