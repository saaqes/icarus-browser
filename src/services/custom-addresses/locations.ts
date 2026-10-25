/**
 * Ubicaciones de las direcciones personalizadas: `protocolo://host[:puerto]` más
 * una ruta base, sin consulta ni fragmento.
 *
 * Una ubicación abarca su ruta y todo lo que cuelga de ella: `/docs` abarca
 * `/docs`, `/docs/`, `/docs/guia` y `/docs?x`, pero no `/docsx`. La ruta raíz
 * abarca todo el sitio.
 */

import { getProtocol, isDangerousProtocol, isIpLiteral, isLoopbackHost, looksLikeHost, parseWebUrl } from '../url-resolution/urlUtils';

export type WebProtocol = 'http:' | 'https:';

export interface Location {
  protocol: WebProtocol;
  /** Host en minúsculas con puerto si no es el predeterminado. */
  host: string;
  /** Ruta base sin barra final; cadena vacía para todo el sitio. */
  path: string;
}

export type LocationError = 'required' | 'invalid-url' | 'unsupported-protocol' | 'has-query';

export type LocationResult = { ok: true; location: Location } | { ok: false; error: LocationError };

function basePath(pathname: string): string {
  return pathname.replace(/\/+$/, '');
}

function fromUrl(url: URL): Location {
  return { protocol: url.protocol as WebProtocol, host: url.host, path: basePath(url.pathname) };
}

/** Forma guardada de una ubicación: `https://miweb.com/` o `https://miweb.com/ruta`. */
export function formatLocation(location: Location): string {
  return `${location.protocol}//${location.host}${location.path || '/'}`;
}

/** Lee una ubicación ya guardada (forma canónica). */
export function parseLocation(text: string): Location | null {
  const url = parseWebUrl(text);
  if (!url || url.username || url.password || url.search || url.hash) return null;
  return fromUrl(url);
}

/**
 * Normaliza lo que escribe el usuario en el editor. Acepta `miweb.com`,
 * `localhost:3000`, `https://ejemplo.com/ruta`… Sin protocolo se usa
 * `defaultProtocol` (el del destino, para la dirección personalizada) o, si no se
 * indica, https (http para localhost y direcciones IP, como en la barra).
 */
export function normalizeLocationInput(text: string, defaultProtocol?: WebProtocol): LocationResult {
  const value = text.trim();
  if (!value) return { ok: false, error: 'required' };
  if (/\s/.test(value)) return { ok: false, error: 'invalid-url' };
  if (/[?#]/.test(value)) return { ok: false, error: 'has-query' };

  const protocol = getProtocol(value);
  const hostWithPort = protocol !== null && /^[^:/]+:\d+(?:\/|$)/.test(value);
  let candidate = value;
  if (protocol && !hostWithPort) {
    if (isDangerousProtocol(protocol) || (protocol !== 'http:' && protocol !== 'https:')) {
      return { ok: false, error: 'unsupported-protocol' };
    }
  } else {
    const hostPart = value.split('/')[0] ?? '';
    if (!looksLikeHost(hostPart)) return { ok: false, error: 'invalid-url' };
    const bareHost = hostPart.replace(/:\d+$/, '');
    const fallback: WebProtocol = isLoopbackHost(bareHost) || isIpLiteral(bareHost) ? 'http:' : 'https:';
    candidate = `${defaultProtocol ?? fallback}//${value}`;
  }

  const url = parseWebUrl(candidate);
  if (!url || url.username || url.password) return { ok: false, error: 'invalid-url' };
  // `new URL` acepta hosts que nadie escribiría (p. ej. `https://-a/`): se exige un host real.
  if (!looksLikeHost(url.host)) return { ok: false, error: 'invalid-url' };
  return { ok: true, location: fromUrl(url) };
}

/**
 * Si `url` está dentro de `location`, devuelve el resto de la ruta (vacío o
 * empezando por `/`). Con `anyProtocol` no se compara el protocolo.
 */
export function remainderWithin(location: Location, url: URL, anyProtocol = false): string | null {
  if (!anyProtocol && url.protocol !== location.protocol) return null;
  if (url.host !== location.host || url.username || url.password) return null;
  const { pathname } = url;
  if (!location.path) return pathname === '/' ? '' : pathname;
  if (pathname === location.path) return '';
  return pathname.startsWith(`${location.path}/`) ? pathname.slice(location.path.length) : null;
}

/** Construye la URL equivalente bajo otra ubicación. */
export function urlWithin(location: Location, rest: string, url: URL): string {
  return `${location.protocol}//${location.host}${location.path + rest || '/'}${url.search}${url.hash}`;
}

/** ¿Comparten alguna dirección? Se ignora el protocolo: `miweb.com` escrito sin él podría ser cualquiera. */
export function locationsOverlap(a: Location, b: Location): boolean {
  if (a.host !== b.host) return false;
  const [shorter, longer] = a.path.length <= b.path.length ? [a.path, b.path] : [b.path, a.path];
  return !shorter || longer === shorter || longer.startsWith(`${shorter}/`);
}

/** Host para mostrar al usuario (sin el puerto predeterminado). */
export function locationLabel(location: Location): string {
  return `${location.host}${location.path}`;
}
