/**
 * Resolución de reglas de alias.
 *
 * - Presentación: URL real → alias visual (`findAliasMatch`). No redirige.
 * - Navegación: alias escrito → URL de destino de una regla activa
 *   (`resolveTypedAlias`). Es un único paso: los destinos nunca pueden ser
 *   alias, así que no hay cadenas ni ciclos de redirección.
 */

import type { AliasConflict, AliasMatch, AliasRule } from '../../types/alias';
import { isAliasHost, parseWebUrl } from '../url-resolution/urlUtils';
import { canonicalUrl, compareRules, ruleMatchesUrl, sampleUrlForRule } from './patterns';
import { isAliasText, normalizeAliasText } from './validation';

export function findAliasMatch(href: string, rules: AliasRule[]): AliasMatch | null {
  const url = parseWebUrl(href);
  if (!url || isAliasHost(url.hostname)) return null;
  const winner = rules
    .filter((rule) => rule.enabled && ruleMatchesUrl(rule, url))
    .sort(compareRules)[0];
  return winner ? { rule: winner, realUrl: canonicalUrl(url) } : null;
}

export type TypedAliasResolution =
  | { status: 'not-alias' }
  | { status: 'resolved'; rule: AliasRule; url: string }
  | { status: 'disabled'; alias: string; rule: AliasRule }
  | { status: 'unknown'; alias: string };

export function resolveTypedAlias(text: string, rules: AliasRule[]): TypedAliasResolution {
  if (!isAliasText(text)) return { status: 'not-alias' };
  const alias = normalizeAliasText(text);
  const candidates = rules.filter((rule) => rule.alias === alias);
  const active = candidates.filter((rule) => rule.enabled).sort(compareRules)[0];
  if (active) {
    const target = parseWebUrl(active.targetUrl);
    // Defensa adicional ante datos manipulados: el destino debe ser una URL web real.
    if (target && !isAliasHost(target.hostname)) return { status: 'resolved', rule: active, url: target.href };
    return { status: 'unknown', alias };
  }
  const disabled = candidates[0];
  if (disabled) return { status: 'disabled', alias, rule: disabled };
  return { status: 'unknown', alias };
}

/**
 * Detecta conflictos entre reglas activas:
 * - duplicate-alias: dos reglas activas usan el mismo alias.
 * - duplicate-pattern: mismo tipo y mismo patrón.
 * - overlap: una regla coincide con direcciones de otra.
 * En todos los casos se indica qué regla se aplica según `compareRules`.
 */
export function detectConflicts(rules: AliasRule[]): AliasConflict[] {
  const active = rules.filter((rule) => rule.enabled);
  const conflicts: AliasConflict[] = [];
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i]!;
      const b = active[j]!;
      const [winner, loser] = compareRules(a, b) <= 0 ? [a, b] : [b, a];
      if (a.alias === b.alias) {
        conflicts.push({ type: 'duplicate-alias', winnerId: winner.id, loserId: loser.id });
      }
      if (a.matchType === b.matchType && a.pattern === b.pattern) {
        conflicts.push({ type: 'duplicate-pattern', winnerId: winner.id, loserId: loser.id });
        continue;
      }
      const sampleA = sampleUrlForRule(a);
      const sampleB = sampleUrlForRule(b);
      const overlaps = (sampleB !== null && ruleMatchesUrl(a, sampleB)) || (sampleA !== null && ruleMatchesUrl(b, sampleA));
      if (overlaps) conflicts.push({ type: 'overlap', winnerId: winner.id, loserId: loser.id });
    }
  }
  return conflicts;
}

export function conflictsForRule(ruleId: string, conflicts: AliasConflict[]): AliasConflict[] {
  return conflicts.filter((conflict) => conflict.winnerId === ruleId || conflict.loserId === ruleId);
}
