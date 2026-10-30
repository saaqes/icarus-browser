/**
 * Iconos de los sitios, descargados desde el proceso principal. La interfaz de
 * ICARUS no carga contenido remoto: recibe los iconos como data URL.
 *
 * Se detectan solos, como en Chrome y Edge:
 * - Pestañas: los iconos que declara la página (`<link rel="icon">`), en orden,
 *   hasta encontrar uno que sea una imagen válida.
 * - Accesos directos, favoritos e historial: el icono que se vio al visitar el
 *   sitio (se recuerda por origen en favicons.json), después `/favicon.ico` y, si
 *   no existe, los `<link rel="icon">` de la página principal del sitio.
 *
 * Solo se aceptan imágenes reales de hasta 256 KB: el tipo se comprueba por su
 * firma (PNG, ICO, GIF, JPEG, WebP, BMP o SVG), no solo por la cabecera, de modo
 * que una página de error servida como `/favicon.ico` no se toma por un icono.
 */

import type { Session } from 'electron';
import { JsonFile } from './jsonFile';
import { parseNavigableUrl } from './urlPolicy';
import { isRecord } from './validate';

const MAX_BYTES = 256 * 1024;
/** Lo que se lee de una página para buscar sus iconos (el `<head>` suele estar al principio). */
const MAX_HTML_BYTES = 256 * 1024;
const TIMEOUT_MS = 6000;
const MAX_CACHE = 400;
const MAX_SITES = 1000;
const MAX_CANDIDATES = 6;
/** Tiempo durante el que no se vuelve a intentar un sitio sin icono. */
const RETRY_MS = 60_000;

/** Tipo de imagen según los primeros bytes, o null si no es una imagen reconocible. */
export function sniffImage(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0x00, 0x00, 0x01, 0x00) || starts(0x00, 0x00, 0x02, 0x00)) return 'image/x-icon';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  if (starts(0x42, 0x4d)) return 'image/bmp';
  // SVG: texto que empieza (tras una posible declaración XML o comentarios) con <svg.
  const text = Buffer.from(bytes.subarray(0, 1024)).toString('utf8').replace(/^﻿/, '').trimStart().toLowerCase();
  if (text.startsWith('<svg') || (/^<(\?xml|!--|!doctype svg)/.test(text) && text.includes('<svg'))) return 'image/svg+xml';
  return null;
}

/** Data URL de una imagen válida (o null). */
export function imageDataUrl(bytes: Uint8Array): string | null {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;
  const mime = sniffImage(bytes);
  return mime ? `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` : null;
}

/** Icono incrustado en la página (`data:image/png;base64,…`), comprobado como cualquier otro. */
export function decodeDataIcon(href: string): string | null {
  const match = /^data:image\/[a-z0-9.+-]+(;[^,]*)?,(.*)$/is.exec(href);
  if (!match || href.length > MAX_BYTES * 2) return null;
  const isBase64 = /;base64/i.test(match[1] ?? '');
  try {
    const bytes = isBase64 ? Buffer.from(match[2]!, 'base64') : Buffer.from(decodeURIComponent(match[2]!), 'utf8');
    return imageDataUrl(bytes);
  } catch {
    return null;
  }
}

