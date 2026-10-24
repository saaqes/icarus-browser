/**
 * Dominio registrable (eTLD+1) según la Public Suffix List completa (secciones
 * ICANN y PRIVATE), usado para distinguir solicitudes de terceros y para
 * agrupar las excepciones por sitio. La lista se genera con
 * scripts/update-public-suffix-list.mjs. Ver docs/SHIELD.md.
 */

import { PUBLIC_SUFFIX_RULES } from './publicSuffixList';

interface SuffixRules {
  exact: Set<string>;
  /** Dominio padre de cada regla «*.dominio». */
  wildcard: Set<string>;
  /** Dominio de cada regla «!dominio». */
  exception: Set<string>;
}

let rules: SuffixRules | null = null;

function loadRules(): SuffixRules {
  if (rules) return rules;
  const exact = new Set<string>();
  const wildcard = new Set<string>();
  const exception = new Set<string>();
  for (const rule of PUBLIC_SUFFIX_RULES.split('\n')) {
    if (rule.startsWith('!')) exception.add(rule.slice(1));
    else if (rule.startsWith('*.')) wildcard.add(rule.slice(2));
    else exact.add(rule);
  }
  rules = { exact, wildcard, exception };
  return rules;
}

/**
 * Sufijo público de un nombre de host en minúsculas y ASCII (p. ej. «co.uk» para
 * «www.bbc.co.uk»). Se recorre de la etiqueta más larga a la más corta, así que
 * la primera regla que coincide es la que prevalece.
 */
export function getPublicSuffix(host: string): string {
  const { exact, wildcard, exception } = loadRules();
  const labels = host.split('.');
  for (let i = 0; i < labels.length; i += 1) {
    const candidate = labels.slice(i).join('.');
    // Una excepción («!www.ck») anula el comodín: el sufijo es lo que queda a su derecha.
    if (exception.has(candidate)) return labels.slice(i + 1).join('.');
    if (exact.has(candidate)) return candidate;
    if (i + 1 < labels.length && wildcard.has(labels.slice(i + 1).join('.'))) return candidate;
  }
  // Regla implícita «*»: el último nivel es el sufijo.
  return labels[labels.length - 1]!;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const CACHE_LIMIT = 4000;
const cache = new Map<string, string>();

export function getRegistrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host || IPV4.test(host) || host.includes(':') || host.startsWith('[')) return host;
  const cached = cache.get(host);
  if (cached !== undefined) return cached;
  const suffix = getPublicSuffix(host);
  // Si el propio host es un sufijo público (p. ej. «github.io»), no hay nada más que recortar.
  const domain = suffix === host ? host : host.split('.').slice(-(suffix.split('.').length + 1)).join('.');
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(host, domain);
  return domain;
}

export function isThirdParty(requestHost: string, pageHost: string): boolean {
  if (!pageHost) return false;
  return getRegistrableDomain(requestHost) !== getRegistrableDomain(pageHost);
}

/** ¿Es `host` igual a `domain` o un subdominio suyo? */
export function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}
