/**
 * Descarga de iconos de sitios desde el proceso principal. La interfaz de
 * ICARUS no carga contenido remoto: recibe los iconos como data URL.
 */

import type { Session } from 'electron';
import { parseNavigableUrl } from './urlPolicy';

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 6000;
const MAX_CACHE = 400;

export class FaviconService {
  private readonly cache = new Map<string, Promise<string | null>>();

  constructor(private readonly webSession: Session) {}

  /** Icono a partir de la URL del propio icono. */
  fetchIcon(iconUrl: string): Promise<string | null> {
    const url = parseNavigableUrl(iconUrl);
    if (!url) return Promise.resolve(null);
    const cached = this.cache.get(url.href);
    if (cached) return cached;
    const promise = this.download(url.href);
    this.cache.set(url.href, promise);
    if (this.cache.size > MAX_CACHE) this.cache.delete(this.cache.keys().next().value as string);
    return promise;
  }

  /** Icono predeterminado (/favicon.ico) del sitio de una página. */
  forPage(pageUrl: string): Promise<string | null> {
    const url = parseNavigableUrl(pageUrl);
    return url ? this.fetchIcon(`${url.origin}/favicon.ico`) : Promise.resolve(null);
  }

  private async download(href: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.webSession.fetch(href, { signal: controller.signal, redirect: 'follow' });
      if (!response.ok) return null;
      const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      const isImage = type.startsWith('image/') || /\.ico(\?|$)/i.test(href);
      if (!isImage) return null;
      const length = Number(response.headers.get('content-length') ?? 0);
      if (length > MAX_BYTES) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) return null;
      const mime = type.startsWith('image/') ? type : 'image/x-icon';
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
