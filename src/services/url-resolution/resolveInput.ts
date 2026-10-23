/**
 * Interpreta el texto de la barra de direcciones o del buscador:
 * dirección web, búsqueda, alias de ICARUS, página interna o protocolo bloqueado.
 */

import type { AliasRule } from '../../types/alias';
import type { SearchProviderId } from '../../types/settings';
import type { PageEntry } from '../../types/tabs';
import { resolveTypedAlias } from '../alias-rules/resolution';
import { buildSearchUrl } from '../search/providers';
import { INTERNAL_PROTOCOL, parseInternalUrl } from './internalPages';
import { getProtocol, isAliasHost, isDangerousProtocol, normalizeUserUrl, parseWebUrl, WEB_PROTOCOLS } from './urlUtils';

export type InputResolution =
  | { kind: 'empty' }
  | { kind: 'url'; url: string }
  | { kind: 'search'; url: string; query: string; providerId: SearchProviderId }
  | { kind: 'alias'; url: string; rule: AliasRule }
  | { kind: 'alias-unresolved'; alias: string; reason: 'unknown' | 'disabled' }
  | { kind: 'internal'; page: PageEntry }
  | { kind: 'internal-unknown'; text: string }
  | { kind: 'blocked'; protocol: string; dangerous: boolean };

export interface ResolveContext {
  providerId: SearchProviderId;
  rules: AliasRule[];
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

  // Con espacios siempre es una búsqueda (p. ej. "cómo funciona javascript: ...").
  if (/\s/.test(value)) return search();

  // Alias de ICARUS: solo se convierte en destino si hay una regla activa explícita.
  const alias = resolveTypedAlias(value, context.rules);
  if (alias.status === 'resolved') return { kind: 'alias', url: alias.url, rule: alias.rule };
  if (alias.status === 'disabled' || alias.status === 'unknown') {
    return { kind: 'alias-unresolved', alias: alias.alias, reason: alias.status };
  }

  const protocol = getProtocol(value);
  const isHostWithPort = protocol !== null && /^[^:/]+:\d+(?:[/?#]|$)/.test(value);
  if (protocol && !isHostWithPort) {
    if (protocol === INTERNAL_PROTOCOL) {
      const page = parseInternalUrl(value);
      return page ? { kind: 'internal', page } : { kind: 'internal-unknown', text: value };
    }
    if ((WEB_PROTOCOLS as readonly string[]).includes(protocol)) {
      const url = parseWebUrl(value);
      if (url && !isAliasHost(url.hostname) && !url.username && !url.password) return { kind: 'url', url: url.href };
      return search();
    }
    return { kind: 'blocked', protocol, dangerous: isDangerousProtocol(protocol) };
  }

  const normalized = normalizeUserUrl(value);
  if (normalized.ok) return { kind: 'url', url: normalized.url };
  return search();
}
