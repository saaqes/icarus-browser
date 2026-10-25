/**
 * Dónde se buscan el manifiesto y los paquetes, y cómo se descargan.
 *
 * Las URL se construyen aquí a partir de la etiqueta y del nombre de archivo ya
 * validados; una respuesta manipulada no puede llevar a la aplicación a otra
 * dirección. Las redirecciones solo se siguen hacia hosts de la lista (HTTPS).
 */

import { ALLOWED_DOWNLOAD_HOSTS, API_HOST, MANIFEST_FILE, SIGNATURE_FILE, UPDATE_REPOSITORY } from './config';
import { compareVersions, parseVersion } from './version';

export interface FetchInit {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  redirect?: 'manual' | 'follow';
}
/** `fetch` inyectable: `net.fetch` de Electron en la aplicación, `fetch` de Node en las pruebas. */
export type FetchLike = (url: string, init?: FetchInit) => Promise<Response>;

export interface UpdateSource {
  /** URL de un archivo de una versión publicada. */
  assetUrl(tag: string, file: string): string;
  /** Manifiesto y firma de la última versión estable (sin usar la API). */
  latestStable(): { manifest: string; signature: string };
  /** Lista de versiones (incluidas las preliminares) para el canal preliminar. */
  releasesListUrl(): string;
  isAllowedUrl(url: URL): boolean;
  /** Página pública de una versión (para las plataformas sin instalación integrada). */
  releasePage(tag: string): string;
}

const TAG = /^v[0-9]+\.[0-9]+\.[0-9]+(?:-preview\.[0-9]+)?$/;
const FILE = /^[A-Za-z0-9._-]{1,120}$/;

function checked(tag: string, file: string): void {
  if (!TAG.test(tag)) throw new Error(`Etiqueta no válida: ${tag}`);
  if (!FILE.test(file) || file.includes('..')) throw new Error(`Nombre de archivo no válido: ${file}`);
}

export function githubSource(repository = UPDATE_REPOSITORY): UpdateSource {
  const base = `https://github.com/${repository}`;
  return {
    assetUrl: (tag, file) => {
      checked(tag, file);
      return `${base}/releases/download/${tag}/${file}`;
    },
    latestStable: () => ({ manifest: `${base}/releases/latest/download/${MANIFEST_FILE}`, signature: `${base}/releases/latest/download/${SIGNATURE_FILE}` }),
    releasesListUrl: () => `https://${API_HOST}/repos/${repository}/releases?per_page=30`,
    isAllowedUrl: (url) => url.protocol === 'https:' && !url.username && !url.password && !url.port && [...ALLOWED_DOWNLOAD_HOSTS, API_HOST].includes(url.hostname),
    releasePage: (tag) => {
      checked(tag, MANIFEST_FILE);
      return `${base}/releases/tag/${tag}`;
    },
  };
}

/**
 * Servidor local con la misma estructura que GitHub, solo para pruebas
 * (ICARUS_UPDATE_FEED=http://127.0.0.1:PUERTO). Únicamente se aceptan direcciones
 * de la propia máquina.
 */
export function loopbackSource(feed: string): UpdateSource | null {
  let root: URL;
  try {
    root = new URL(feed);
  } catch {
    return null;
  }
  if (root.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(root.hostname) || root.username || root.password) return null;
  const base = `${root.origin}`;
  return {
    assetUrl: (tag, file) => {
      checked(tag, file);
      return `${base}/releases/download/${tag}/${file}`;
    },
    latestStable: () => ({ manifest: `${base}/releases/latest/download/${MANIFEST_FILE}`, signature: `${base}/releases/latest/download/${SIGNATURE_FILE}` }),
    releasesListUrl: () => `${base}/api/releases`,
    isAllowedUrl: (url) => url.origin === root.origin,
    releasePage: (tag) => `${base}/releases/tag/${tag}`,
  };
}

export class UpdateHttpError extends Error {
  constructor(
    readonly code: 'network' | 'not-found' | 'rate-limited' | 'forbidden-host' | 'too-large' | 'http',
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

/** GET que sigue como mucho 5 redirecciones, todas hacia hosts permitidos. */
export async function fetchAllowed(fetchImpl: FetchLike, source: UpdateSource, url: string, init: FetchInit = {}): Promise<Response> {
  let current = new URL(url);
  for (let hop = 0; hop <= 5; hop++) {
    if (!source.isAllowedUrl(current)) throw new UpdateHttpError('forbidden-host', `Host no permitido: ${current.host}`);
    let response: Response;
    try {
      response = await fetchImpl(current.href, { ...init, redirect: 'manual' });
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      throw new UpdateHttpError('network', (error as Error).message);
    }
    // Si el motor siguió la redirección por su cuenta, se comprueba el destino final.
    if (response.redirected && response.url && !source.isAllowedUrl(new URL(response.url))) {
      throw new UpdateHttpError('forbidden-host', `Host no permitido: ${new URL(response.url).host}`);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new UpdateHttpError('http', `Redirección sin destino (${response.status})`, response.status);
      current = new URL(location, current);
      continue;
    }
    if (response.status === 404) throw new UpdateHttpError('not-found', 'No encontrado', 404);
    if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
      throw new UpdateHttpError('rate-limited', 'Límite de consultas de GitHub alcanzado', response.status);
    }
    return response;
  }
  throw new UpdateHttpError('http', 'Demasiadas redirecciones');
}

/** Lee como mucho `max` bytes del cuerpo (para el manifiesto y la firma). */
export async function readLimited(response: Response, max: number): Promise<Uint8Array> {
  if (!response.ok) throw new UpdateHttpError('http', `HTTP ${response.status}`, response.status);
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new UpdateHttpError('too-large', 'Respuesta demasiado grande');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Etiqueta de la versión más reciente con manifiesto, incluidas las preliminares
 * (la API nunca devuelve borradores sin autenticación, y aun así se descartan).
 */
export function pickNewestTag(list: unknown): string | null {
  if (!Array.isArray(list)) return null;
  let best: { tag: string; version: NonNullable<ReturnType<typeof parseVersion>> } | null = null;
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const release = item as { tag_name?: unknown; draft?: unknown; assets?: unknown };
    if (release.draft !== false || typeof release.tag_name !== 'string' || !release.tag_name.startsWith('v')) continue;
    const version = parseVersion(release.tag_name.slice(1));
    if (!version || !TAG.test(release.tag_name)) continue;
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const names = assets.map((asset) => (typeof asset === 'object' && asset !== null ? (asset as { name?: unknown }).name : null));
    if (!names.includes(MANIFEST_FILE) || !names.includes(SIGNATURE_FILE)) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { tag: release.tag_name, version };
  }
  return best?.tag ?? null;
}
