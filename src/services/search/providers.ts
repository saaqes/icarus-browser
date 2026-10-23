/** Proveedores de búsqueda disponibles. La búsqueda se abre en el sitio del proveedor. */

import type { SearchProviderId } from '../../types/settings';

export interface SearchProvider {
  id: SearchProviderId;
  name: string;
  homeUrl: string;
  buildSearchUrl: (query: string) => string;
}

export const SEARCH_PROVIDERS: Record<SearchProviderId, SearchProvider> = {
  google: {
    id: 'google',
    name: 'Google',
    homeUrl: 'https://www.google.com/',
    buildSearchUrl: (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  },
  bing: {
    id: 'bing',
    name: 'Bing',
    homeUrl: 'https://www.bing.com/',
    buildSearchUrl: (query) => `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
  },
  duckduckgo: {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    homeUrl: 'https://duckduckgo.com/',
    buildSearchUrl: (query) => `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
  },
};

export function getSearchProvider(id: SearchProviderId): SearchProvider {
  return SEARCH_PROVIDERS[id] ?? SEARCH_PROVIDERS.google;
}

export function buildSearchUrl(providerId: SearchProviderId, query: string): string {
  return getSearchProvider(providerId).buildSearchUrl(query.trim());
}
