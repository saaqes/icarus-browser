/**
 * Edición de la base de una dirección conservando el resto.
 *
 * Una dirección se divide en dos partes:
 * - Base: la dirección personalizada de la entrada que se está mostrando (p. ej.
 *   `https://miweb.com` o `https://miweb.com/app`) o, si no hay ninguna, el origen
 *   (`https://ejemplo.com`, `http://localhost:3000`).
 * - Sufijo: la ruta, la consulta y el fragmento que identifican la sección actual
 *   (`/#inicio`, `/panel/usuarios?id=10`), tal como los muestra la barra.
 *
 * «Editar la base» sustituye solo la primera parte y vuelve a añadir el sufijo sin
 * duplicar barras, consultas ni fragmentos. Es distinto de escribir una dirección
 * nueva, que nunca hereda la ruta anterior (ver `classifyAddressEdit`).
 *
 * Funciones puras compartidas con Android e iPhone mediante
 * mobile/shared/test-vectors/address-rebase.json.
 */

import type { CustomAddress } from '../../types/customAddress';
import { parseWebUrl } from '../url-resolution/urlUtils';
import { normalizeLocationInput, parseLocation, remainderWithin, type LocationError } from './locations';

export interface AddressSplit {
  /** Base editable, sin barra final: `https://miweb.com` o `https://miweb.com/app`. */
  base: string;
  /** Parte que se conserva al cambiar la base (vacía si la página es la raíz sin consulta ni fragmento). */
  suffix: string;
  /** Dirección personalizada a la que pertenece la base, si la página se muestra con una. */
  entry: CustomAddress | null;
}

/**
 * Divide la dirección que muestra la barra. `entry` es la dirección personalizada
 * aplicada a la página (la de `describePage`): solo entonces la base es la de la
 * entrada; si no, es el origen de la URL.
 */
export function splitAddress(displayUrl: string, entry: CustomAddress | null): AddressSplit | null {
  const url = parseWebUrl(displayUrl);
  if (!url || url.username || url.password) return null;
  const location = entry ? parseLocation(entry.address) : null;
  const rest = location ? remainderWithin(location, url) : null;
  if (location && rest !== null) {
    // En la raíz, la ruta `/` forma parte del sufijo: `/#inicio`, nunca `#inicio`.
    const path = !location.path && !rest && (url.search || url.hash) ? '/' : rest;
    return { base: `${location.protocol}//${location.host}${location.path}`, suffix: `${path}${url.search}${url.hash}`, entry };
  }
  const suffix = `${url.pathname}${url.search}${url.hash}`;
  return { base: `${url.protocol}//${url.host}`, suffix: suffix === '/' ? '' : suffix, entry: null };
}

export type RebaseResult = { ok: true; url: string } | { ok: false; error: LocationError };

/**
 * Une una base nueva (como la escribe el usuario: `otrapagina.com`,
 * `https://otrapagina.com/`, `localhost:3000`, `ejemplo.com/app`) con el sufijo
 * conservado. La base no puede llevar consulta ni fragmento: esos los aporta el sufijo.
 */
export function joinBase(baseText: string, suffix: string): RebaseResult {
  const base = normalizeLocationInput(baseText);
  if (!base.ok) return base;
  const { protocol, host, path } = base.location;
  let tail: string;
  if (!suffix) tail = path || '/';
  else if (suffix.startsWith('/')) tail = `${path}${suffix}`;
  else tail = `${path || '/'}${suffix}`;
  const url = parseWebUrl(`${protocol}//${host}${tail}`);
  return url ? { ok: true, url: url.href } : { ok: false, error: 'invalid-url' };
}

export type AddressEdit =
  /** Se cambió solo la base: el texto sigue terminando en el sufijo de la página. */
  | { kind: 'rebase'; base: string; url: string }
  /** Cualquier otra cosa: se navega a lo escrito tal cual, sin añadir rutas. */
  | { kind: 'navigate' };

/**
 * Distingue editar la base de escribir otra dirección. Solo es una edición de la
 * base si el texto conserva exactamente el sufijo de la página, delante hay una
 * base válida y es distinta de la actual. Lo escrito nunca se modifica: esta
 * función solo sirve para ofrecer guardar la base nueva en la dirección
 * personalizada.
 */
export function classifyAddressEdit(original: AddressSplit, typed: string): AddressEdit {
  const text = typed.trim();
  if (!original.suffix || !text.endsWith(original.suffix)) return { kind: 'navigate' };
  const prefix = text.slice(0, text.length - original.suffix.length);
  if (!prefix) return { kind: 'navigate' };
  const base = normalizeLocationInput(prefix);
  if (!base.ok) return { kind: 'navigate' };
  const current = normalizeLocationInput(original.base);
  if (current.ok && sameLocation(current.location, base.location, !/^[a-z][a-z0-9+.-]*:\/\//i.test(prefix))) return { kind: 'navigate' };
  const joined = joinBase(prefix, original.suffix);
  return joined.ok ? { kind: 'rebase', base: prefix, url: joined.url } : { kind: 'navigate' };
}

function sameLocation(a: { protocol: string; host: string; path: string }, b: { protocol: string; host: string; path: string }, ignoreProtocol: boolean) {
  return a.host === b.host && a.path === b.path && (ignoreProtocol || a.protocol === b.protocol);
}
