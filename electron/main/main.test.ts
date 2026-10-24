// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { App, AuthInfo, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { macMenuTemplate } from './appMenu';
import { AuthManager, describeAuthRequest } from './auth';
import { JsonFile } from './jsonFile';
import { isAllowedPageNavigation, isDangerousFile, parseNavigableUrl, protocolOf, sanitizeFileName } from './urlPolicy';
import { assertId, assertRect, IpcValidationError } from './validate';

describe('política de URL', () => {
  it('solo permite navegar a http(s) sin credenciales', () => {
    expect(parseNavigableUrl('https://www.wikipedia.org/')?.href).toBe('https://www.wikipedia.org/');
    expect(parseNavigableUrl('javascript:alert(1)')).toBeNull();
    expect(parseNavigableUrl('file:///C:/Windows')).toBeNull();
    expect(parseNavigableUrl('https://user:pw@example.com/')).toBeNull();
    expect(isAllowedPageNavigation('about:blank')).toBe(true);
    expect(isAllowedPageNavigation('mailto:a@b.c')).toBe(false);
    expect(protocolOf('mailto:a@b.c')).toBe('mailto:');
  });

  it('reconoce archivos peligrosos y sanea nombres', () => {
    expect(isDangerousFile('instalador.EXE')).toBe(true);
    expect(isDangerousFile('script.ps1')).toBe(true);
    expect(isDangerousFile('informe.pdf')).toBe(false);
    expect(sanitizeFileName('a<b>:c?.txt')).toBe('a_b__c_.txt');
    expect(sanitizeFileName('CON')).toBe('descarga-CON');
    expect(sanitizeFileName('...')).toBe('descarga');
  });
});

describe('validación IPC', () => {
  it('rechaza identificadores y rectángulos inválidos', () => {
    expect(assertId('tab-1_A', 'id')).toBe('tab-1_A');
    expect(() => assertId('../x', 'id')).toThrow(IpcValidationError);
    expect(assertRect({ x: 0.4, y: 90, width: 1280.6, height: 700 })).toEqual({ x: 0, y: 90, width: 1281, height: 700 });
    expect(() => assertRect({ x: -1, y: 0, width: 1, height: 1 })).toThrow(IpcValidationError);
    expect(() => assertRect({ x: 0, y: 0, width: Infinity, height: 1 })).toThrow(IpcValidationError);
  });
});

describe('JsonFile', () => {
  it('guarda de forma atómica y recupera archivos dañados', () => {
    const dir = mkdtempSync(join(tmpdir(), 'icarus-'));
    const path = join(dir, 'datos.json');
    const options = { version: 1, defaults: () => ({ n: 0 }), sanitize: (raw: unknown) => ({ n: Number((raw as { n?: number })?.n ?? 0) }) };
    const file = new JsonFile(path, options);
    file.set({ n: 5 });
    file.flush();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ version: 1, data: { n: 5 } });
    expect(new JsonFile(path, options).get()).toEqual({ n: 5 });

    writeFileSync(path, '{roto');
    expect(new JsonFile(path, options).get()).toEqual({ n: 0 });
    expect(readdirSync(dir).some((name) => name.startsWith('datos.json.corrupt-'))).toBe(true);
  });
});

describe('autenticación HTTP', () => {
  const authInfo = (overrides: Partial<AuthInfo> = {}): AuthInfo => ({
    isProxy: false,
    scheme: 'Basic',
    host: 'intranet.ejemplo.com',
    port: 443,
    realm: 'Zona privada',
    ...overrides,
  });

  it('describe el origen real, si es seguro y recorta el mensaje del sitio', () => {
    const https = describeAuthRequest('1', 't', 'https://intranet.ejemplo.com/informe?x=1', authInfo());
    expect(https).toMatchObject({ origin: 'https://intranet.ejemplo.com', secure: true, scheme: 'basic', isProxy: false });
    expect(describeAuthRequest('1', 't', 'http://router.local/', authInfo()).secure).toBe(false);
    const proxy = describeAuthRequest('1', 't', 'https://ejemplo.com/', authInfo({ isProxy: true, host: 'proxy.empresa', port: 8080 }));
    expect(proxy).toMatchObject({ origin: 'proxy.empresa:8080', isProxy: true, secure: false });
    expect(describeAuthRequest('1', 't', 'https://a.com/', authInfo({ realm: 'x'.repeat(400) })).realm).toHaveLength(150);
  });

  it('solo intercepta las páginas de las pestañas y entrega o cancela las credenciales', () => {
    const app = new EventEmitter();
    const tab = { isDestroyed: () => false } as unknown as WebContents;
    const other = { isDestroyed: () => false } as unknown as WebContents;
    const requests: string[] = [];
    const cancelled: string[] = [];
    const manager = new AuthManager(
      (contents) => (contents === tab ? 'pestaña-1' : null),
      (request) => requests.push(request.id),
      (id) => cancelled.push(id),
    );
    manager.attach(app as unknown as App);

    // Solicitud interna (sin pestaña): Electron la cancela por defecto.
    const internal = { preventDefault: vi.fn() };
    app.emit('login', internal, other, { url: 'https://a.com/' }, authInfo(), vi.fn());
    expect(internal.preventDefault).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);

    const first = { event: { preventDefault: vi.fn() }, callback: vi.fn() };
    app.emit('login', first.event, tab, { url: 'https://intranet.ejemplo.com/' }, authInfo(), first.callback);
    expect(first.event.preventDefault).toHaveBeenCalled();
    manager.respond(requests[0]!, { username: 'ana', password: 'secreto' });
    expect(first.callback).toHaveBeenCalledWith('ana', 'secreto');
    manager.respond(requests[0]!, { username: 'otra', password: 'vez' });
    expect(first.callback).toHaveBeenCalledTimes(1);

    const second = { event: { preventDefault: vi.fn() }, callback: vi.fn() };
    app.emit('login', second.event, tab, { url: 'https://intranet.ejemplo.com/' }, authInfo(), second.callback);
    manager.cancelForTab('pestaña-1');
    expect(second.callback).toHaveBeenCalledWith();
    expect(cancelled).toEqual([requests[1]]);
  });
});

describe('menú de macOS', () => {
  const roles = (template: ReturnType<typeof macMenuTemplate>): string[] =>
    template.flatMap((item) => [item.role ?? '', ...(Array.isArray(item.submenu) ? roles(item.submenu) : [])]).filter(Boolean) as string[];

  it('no ocupa los atajos del navegador (⌘W, ⌘R, ⌘T…)', () => {
    const used = roles(macMenuTemplate('ICARUS Browser'));
    for (const role of ['close', 'reload', 'forceReload', 'toggleDevTools', 'viewMenu', 'fileMenu']) expect(used).not.toContain(role);
    const accelerators = macMenuTemplate('ICARUS Browser').flatMap((item) => (Array.isArray(item.submenu) ? item.submenu : [])).map((item) => item.accelerator);
    expect(accelerators.filter(Boolean)).toEqual([]);
  });

  it('incluye Edición para copiar y pegar y Salir', () => {
    const used = roles(macMenuTemplate('ICARUS Browser'));
    for (const role of ['copy', 'paste', 'cut', 'selectAll', 'undo', 'quit', 'hide']) expect(used).toContain(role);
  });
});
