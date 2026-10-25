/**
 * Describe cómo se presenta una página en la interfaz (título, dirección de la
 * barra, icono) aplicando las direcciones personalizadas activas.
 *
 * `realUrl` es siempre la dirección que carga el motor; `addressUrl` es la que ve
 * el usuario: la personalizada mientras la página esté dentro de su destino.
 */

import type { CustomAddress } from '../../types/customAddress';
import type { PageEntry } from '../../types/tabs';
import { shortAddress } from '../custom-addresses/display';
import { displayUrlFor } from '../custom-addresses/mapping';
import { internalUrlForPage } from '../url-resolution/internalPages';
import { parseWebUrl } from '../url-resolution/urlUtils';

export type PageIcon = 'icarus' | 'settings' | 'blank' | 'site' | 'history' | 'downloads';

export interface PagePresentation {
  kind: PageEntry['kind'];
  /** URL real (web) o dirección interna `icarus://`. */
  realUrl: string;
  /** Dirección que muestra y permite editar la barra (personalizada o real). */
  addressUrl: string;
  /** Dirección personalizada aplicada, si la página está dentro de su destino. */
  customAddress: CustomAddress | null;
  /** Título para la pestaña. */
  title: string;
  icon: PageIcon;
  /** Protocolo real de la página web (null en páginas internas). */
  protocol: 'https:' | 'http:' | null;
  /** Host real de la página (null en páginas internas). */
  hostname: string | null;
}

export interface PageTitles {
  newTab: string;
  blank: string;
  settings: string;
  history: string;
  downloads: string;
}

export function describePage(page: PageEntry, options: { customAddresses: CustomAddress[]; titles: PageTitles }): PagePresentation {
  if (page.kind !== 'web') {
    const internal: Record<Exclude<PageEntry['kind'], 'web'>, { title: string; icon: PageIcon }> = {
      newtab: { title: options.titles.newTab, icon: 'icarus' },
      blank: { title: options.titles.blank, icon: 'blank' },
      settings: { title: options.titles.settings, icon: 'settings' },
      history: { title: options.titles.history, icon: 'history' },
      downloads: { title: options.titles.downloads, icon: 'downloads' },
    };
    const internalUrl = internalUrlForPage(page) ?? '';
    return {
      kind: page.kind,
      realUrl: internalUrl,
      addressUrl: internalUrl,
      customAddress: null,
      title: internal[page.kind].title,
      icon: internal[page.kind].icon,
      protocol: null,
      hostname: null,
    };
  }
  const url = parseWebUrl(page.url);
  // Se calcula con la URL real actual: si una navegación o redirección sale del
  // destino, vuelve a mostrarse la dirección real del sitio al que se llegó.
  const custom = displayUrlFor(page.url, options.customAddresses);
  const addressUrl = custom?.url ?? page.url;
  return {
    kind: 'web',
    realUrl: page.url,
    addressUrl,
    customAddress: custom?.entry ?? null,
    title: page.title?.trim() || shortAddress(addressUrl) || page.url,
    icon: 'site',
    protocol: url?.protocol === 'http:' ? 'http:' : url?.protocol === 'https:' ? 'https:' : null,
    hostname: url?.hostname ?? null,
  };
}

/** URL del icono del sitio servida por el propio sitio (sin servicios de terceros). */
export function faviconUrlFor(href: string): string | null {
  const url = parseWebUrl(href);
  return url ? `${url.origin}/favicon.ico` : null;
}
