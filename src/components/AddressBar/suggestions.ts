/**
 * Sugerencias de la barra de direcciones: la acción principal, direcciones
 * personalizadas que empiezan por lo escrito, favoritos, accesos directos e historial.
 *
 * Los accesos directos y el historial se comparan y se muestran con la dirección
 * visible (la personalizada si existe), igual que la barra.
 */

import type { Bookmark } from '../../types/bookmarks';
import type { CustomAddress } from '../../types/customAddress';
import type { HistoryItem } from '../../types/native';
import type { Shortcut } from '../../types/shortcuts';
import { shortAddress } from '../../services/custom-addresses/display';
import { addressesStartingWith, displayUrlFor } from '../../services/custom-addresses/mapping';
import { resolveInput, type InputResolution, type ResolveContext } from '../../services/url-resolution/resolveInput';

export type Suggestion =
  | { id: string; kind: 'primary'; resolution: InputResolution; text: string }
  | { id: string; kind: 'address'; entry: CustomAddress }
  | { id: string; kind: 'bookmark'; bookmark: Bookmark }
  | { id: string; kind: 'shortcut'; shortcut: Shortcut }
  | { id: string; kind: 'history'; item: HistoryItem };

/** Dirección visible de una URL real (personalizada si hay una entrada para ella). */
export function visibleAddress(url: string, customAddresses: CustomAddress[]): string {
  return displayUrlFor(url, customAddresses)?.url ?? url;
}

export function buildSuggestions(
  text: string,
  context: ResolveContext & { shortcuts: Shortcut[]; history?: HistoryItem[]; bookmarks?: Bookmark[] },
  limit = 6,
): Suggestion[] {
  const value = text.trim();
  if (!value) return [];
  const needle = value.toLowerCase();
  const resolution = resolveInput(value, context);
  const items: Suggestion[] = [{ id: 'primary', kind: 'primary', resolution, text: value }];
  const matches = (title: string, url: string) =>
    title.toLowerCase().includes(needle) || shortAddress(visibleAddress(url, context.customAddresses)).toLowerCase().includes(needle);

  addressesStartingWith(value, context.customAddresses)
    .filter((entry) => !(resolution.kind === 'custom' && resolution.entry.id === entry.id))
    .slice(0, 2)
    .forEach((entry) => items.push({ id: `address-${entry.id}`, kind: 'address', entry }));

  (context.bookmarks ?? [])
    .filter((bookmark) => matches(bookmark.title, bookmark.url))
    .slice(0, 2)
    .forEach((bookmark) => items.push({ id: `bookmark-${bookmark.id}`, kind: 'bookmark', bookmark }));

  const urlOf = (item: Suggestion) => (item.kind === 'shortcut' ? [item.shortcut.url] : item.kind === 'bookmark' ? [item.bookmark.url] : []);
  context.shortcuts
    .filter((shortcut) => matches(shortcut.title, shortcut.url) && !items.some((item) => urlOf(item).includes(shortcut.url)))
    .slice(0, 3)
    .forEach((shortcut) => items.push({ id: `shortcut-${shortcut.id}`, kind: 'shortcut', shortcut }));

  const seen = new Set(items.flatMap(urlOf));
  for (const entry of context.history ?? []) {
    if (items.length >= limit) break;
    if (seen.has(entry.url) || !matches(entry.title, entry.url)) continue;
    seen.add(entry.url);
    items.push({ id: `history-${entry.id}`, kind: 'history', item: entry });
  }

  return items.slice(0, limit);
}
