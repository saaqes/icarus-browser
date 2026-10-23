/**
 * Describe cómo se presenta una página en la interfaz (título, texto de la barra
 * de direcciones, icono) aplicando las reglas de alias activas.
 *
 * El alias es solo presentación: `realUrl` conserva siempre la dirección real.
 */

import type { AliasMatch, AliasRule } from '../../types/alias';
import type { PageEntry } from '../../types/tabs';
import { findAliasMatch } from '../alias-rules/resolution';
import { internalUrlForPage } from '../url-resolution/internalPages';
import { parseWebUrl } from '../url-resolution/urlUtils';

export type PageIcon = 'icarus' | 'settings' | 'blank' | 'site';

export interface PagePresentation {
  kind: PageEntry['kind'];
  /** URL real (web) o dirección interna `icarus://`. */
  realUrl: string;
  /** Alias aplicado, si existe una regla activa que coincide. */
  alias: AliasMatch | null;
  /** Título para la pestaña. */
  title: string;
  icon: PageIcon;
  /** Protocolo real de la página web (null en páginas internas). */
  protocol: 'https:' | 'http:' | null;
  hostname: string | null;
}

export interface PageTitles {
  newTab: string;
  blank: string;
  settings: string;
}

export function describePage(
  page: PageEntry,
  options: { rules: AliasRule[]; showAliases: boolean; titles: PageTitles },
): PagePresentation {
  if (page.kind !== 'external') {
    const title =
      page.kind === 'newtab' ? options.titles.newTab : page.kind === 'blank' ? options.titles.blank : options.titles.settings;
    return {
      kind: page.kind,
      realUrl: internalUrlForPage(page) ?? '',
      alias: null,
      title,
      icon: page.kind === 'settings' ? 'settings' : page.kind === 'blank' ? 'blank' : 'icarus',
      protocol: null,
      hostname: null,
    };
  }
  const url = parseWebUrl(page.url);
  const alias = options.showAliases ? findAliasMatch(page.url, options.rules) : null;
  const hostname = url?.hostname ?? null;
  return {
    kind: 'external',
    realUrl: page.url,
    alias,
    title: alias?.rule.displayName ?? hostname?.replace(/^www\./, '') ?? page.url,
    icon: 'site',
    protocol: url?.protocol === 'http:' ? 'http:' : url?.protocol === 'https:' ? 'https:' : null,
    hostname,
  };
}

/** URL del icono del sitio servida por el propio sitio (sin servicios de terceros). */
export function faviconUrlFor(href: string): string | null {
  const url = parseWebUrl(href);
  return url ? `${url.origin}/favicon.ico` : null;
}
