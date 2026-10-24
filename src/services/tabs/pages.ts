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

export type PageIcon = 'icarus' | 'settings' | 'blank' | 'site' | 'history' | 'downloads';

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
  history: string;
  downloads: string;
}

export function describePage(
  page: PageEntry,
  options: { rules: AliasRule[]; showAliases: boolean; titles: PageTitles },
): PagePresentation {
  if (page.kind !== 'web') {
    const internal: Record<Exclude<PageEntry['kind'], 'web'>, { title: string; icon: PageIcon }> = {
      newtab: { title: options.titles.newTab, icon: 'icarus' },
      blank: { title: options.titles.blank, icon: 'blank' },
      settings: { title: options.titles.settings, icon: 'settings' },
      history: { title: options.titles.history, icon: 'history' },
      downloads: { title: options.titles.downloads, icon: 'downloads' },
    };
    return {
      kind: page.kind,
      realUrl: internalUrlForPage(page) ?? '',
      alias: null,
      title: internal[page.kind].title,
      icon: internal[page.kind].icon,
      protocol: null,
      hostname: null,
    };
  }
  const url = parseWebUrl(page.url);
  // Al dejar de coincidir con la URL real (p. ej. tras navegar), el alias desaparece.
  const alias = options.showAliases ? findAliasMatch(page.url, options.rules) : null;
  const hostname = url?.hostname ?? null;
  return {
    kind: 'web',
    realUrl: page.url,
    alias,
    title: alias?.rule.displayName || page.title?.trim() || hostname?.replace(/^www\./, '') || page.url,
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
