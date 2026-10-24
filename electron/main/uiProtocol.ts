/**
 * Protocolo interno `icarus-app://ui/` que sirve la interfaz compilada (dist/).
 * Evita `file://`, impide salir de la carpeta de la interfaz y añade una
 * política de seguridad de contenido estricta: la interfaz privilegiada no
 * puede cargar scripts, estilos ni imágenes remotos.
 */

import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { protocol, type Session } from 'electron';

export const UI_SCHEME = 'icarus-app';
export const UI_ORIGIN = `${UI_SCHEME}://ui`;
export const UI_ENTRY = `${UI_ORIGIN}/index.html`;

export const UI_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

/** Debe llamarse antes de que la aplicación esté lista. */
export function registerUiScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: UI_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: false } },
  ]);
}

export function serveUi(uiSession: Session, distDir: string): void {
  const root = normalize(distDir);
  uiSession.protocol.handle(UI_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'ui') return new Response('No encontrado', { status: 404 });
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const filePath = normalize(join(root, pathname));
    if (!filePath.startsWith(root + sep)) return new Response('Prohibido', { status: 403 });
    try {
      const body = await readFile(filePath);
      return new Response(body, {
        headers: {
          'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
          'content-security-policy': UI_CONTENT_SECURITY_POLICY,
          'x-content-type-options': 'nosniff',
          'cross-origin-opener-policy': 'same-origin',
        },
      });
    } catch {
      return new Response('No encontrado', { status: 404 });
    }
  });
}
