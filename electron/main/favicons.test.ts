// @vitest-environment node
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeDataIcon, FaviconService, findIconLinks, sanitizeLearnedIcons, sniffImage } from './favicons';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const ICO = Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0]);
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>');

/** Sesión falsa: responde con las rutas indicadas y anota lo que se pide. */
function fakeSession(routes: Record<string, { type?: string; body: Buffer | string; status?: number }>) {
  const requested: string[] = [];
  return {
    requested,
    fetch: async (input: string | Request) => {
      const url = typeof input === 'string' ? input : input.url;
      requested.push(url);
      const route = routes[url];
      const response = route
        ? new Response(typeof route.body === 'string' ? route.body : new Uint8Array(route.body), { status: route.status ?? 200, headers: route.type ? { 'content-type': route.type } : {} })
        : new Response('No encontrado', { status: 404, headers: { 'content-type': 'text/html' } });
      Object.defineProperty(response, 'url', { value: url });
      return response;
    },
  };
}

describe('iconos de los sitios', () => {
  it('reconoce las imágenes por su firma, no por la cabecera', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(ICO)).toBe('image/x-icon');
    expect(sniffImage(SVG)).toBe('image/svg+xml');
    expect(sniffImage(Buffer.from('GIF89a'))).toBe('image/gif');
    expect(sniffImage(Buffer.from('<!doctype html><title>404</title>'))).toBeNull();
    expect(sniffImage(Buffer.from(''))).toBeNull();
  });

  it('acepta iconos incrustados válidos y rechaza los que no son imágenes', () => {
    expect(decodeDataIcon(`data:image/png;base64,${PNG.toString('base64')}`)).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(decodeDataIcon(`data:image/svg+xml,${encodeURIComponent(SVG.toString())}`)).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(decodeDataIcon('data:image/png;base64,PGh0bWw+')).toBeNull();
    expect(decodeDataIcon('data:text/html,<script>')).toBeNull();
  });

  it('encuentra los <link rel="icon"> en orden y resuelve las rutas relativas', () => {
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" href="/estilo.css">
      <link rel="apple-touch-icon" href="/touch.png">
      <link href='static/marca.svg' rel='icon' type='image/svg+xml'>
      <LINK REL="Shortcut Icon" HREF="https://cdn.ejemplo.com/i.ico?v=1&amp;b=2">
      <link rel="icon" href="javascript:alert(1)">
      <link rel="icon" href="data:image/png;base64,AAAA">
    </head><body></body></html>`;
    expect(findIconLinks(html, 'https://ejemplo.com/panel/inicio')).toEqual([
      'https://ejemplo.com/panel/static/marca.svg',
      'https://cdn.ejemplo.com/i.ico?v=1&b=2',
      'data:image/png;base64,AAAA',
      'https://ejemplo.com/touch.png',
    ]);
    expect(findIconLinks('<base href="https://otro.com/raiz/"><link rel=icon href=i.png>', 'https://ejemplo.com/')).toEqual(['https://otro.com/raiz/i.png']);
  });

  it('prueba los iconos de la página en orden y recuerda el que funciona para el sitio', async () => {
    const session = fakeSession({
      'https://ejemplo.com/roto.png': { type: 'image/png', body: '<html>error</html>' },
      // Servido sin tipo de imagen: vale porque es un PNG de verdad.
      'https://ejemplo.com/bueno': { type: 'application/octet-stream', body: PNG },
    });
    const path = join(mkdtempSync(join(tmpdir(), 'icarus-iconos-')), 'favicons.json');
    const service = new FaviconService(session, path);
    const icon = await service.fetchPageIcon('https://ejemplo.com/a', ['https://ejemplo.com/roto.png', 'https://ejemplo.com/bueno']);
    expect(icon).toMatch(/^data:image\/png;base64,/);
    service.flush();

    // Tras reiniciar, un acceso directo del mismo sitio usa el icono aprendido sin buscar otro.
    const again = fakeSession({ 'https://ejemplo.com/bueno': { body: PNG } });
    const restarted = new FaviconService(again, path);
    expect(await restarted.forPage('https://ejemplo.com/otra/pagina')).toBe(icon);
    expect(again.requested).toEqual(['https://ejemplo.com/bueno']);

    // Al borrar el historial se olvida.
    restarted.clear();
    restarted.flush();
    expect(await new FaviconService(fakeSession({}), path).forPage('https://ejemplo.com/')).toBeNull();
  });

  it('sin icono aprendido usa /favicon.ico y, si no existe, los iconos de la página principal', async () => {
    const withIco = fakeSession({ 'https://a.com/favicon.ico': { type: 'image/x-icon', body: ICO } });
    expect(await new FaviconService(withIco).forPage('https://a.com/x')).toMatch(/^data:image\/x-icon;base64,/);

    const discovered = fakeSession({
      // /favicon.ico responde con una página (como hacen muchos sitios): no es un icono.
      'https://b.com/favicon.ico': { type: 'text/html', body: '<html>404</html>' },
      'https://b.com/': { type: 'text/html; charset=utf-8', body: '<head><link rel="icon" href="/static/marca.svg"></head>' },
      'https://b.com/static/marca.svg': { type: 'image/svg+xml', body: SVG },
    });
    expect(await new FaviconService(discovered).forPage('https://b.com/panel')).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(discovered.requested).toEqual(['https://b.com/favicon.ico', 'https://b.com/', 'https://b.com/static/marca.svg']);

    expect(await new FaviconService(fakeSession({})).forPage('icarus://historial')).toBeNull();
  });

  it('descarta datos guardados que no son sitios web', () => {
    expect(
      sanitizeLearnedIcons({
        'https://ejemplo.com': 'https://ejemplo.com/i.png',
        'https://ejemplo.com/ruta': 'https://ejemplo.com/i.png',
        'file://': 'file:///etc/passwd',
        'https://otro.com': 'javascript:alert(1)',
        'https://tercero.com': 42,
      }),
    ).toEqual({ 'https://ejemplo.com': 'https://ejemplo.com/i.png' });
  });
});
