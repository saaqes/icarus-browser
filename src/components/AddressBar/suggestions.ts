/** Sugerencias de la barra de direcciones (acción principal + accesos y alias que coinciden). */

import type { AliasRule } from '../../types/alias';
import type { Shortcut } from '../../types/shortcuts';
import { resolveInput, type InputResolution, type ResolveContext } from '../../services/url-resolution/resolveInput';

export type Suggestion =
  | { id: string; kind: 'primary'; resolution: InputResolution; text: string }
  | { id: string; kind: 'shortcut'; shortcut: Shortcut }
  | { id: string; kind: 'alias'; rule: AliasRule };

export function buildSuggestions(
  text: string,
  context: ResolveContext & { shortcuts: Shortcut[] },
  limit = 6,
): Suggestion[] {
  const value = text.trim();
  if (!value) return [];
  const needle = value.toLowerCase();
  const resolution = resolveInput(value, context);
  const items: Suggestion[] = [{ id: 'primary', kind: 'primary', resolution, text: value }];

  context.rules
    .filter(
      (rule) =>
        rule.enabled &&
        (rule.alias.startsWith(needle) || rule.displayName.toLowerCase().includes(needle)) &&
        !(resolution.kind === 'alias' && resolution.rule.id === rule.id),
    )
    .slice(0, 2)
    .forEach((rule) => items.push({ id: `alias-${rule.id}`, kind: 'alias', rule }));

  context.shortcuts
    .filter((shortcut) => shortcut.title.toLowerCase().includes(needle) || shortcut.url.toLowerCase().includes(needle))
    .slice(0, 3)
    .forEach((shortcut) => items.push({ id: `shortcut-${shortcut.id}`, kind: 'shortcut', shortcut }));

  return items.slice(0, limit);
}
