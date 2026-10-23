/**
 * Normalización y coincidencia de patrones de reglas de alias.
 *
 * Tipos de coincidencia:
 * - exact:  la URL real (sin fragmento #) es idéntica a la del patrón.
 * - prefix: la URL real empieza por el patrón, respetando límites de ruta
 *           (`/docs` coincide con `/docs/x` y `/docs?x`, no con `/docsx`).
 * - host:   el nombre de host coincide; `*.ejemplo.com` incluye ejemplo.com
 *           y todos sus subdominios. Se aplica a http y https.
 */

import type { AliasRule } from '../../types/alias';
import { isAliasHost, looksLikeHost, parseWebUrl } from '../url-resolution/urlUtils';

/** Forma canónica de una URL para comparar: protocolo + host + ruta + consulta. */
export function canonicalUrl(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}${url.search}`;
}

export interface HostPattern {
  wildcard: boolean;
  host: string;
}

/** Valida y normaliza un patrón de host (`www.ejemplo.com` o `*.ejemplo.com`). */
export function normalizeHostPattern(text: string): HostPattern | null {
  let value = text.trim().toLowerCase().replace(/\.$/, '');
  const wildcard = value.startsWith('*.');
  if (wildcard) value = value.slice(2);
  if (!value || value.includes('/') || value.includes(':') || !looksLikeHost(value)) return null;
  const parsed = parseWebUrl(`https://${value}/`);
  if (!parsed) return null;
  return { wildcard, host: parsed.hostname };
}

export function formatHostPattern(pattern: HostPattern): string {
  return `${pattern.wildcard ? '*.' : ''}${pattern.host}`;
}

export function hostPatternIsAlias(pattern: HostPattern): boolean {
  return isAliasHost(pattern.host);
}

export function ruleMatchesUrl(rule: Pick<AliasRule, 'matchType' | 'pattern'>, url: URL): boolean {
  switch (rule.matchType) {
    case 'exact':
      return canonicalUrl(url) === rule.pattern;
    case 'prefix': {
      const value = canonicalUrl(url);
      const prefix = rule.pattern;
      if (value === prefix) return true;
      if (!value.startsWith(prefix)) return false;
      if (prefix.endsWith('/')) return true;
      const next = value.charAt(prefix.length);
      return next === '/' || next === '?';
    }
    case 'host': {
      const pattern = normalizeHostPattern(rule.pattern);
      if (!pattern) return false;
      const hostname = url.hostname.toLowerCase();
      return hostname === pattern.host || (pattern.wildcard && hostname.endsWith(`.${pattern.host}`));
    }
  }
}

/**
 * Prioridad de una regla: cuanto más específica, mayor.
 * exacta > prefijo (más largo primero) > host concreto > host comodín.
 */
export function rulePriority(rule: Pick<AliasRule, 'matchType' | 'pattern'>): number {
  const length = rule.pattern.length;
  switch (rule.matchType) {
    case 'exact':
      return 4_000_000 + length;
    case 'prefix':
      return 3_000_000 + length;
    case 'host':
      return (rule.pattern.startsWith('*.') ? 1_000_000 : 2_000_000) + length;
  }
}

/** Orden de aplicación: negativa si `a` gana. En empate gana la regla más antigua. */
export function compareRules(a: AliasRule, b: AliasRule): number {
  const byPriority = rulePriority(b) - rulePriority(a);
  if (byPriority !== 0) return byPriority;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** URL representativa de una regla, usada para detectar solapamientos. */
export function sampleUrlForRule(rule: Pick<AliasRule, 'matchType' | 'pattern'>): URL | null {
  if (rule.matchType === 'host') {
    const pattern = normalizeHostPattern(rule.pattern);
    return pattern ? parseWebUrl(`https://${pattern.host}/`) : null;
  }
  return parseWebUrl(rule.pattern);
}
