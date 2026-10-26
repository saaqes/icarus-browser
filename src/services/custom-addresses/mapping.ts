/**
 * Aplicación de las direcciones personalizadas.
 *
 * - Mostrar (`displayUrlFor`): URL real dentro de un destino → la misma ruta,
 *   consulta y fragmento bajo la dirección personalizada. No navega a ningún sitio.
 * - Navegar (`resolveCustomAddress`): URL escrita dentro de una dirección
 *   personalizada → URL real equivalente del destino. Es un único paso: un destino
 *   nunca puede ser la dirección de otra entrada (ver la validación), así que no
 *   hay cadenas ni ciclos.
 *
 * Solo se aplican las entradas activas. Una entrada limitada a unas secciones
 * (`#home`) gana a la general del mismo sitio cuando la página está en una de ellas.
 * Si aun así varias abarcan la misma URL (datos importados antiguos), gana la de
 * ruta más larga y, en empate, la más antigua.
 */

import type { CustomAddress } from '../../types/customAddress';
import { parseWebUrl } from '../url-resolution/urlUtils';
import { parseLocation, remainderWithin, urlWithin, type Location } from './locations';
import { sectionOf } from './sections';

interface Parsed {
  entry: CustomAddress;
  target: Location;
  address: Location;
  sections: readonly string[];
}

const cache = new WeakMap<CustomAddress[], Parsed[]>();

/** Entradas activas y válidas, de la más específica a la menos. */
function active(entries: CustomAddress[]): Parsed[] {
  const cached = cache.get(entries);
  if (cached) return cached;
  const parsed = entries
    .filter((entry) => entry.enabled)
    .flatMap((entry) => {
      const target = parseLocation(entry.target);
      const address = parseLocation(entry.address);
      return target && address && target.protocol === address.protocol ? [{ entry, target, address, sections: entry.sections ?? [] }] : [];
    });
  parsed.sort(
    (a, b) =>
      b.target.path.length - a.target.path.length ||
      (a.entry.createdAt < b.entry.createdAt ? -1 : a.entry.createdAt > b.entry.createdAt ? 1 : 0),
  );
  cache.set(entries, parsed);
  return parsed;
}

export interface DisplayMatch {
  entry: CustomAddress;
  /** URL que se muestra en la barra (con la ruta, consulta y fragmento reales). */
  url: string;
}

/** Dirección que se muestra para una URL real, o null si no hay ninguna entrada para ella. */
export function displayUrlFor(href: string, entries: CustomAddress[]): DisplayMatch | null {
  const url = parseWebUrl(href);
  if (!url) return null;
  const section = sectionOf(url.hash);
  const items = active(entries);
  // Primero la entrada de la sección de la página; si no hay, la general del sitio.
  for (const item of [...items.filter((candidate) => section !== null && candidate.sections.includes(section)), ...items.filter((candidate) => candidate.sections.length === 0)]) {
    const rest = remainderWithin(item.target, url);
    if (rest !== null) return { entry: item.entry, url: urlWithin(item.address, rest, url) };
  }
  return null;
}

export interface CustomResolution {
  entry: CustomAddress;
  /** URL real a la que se navega. */
  url: string;
  /** La dirección escrita, con el protocolo de la entrada (el del destino). */
  address: string;
}

/**
 * Si `url` (ya interpretada desde lo que escribió el usuario) está dentro de una
 * dirección personalizada, devuelve la URL real equivalente. Con
 * `explicitProtocol` = false (el usuario no escribió `https://`), se acepta
 * cualquier protocolo. Escribir sin fragmento la dirección de una entrada de
 * secciones abre su primera sección (`otraweb.com` → `…/#home`).
 */
export function resolveCustomAddress(url: URL, entries: CustomAddress[], explicitProtocol: boolean): CustomResolution | null {
  const candidates = active(entries)
    .map((item) => ({ item, rest: remainderWithin(item.address, url, !explicitProtocol) }))
    .filter((candidate): candidate is { item: Parsed; rest: string } => candidate.rest !== null)
    .sort((a, b) => b.item.address.path.length - a.item.address.path.length);
  const best = candidates[0];
  if (!best) return null;
  const first = best.item.sections[0];
  const typed = new URL(url.href);
  if (first && !typed.hash) typed.hash = first;
  return { entry: best.item.entry, url: urlWithin(best.item.target, best.rest, typed), address: urlWithin(best.item.address, best.rest, typed) };
}

/** Entradas activas cuya dirección empieza por lo escrito (para sugerencias). */
export function addressesStartingWith(text: string, entries: CustomAddress[]): CustomAddress[] {
  const needle = text.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  if (!needle) return [];
  return active(entries)
    .filter(({ address }) => {
      const label = `${address.host}${address.path}`;
      return label.startsWith(needle) || label.replace(/^www\./, '').startsWith(needle);
    })
    .map(({ entry }) => entry);
}