function attributes(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of tag.matchAll(/([a-z_:][-a-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)) {
    const name = match[1]!.toLowerCase();
    if (!result.has(name)) result.set(name, match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}

const decodeEntities = (text: string) =>
  text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/**
 * Iconos que declara un documento HTML, en el orden en que se prueban: primero
 * `icon`/`shortcut icon` y después `apple-touch-icon`. Las direcciones relativas se
 * resuelven con `<base href>` o con la dirección final del documento.
 */
export function findIconLinks(html: string, documentUrl: string): string[] {
  const head = html.slice(0, MAX_HTML_BYTES);
  let baseUrl = documentUrl;
  const baseTag = /<base\b[^>]*>/i.exec(head);
  const baseHref = baseTag ? attributes(baseTag[0]).get('href') : undefined;
  if (baseHref) {
    try {
      baseUrl = new URL(decodeEntities(baseHref.trim()), documentUrl).href;
    } catch {
      // <base> no válido: se usa la dirección del documento.
    }
  }
  const icons: string[] = [];
  const touch: string[] = [];
  for (const match of head.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const rel = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
    const href = attrs.get('href')?.trim();
    if (!href) continue;
    const list = rel.includes('icon') ? icons : rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed') ? touch : null;
    if (!list) continue;
    const decoded = decodeEntities(href);
    if (/^data:/i.test(decoded)) {
      list.push(decoded);
      continue;
    }
    try {
      const resolved = new URL(decoded, baseUrl);
      if (parseNavigableUrl(resolved.href)) list.push(resolved.href);
    } catch {
      // Dirección no válida: se ignora.
    }
  }
  return [...new Set([...icons, ...touch])].slice(0, MAX_CANDIDATES);
}

/** Icono recordado de cada sitio visitado: origen → dirección del icono. */
type LearnedIcons = Record<string, string>;

export function sanitizeLearnedIcons(raw: unknown): LearnedIcons {
  const result: LearnedIcons = {};
  if (!isRecord(raw)) return result;
  for (const [origin, icon] of Object.entries(raw).slice(-MAX_SITES)) {
    if (typeof icon !== 'string' || icon.length > 2048 || origin.length > 300) continue;
    const site = parseNavigableUrl(origin);
    if (site && site.origin === origin && parseNavigableUrl(icon)) result[origin] = icon;
  }
  return result;
}

async function readLimited(response: Response, limit: number, truncate: boolean): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (!truncate && declared > limit) return null;
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      if (size > limit) {
        if (!truncate) return null;
        break;
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).subarray(0, limit);
}

export class FaviconService {
  /** Descargas por dirección del icono. */
  private readonly cache = new Map<string, Promise<string | null>>();
  /** Icono de cada sitio (origen) para accesos directos, favoritos e historial. */
  private readonly sites = new Map<string, Promise<string | null>>();
  private readonly learned: JsonFile<LearnedIcons> | null;

  constructor(
    private readonly webSession: Pick<Session, 'fetch'>,
    learnedPath?: string,
  ) {
    this.learned = learnedPath
      ? new JsonFile(learnedPath, { version: 1, defaults: () => ({}), sanitize: sanitizeLearnedIcons, delayMs: 500 })
      : null;
  }

  /** Icono a partir de la URL del propio icono (también `data:image/…`). */
  fetchIcon(iconUrl: string): Promise<string | null> {
    if (/^data:/i.test(iconUrl)) return Promise.resolve(decodeDataIcon(iconUrl));
    const url = parseNavigableUrl(iconUrl);
    if (!url) return Promise.resolve(null);
    const cached = this.cache.get(url.href);
    if (cached) return cached;
    const promise = this.download(url.href);
    this.cache.set(url.href, promise);
    if (this.cache.size > MAX_CACHE) this.cache.delete(this.cache.keys().next().value as string);
    return promise;
  }

  /**
   * Icono de una pestaña: prueba en orden los iconos que declara la página y
   * recuerda para el sitio el primero que funciona.
   */
  async fetchPageIcon(pageUrl: string, candidates: readonly string[]): Promise<string | null> {
    for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
      const icon = await this.fetchIcon(candidate);
      if (!icon) continue;
      this.remember(pageUrl, candidate, icon);
      return icon;
    }
    return null;
  }

  /** Icono del sitio de una página (accesos directos, favoritos, historial). */
  forPage(pageUrl: string): Promise<string | null> {
    const url = parseNavigableUrl(pageUrl);
    if (!url) return Promise.resolve(null);
    const origin = url.origin;
    const cached = this.sites.get(origin);
    if (cached) return cached;
    const promise = this.findSiteIcon(origin).then((icon) => {
      // Sin icono se vuelve a intentar más tarde (el sitio puede no estar disponible ahora).
      if (!icon) setTimeout(() => this.sites.get(origin) === promise && this.sites.delete(origin), RETRY_MS).unref?.();
      return icon;
    });
    this.sites.set(origin, promise);
    if (this.sites.size > MAX_CACHE) this.sites.delete(this.sites.keys().next().value as string);
    return promise;
  }

  /** Olvida los iconos recordados (al borrar el historial). */
  clear(): void {
    this.sites.clear();
    this.cache.clear();
    this.learned?.set({});
  }

  flush(): void {
    this.learned?.flush();
  }

  private remember(pageUrl: string, iconUrl: string, icon: string): void {
    const origin = parseNavigableUrl(pageUrl)?.origin;
    if (!origin) return;
    this.sites.set(origin, Promise.resolve(icon));
    // Los iconos incrustados (data:) no se guardan: se vuelven a ver al visitar el sitio.
    if (!this.learned || !parseNavigableUrl(iconUrl)) return;
    const data = { ...this.learned.get() };
    if (data[origin] === iconUrl) return;
    delete data[origin];
    data[origin] = iconUrl;
    const origins = Object.keys(data);
    for (const old of origins.slice(0, Math.max(0, origins.length - MAX_SITES))) delete data[old];
    this.learned.set(data);
  }

  private async findSiteIcon(origin: string): Promise<string | null> {
    const learned = this.learned?.get()[origin];
    if (learned) {
      const icon = await this.fetchIcon(learned);
      if (icon) return icon;
    }
    const ico = await this.fetchIcon(`${origin}/favicon.ico`);
    if (ico) return ico;
    for (const candidate of await this.discover(`${origin}/`)) {
      const icon = await this.fetchIcon(candidate);
      if (icon) return icon;
    }
    return null;
  }

  /** Iconos que declara la página principal del sitio. */
  private async discover(pageUrl: string): Promise<string[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.webSession.fetch(pageUrl, { signal: controller.signal, redirect: 'follow', headers: { accept: 'text/html' } });
      const type = (response.headers.get('content-type') ?? '').toLowerCase();
      if (!response.ok || !type.includes('html')) return [];
      const bytes = await readLimited(response, MAX_HTML_BYTES, true);
      return bytes ? findIconLinks(Buffer.from(bytes).toString('utf8'), response.url || pageUrl) : [];
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  private async download(href: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.webSession.fetch(href, { signal: controller.signal, redirect: 'follow' });
      if (!response.ok) return null;
      const bytes = await readLimited(response, MAX_BYTES, false);
      return bytes ? imageDataUrl(bytes) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
