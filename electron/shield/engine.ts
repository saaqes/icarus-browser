/**
 * Motor de coincidencia de ICARUS Shield.
 *
 * - Los filtros `||dominio^` se indexan por nombre de host (búsqueda por
 *   etiquetas: a.b.ejemplo.com → b.ejemplo.com → ejemplo.com).
 * - El resto se indexa por un fragmento literal («token»); solo se evalúan los
 *   filtros cuyos tokens aparecen en la URL, más un pequeño grupo genérico.
 * - Las excepciones (@@) siempre prevalecen sobre los bloqueos.
 * - Las solicitudes de documento principal nunca se bloquean.
 */

import { hostMatchesDomain, isThirdParty } from './domains';
import type { NetworkFilter, ResourceType } from './filters';

export interface RequestInfo {
  url: string;
  type: ResourceType;
  /** URL del documento principal de la pestaña (para $domain y terceros). */
  pageUrl: string;
}

export interface MatchResult {
  blocked: boolean;
  filter: NetworkFilter | null;
}

interface Bucket {
  byHost: Map<string, NetworkFilter[]>;
  byToken: Map<string, NetworkFilter[]>;
  generic: NetworkFilter[];
}

function emptyBucket(): Bucket {
  return { byHost: new Map(), byToken: new Map(), generic: [] };
}

function push<K>(map: Map<K, NetworkFilter[]>, key: K, filter: NetworkFilter) {
  const list = map.get(key);
  if (list) list.push(filter);
  else map.set(key, [filter]);
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function tokenize(url: string): Set<string> {
  return new Set(url.toLowerCase().match(/[a-z0-9%]{2,}/g) ?? []);
}

function hostLabels(host: string): string[] {
  const labels = host.split('.');
  const result: string[] = [];
  for (let i = 0; i < labels.length - 1; i += 1) result.push(labels.slice(i).join('.'));
  return result;
}

export class FilterEngine {
  private readonly block = emptyBucket();
  private readonly allow = emptyBucket();
  private readonly documentExceptions: NetworkFilter[] = [];
  readonly size: number;

  constructor(filters: NetworkFilter[]) {
    for (const filter of filters) {
      if (filter.documentException) {
        this.documentExceptions.push(filter);
        continue;
      }
      const bucket = filter.exception ? this.allow : this.block;
      if (filter.hostname) push(bucket.byHost, filter.hostname, filter);
      else if (filter.token) push(bucket.byToken, filter.token, filter);
      else bucket.generic.push(filter);
    }
    this.size = filters.length;
  }

  /** ¿Desactiva alguna excepción $document el bloqueo en esta página? */
  isPageAllowed(pageUrl: string): boolean {
    const pageHost = safeHostname(pageUrl);
    return this.documentExceptions.some((filter) => this.filterMatches(filter, pageUrl, pageHost, 'document', pageHost, false));
  }

  match(request: RequestInfo): MatchResult {
    const requestHost = safeHostname(request.url);
    if (!requestHost || request.type === 'document') return { blocked: false, filter: null };
    const pageHost = safeHostname(request.pageUrl);
    const thirdParty = isThirdParty(requestHost, pageHost);
    const tokens = tokenize(request.url);
    const blocker = this.find(this.block, request, requestHost, pageHost, thirdParty, tokens);
    if (!blocker) return { blocked: false, filter: null };
    const exception = this.find(this.allow, request, requestHost, pageHost, thirdParty, tokens);
    if (exception || (request.pageUrl && this.isPageAllowed(request.pageUrl))) return { blocked: false, filter: exception };
    return { blocked: true, filter: blocker };
  }

  private find(
    bucket: Bucket,
    request: RequestInfo,
    requestHost: string,
    pageHost: string,
    thirdParty: boolean,
    tokens: Set<string>,
  ): NetworkFilter | null {
    for (const host of hostLabels(requestHost)) {
      for (const filter of bucket.byHost.get(host) ?? []) {
        if (this.filterMatches(filter, request.url, requestHost, request.type, pageHost, thirdParty)) return filter;
      }
    }
    for (const token of tokens) {
      for (const filter of bucket.byToken.get(token) ?? []) {
        if (this.filterMatches(filter, request.url, requestHost, request.type, pageHost, thirdParty)) return filter;
      }
    }
    for (const filter of bucket.generic) {
      if (this.filterMatches(filter, request.url, requestHost, request.type, pageHost, thirdParty)) return filter;
    }
    return null;
  }

  private filterMatches(
    filter: NetworkFilter,
    url: string,
    requestHost: string,
    type: ResourceType,
    pageHost: string,
    thirdParty: boolean,
  ): boolean {
    if (filter.types && !filter.types.has(type) && !filter.documentException) return false;
    if (filter.excludedTypes?.has(type)) return false;
    if (filter.thirdParty !== null && filter.thirdParty !== thirdParty) return false;
    if (filter.domains) {
      const { include, exclude } = filter.domains;
      if (include.length > 0 && !include.some((domain) => hostMatchesDomain(pageHost, domain))) return false;
      if (exclude.some((domain) => hostMatchesDomain(pageHost, domain))) return false;
    }
    if (filter.hostname) return hostMatchesDomain(requestHost, filter.hostname);
    return filter.regex ? filter.regex.test(url) : false;
  }
}
