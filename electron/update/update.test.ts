// @vitest-environment node
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchSignedManifest } from './checker';
import { downloadVerified, UpdateDownloadError } from './download';
import { evaluateManifest, parseManifest, type UpdateManifest, type UpdateTarget } from './manifest';
import { isValidPublicKey, verifyManifestSignature } from './signature';
import { fetchAllowed, githubSource, loopbackSource, pickNewestTag, UpdateHttpError, type FetchLike } from './source';
import { androidVersionCode, compareVersions, parseVersion } from './version';

const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const signText = (text: string, key = keys.privateKey) => sign('sha256', Buffer.from(text), { key, dsaEncoding: 'der' }).toString('base64');

function manifest(version: string, overrides: Partial<UpdateManifest> = {}): UpdateManifest {
  const preview = version.includes('-preview.');
  return {
    schema: 1,
    product: 'icarus-browser',
    version,
    channel: preview ? 'preview' : 'stable',
    tag: `v${version}`,
    commit: 'a'.repeat(40),
    releasedAt: '2026-10-26T10:00:00.000Z',
    notes: 'Novedades',
    assets: [
      { platform: 'windows', arch: 'x64', kind: 'nsis', file: `ICARUS-Browser-Setup-${version}.exe`, size: 10, sha256: 'b'.repeat(64) },
      { platform: 'windows', arch: 'x64', kind: 'zip', file: `ICARUS-Browser-${version}-win-x64.zip`, size: 10, sha256: 'c'.repeat(64) },
      { platform: 'macos', arch: 'arm64', kind: 'zip', file: `ICARUS-Browser-${version}-mac-arm64.zip`, size: 10, sha256: 'd'.repeat(64) },
      { platform: 'macos', arch: 'arm64', kind: 'dmg', file: `ICARUS-Browser-${version}-mac-arm64.dmg`, size: 10, sha256: 'e'.repeat(64) },
      { platform: 'android', arch: 'universal', kind: 'apk', file: `ICARUS-Browser-${version}-android.apk`, size: 10, sha256: 'f'.repeat(64), versionCode: 20199 },
    ],
    ...overrides,
  };
}

const WINDOWS: UpdateTarget = { platform: 'windows', arch: 'x64', kinds: ['nsis'] };
const current = parseVersion('0.2.1')!;

describe('versiones', () => {
  it('solo acepta versiones estables y preliminares con el formato de ICARUS', () => {
    expect(parseVersion('0.2.1')).toEqual({ major: 0, minor: 2, patch: 1, preview: null });
    expect(parseVersion('1.0.0-preview.3')).toEqual({ major: 1, minor: 0, patch: 0, preview: 3 });
    for (const bad of ['v0.2.1', '0.2', '01.2.3', '0.2.1-beta.1', '0.2.1-preview.0', '0.2.1-preview.99', '0.100.0', '2001.0.0', '', 1]) {
      expect(parseVersion(bad), String(bad)).toBeNull();
    }
  });

  it('ordena las preliminares antes de su estable', () => {
    const order = ['0.2.0', '0.2.1-preview.1', '0.2.1-preview.2', '0.2.1', '0.3.0', '1.0.0'].map((v) => parseVersion(v)!);
    for (let i = 1; i < order.length; i++) expect(compareVersions(order[i - 1]!, order[i]!)).toBeLessThan(0);
    expect(compareVersions(parseVersion('0.2.1')!, parseVersion('0.2.1')!)).toBe(0);
  });

  it('el código de versión de Android crece con la versión y cabe en 32 bits', () => {
    const codes = ['0.2.0', '0.2.1-preview.1', '0.2.1', '0.3.0', '2000.99.99'].map((v) => androidVersionCode(parseVersion(v)!));
    expect(codes[0]).toBe(20099);
    expect(codes[2]).toBe(20199);
    for (let i = 1; i < codes.length; i++) expect(codes[i]!).toBeGreaterThan(codes[i - 1]!);
    expect(codes.at(-1)!).toBeLessThan(2 ** 31);
  });
});

describe('manifiesto', () => {
  it('acepta un manifiesto válido y detecta una versión nueva', () => {
    const parsed = parseManifest(JSON.stringify(manifest('0.2.2')));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const decision = evaluateManifest(parsed, current, 'stable', WINDOWS);
    expect(decision).toEqual({ status: 'available', asset: expect.objectContaining({ kind: 'nsis', file: 'ICARUS-Browser-Setup-0.2.2.exe' }) });
  });

  it('no ofrece nada si ya es la última versión y rechaza versiones inferiores', () => {
    const same = parseManifest(JSON.stringify(manifest('0.2.1')));
    const older = parseManifest(JSON.stringify(manifest('0.2.0')));
    expect(same.ok && evaluateManifest(same, current, 'stable', WINDOWS)).toEqual({ status: 'up-to-date' });
    expect(older.ok && evaluateManifest(older, current, 'stable', WINDOWS)).toEqual({ status: 'rejected', reason: 'older' });
  });

  it('el canal estable ignora las preliminares; el preliminar las acepta', () => {
    const preview = parseManifest(JSON.stringify(manifest('0.3.0-preview.1')));
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(evaluateManifest(preview, current, 'stable', WINDOWS)).toEqual({ status: 'rejected', reason: 'channel' });
    expect(evaluateManifest(preview, current, 'preview', WINDOWS).status).toBe('available');
  });

  it('elige el paquete del sistema y la arquitectura', () => {
    const parsed = parseManifest(JSON.stringify(manifest('0.2.2')));
    if (!parsed.ok) throw new Error('manifiesto');
    const pick = (target: UpdateTarget) => {
      const decision = evaluateManifest(parsed, current, 'stable', target);
      return decision.status === 'available' ? decision.asset?.file ?? 'solo aviso' : decision.status;
    };
    expect(pick({ platform: 'windows', arch: 'x64', kinds: ['zip'] })).toBe('ICARUS-Browser-0.2.2-win-x64.zip');
    expect(pick({ platform: 'macos', arch: 'arm64', kinds: ['zip', 'dmg'] })).toBe('ICARUS-Browser-0.2.2-mac-arm64.zip');
    expect(pick({ platform: 'macos', arch: 'x64', kinds: ['zip'] })).toBe('rejected');
    expect(pick({ platform: 'android', arch: 'arm64', kinds: ['apk'] })).toBe('ICARUS-Browser-0.2.2-android.apk');
    expect(pick({ platform: 'linux', arch: 'x64', kinds: [] })).toBe('solo aviso');
  });

  it('rechaza metadatos inválidos', () => {
    const bad = (patch: Record<string, unknown>) => parseManifest(JSON.stringify({ ...manifest('0.2.2'), ...patch }));
    expect(parseManifest('{no json').ok).toBe(false);
    expect(bad({ schema: 2 })).toMatchObject({ ok: false, error: 'schema' });
    expect(bad({ product: 'otro' })).toMatchObject({ ok: false, error: 'product' });
    expect(bad({ version: '0.2.2.1' })).toMatchObject({ ok: false, error: 'version' });
    expect(bad({ channel: 'preview' })).toMatchObject({ ok: false, error: 'channel' });
    expect(bad({ tag: 'v9.9.9' })).toMatchObject({ ok: false, error: 'tag' });
    expect(bad({ commit: 'xyz' })).toMatchObject({ ok: false, error: 'commit' });
    expect(bad({ releasedAt: 'ayer' })).toMatchObject({ ok: false, error: 'date' });
    expect(bad({ notes: 'x'.repeat(20_001) })).toMatchObject({ ok: false, error: 'notes' });
    expect(bad({ assets: [] })).toMatchObject({ ok: false, error: 'assets' });
    const asset = (patch: Record<string, unknown>) => bad({ assets: [{ ...manifest('0.2.2').assets[0], ...patch }] });
    expect(asset({ file: '../../evil.exe' })).toMatchObject({ ok: false, error: 'assets', detail: 'file' });
    expect(asset({ file: 'ICARUS-Browser-Setup-0.2.1.exe' })).toMatchObject({ ok: false, error: 'assets', detail: 'file' });
    expect(asset({ file: 'ICARUS-Browser-Setup-0.2.2.dmg' })).toMatchObject({ ok: false, error: 'assets', detail: 'file' });
    expect(asset({ sha256: 'B'.repeat(64) })).toMatchObject({ ok: false, error: 'assets', detail: 'sha256' });
    expect(asset({ size: 0 })).toMatchObject({ ok: false, error: 'assets', detail: 'size' });
    expect(asset({ url: 'https://evil.example/x.exe', platform: 'beos' })).toMatchObject({ ok: false, error: 'assets', detail: 'platform' });
    const twice = manifest('0.2.2').assets[0]!;
    expect(bad({ assets: [twice, twice] })).toMatchObject({ ok: false, error: 'assets', detail: 'duplicate' });
  });
});

describe('firma', () => {
  it('verifica la firma ECDSA P-256 sobre los bytes exactos', () => {
    const text = JSON.stringify(manifest('0.2.2'));
    expect(isValidPublicKey(PUBLIC_KEY)).toBe(true);
    expect(verifyManifestSignature(Buffer.from(text), signText(text), PUBLIC_KEY)).toBe(true);
    expect(verifyManifestSignature(Buffer.from(`${text} `), signText(text), PUBLIC_KEY)).toBe(false);
    expect(verifyManifestSignature(Buffer.from(text), signText(text, other.privateKey), PUBLIC_KEY)).toBe(false);
    expect(verifyManifestSignature(Buffer.from(text), 'no es base64!', PUBLIC_KEY)).toBe(false);
    expect(verifyManifestSignature(Buffer.from(text), signText(text), 'no es una clave')).toBe(false);
  });
});

describe('origen', () => {
  it('construye las URL y solo admite hosts de GitHub por HTTPS', () => {
    const source = githubSource('saaqes/icarus-browser');
    expect(source.assetUrl('v0.2.2', 'ICARUS-Browser-Setup-0.2.2.exe')).toBe(
      'https://github.com/saaqes/icarus-browser/releases/download/v0.2.2/ICARUS-Browser-Setup-0.2.2.exe',
    );
    expect(() => source.assetUrl('v0.2.2/../../x', 'a.exe')).toThrow();
    expect(() => source.assetUrl('v0.2.2', '../a.exe')).toThrow();
    expect(source.isAllowedUrl(new URL('https://release-assets.githubusercontent.com/x'))).toBe(true);
    expect(source.isAllowedUrl(new URL('http://github.com/x'))).toBe(false);
    expect(source.isAllowedUrl(new URL('https://github.com.evil.example/x'))).toBe(false);
    expect(source.isAllowedUrl(new URL('https://user@github.com/x'))).toBe(false);
    expect(loopbackSource('http://192.168.1.10:8080')).toBeNull();
    expect(loopbackSource('https://127.0.0.1:8080')).toBeNull();
    expect(loopbackSource('http://127.0.0.1:8080')).not.toBeNull();
  });

  it('elige la versión más reciente con manifiesto e ignora borradores', () => {
    const assets = [{ name: 'icarus-update.json' }, { name: 'icarus-update.json.sig' }];
    const list = [
      { tag_name: 'v0.4.0', draft: true, assets },
      { tag_name: 'v0.3.0-preview.2', draft: false, prerelease: true, assets },
      { tag_name: 'v0.3.0-preview.10', draft: false, prerelease: true, assets: [{ name: 'otro' }] },
      { tag_name: 'v0.2.2', draft: false, assets },
      { tag_name: 'nightly', draft: false, assets },
    ];
    expect(pickNewestTag(list)).toBe('v0.3.0-preview.2');
    expect(pickNewestTag({})).toBeNull();
  });

  it('no sigue redirecciones a hosts no permitidos', async () => {
    const source = githubSource();
    const fake: FetchLike = async (url) =>
      url.startsWith('https://github.com/')
        ? new Response(null, { status: 302, headers: { location: 'https://evil.example/payload.exe' } })
        : new Response('malo');
    await expect(fetchAllowed(fake, source, 'https://github.com/saaqes/icarus-browser/releases/download/v0.2.2/a.exe')).rejects.toMatchObject({
      code: 'forbidden-host',
    });
    const followed: FetchLike = async () => Object.defineProperty(new Response('malo'), 'redirected', { value: true }) as Response;
    const viaUrl = async () => {
      const response = await followed('x');
      Object.defineProperty(response, 'url', { value: 'https://evil.example/x' });
      return response;
    };
    await expect(fetchAllowed(viaUrl, source, 'https://github.com/a')).rejects.toBeInstanceOf(UpdateHttpError);
  });
});

/* ------------------------- Servidor local de pruebas ------------------------- */

interface Served {
  body: Buffer | string;
  status?: number;
  headers?: Record<string, string>;
  /** Corta la conexión tras enviar estos bytes. */
  cutAfter?: number;
  /** Envía estos bytes y deja la conexión abierta sin enviar más. */
  stallAfter?: number;
  /** No responde nunca. */
  hang?: boolean;
  ranges?: boolean;
}
let routes = new Map<string, Served>();
let server: http.Server;
let base = '';

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const route = routes.get(request.url ?? '');
    if (!route) {
      response.writeHead(404).end();
      return;
    }
    if (route.hang) return;
    const body = Buffer.from(route.body);
    const range = /^bytes=(\d+)-$/.exec(request.headers.range ?? '');
    if (range && route.ranges !== false) {
      const start = Number(range[1]);
      response.writeHead(206, { 'content-length': body.length - start, 'content-range': `bytes ${start}-${body.length - 1}/${body.length}` });
      response.end(body.subarray(start));
      return;
    }
    response.writeHead(route.status ?? 200, { 'content-length': body.length, ...route.headers });
    if (route.cutAfter !== undefined) {
      response.write(body.subarray(0, route.cutAfter), () => response.destroy());
      return;
    }
    if (route.stallAfter !== undefined) {
      response.write(body.subarray(0, route.stallAfter));
      return;
    }
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const nodeFetch: FetchLike = (url, init) => fetch(url, init as RequestInit);

describe('comprobación del manifiesto firmado', () => {
  const publish = (text: string, signature: string, prefix = '/releases/latest/download') => {
    routes.set(`${prefix}/icarus-update.json`, { body: text });
    routes.set(`${prefix}/icarus-update.json.sig`, { body: signature });
  };

  it('acepta un manifiesto bien firmado y rechaza uno manipulado', async () => {
    routes = new Map();
    const source = loopbackSource(base)!;
    const text = JSON.stringify(manifest('0.2.2'));
    publish(text, signText(text));
    const good = await fetchSignedManifest({ fetch: nodeFetch, source, channel: 'stable', publicKey: PUBLIC_KEY });
    expect(good).toMatchObject({ ok: true, manifest: { version: '0.2.2' } });

    const tampered = text.replace('Novedades', 'Instala esto');
    publish(tampered, signText(text));
    expect(await fetchSignedManifest({ fetch: nodeFetch, source, channel: 'stable', publicKey: PUBLIC_KEY })).toEqual({ ok: false, error: 'signature' });
    expect(await fetchSignedManifest({ fetch: nodeFetch, source, channel: 'stable', publicKey: null })).toEqual({ ok: false, error: 'no-key' });
  });

  it('un manifiesto preliminar firmado nunca llega al canal estable', async () => {
    routes = new Map();
    const source = loopbackSource(base)!;
    const text = JSON.stringify(manifest('0.3.0-preview.1'));
    publish(text, signText(text));
    expect(await fetchSignedManifest({ fetch: nodeFetch, source, channel: 'stable', publicKey: PUBLIC_KEY })).toMatchObject({ ok: false, error: 'invalid-manifest' });
  });

  it('el canal preliminar usa la lista de versiones y comprueba la etiqueta', async () => {
    routes = new Map();
    const source = loopbackSource(base)!;
    const assets = [{ name: 'icarus-update.json' }, { name: 'icarus-update.json.sig' }];
    routes.set('/api/releases', { body: JSON.stringify([{ tag_name: 'v0.3.0-preview.1', draft: false, prerelease: true, assets }]) });
    const text = JSON.stringify(manifest('0.3.0-preview.1'));
    publish(text, signText(text), '/releases/download/v0.3.0-preview.1');
    expect(await fetchSignedManifest({ fetch: nodeFetch, source, channel: 'preview', publicKey: PUBLIC_KEY })).toMatchObject({ ok: true });
    // Un manifiesto válido de otra versión servido bajo esa etiqueta se rechaza.
    const otherText = JSON.stringify(manifest('0.2.2'));
    publish(otherText, signText(otherText), '/releases/download/v0.3.0-preview.1');
    expect(await fetchSignedManifest({ fetch: nodeFetch, source, channel: 'preview', publicKey: PUBLIC_KEY })).toMatchObject({ ok: false, detail: 'tag' });
  });

  it('informa de los fallos de red y del límite de la API', async () => {
    const source = loopbackSource('http://127.0.0.1:9')!;
    expect(await fetchSignedManifest({ fetch: nodeFetch, source, channel: 'stable', publicKey: PUBLIC_KEY })).toMatchObject({ ok: false, error: 'network' });
    routes = new Map([['/api/releases', { body: '{}', status: 403, headers: { 'x-ratelimit-remaining': '0' } }]]);
    expect(await fetchSignedManifest({ fetch: nodeFetch, source: loopbackSource(base)!, channel: 'preview', publicKey: PUBLIC_KEY })).toEqual({
      ok: false,
      error: 'rate-limited',
    });
  });

  it('una conexión que no responde no deja la comprobación colgada', async () => {
    routes = new Map([
      ['/releases/latest/download/icarus-update.json', { body: '', hang: true }],
      ['/releases/latest/download/icarus-update.json.sig', { body: '', hang: true }],
    ]);
    const source = loopbackSource(base)!;
    const started = Date.now();
    expect(await fetchSignedManifest({ fetch: nodeFetch, source, channel: 'stable', publicKey: PUBLIC_KEY, timeoutMs: 200 })).toEqual({
      ok: false,
      error: 'network',
      detail: 'timeout',
    });
    expect(Date.now() - started).toBeLessThan(5000);
    // Cancelada desde fuera se sigue informando como cancelación.
    const controller = new AbortController();
    const pending = fetchSignedManifest({ fetch: nodeFetch, source, channel: 'stable', publicKey: PUBLIC_KEY, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('descarga verificada', () => {
  const payload = Buffer.alloc(300_000, 7);
  const digest = sha(payload);
  const plenty = async () => 10 * 1024 ** 3;
  const options = (destination: string, patch: Partial<Parameters<typeof downloadVerified>[0]> = {}) => ({
    fetch: nodeFetch,
    source: loopbackSource(base)!,
    url: `${base}/releases/download/v0.2.2/ICARUS-Browser-Setup-0.2.2.exe`,
    destination,
    size: payload.length,
    sha256: digest,
    freeSpace: plenty,
    ...patch,
  });
  const dir = () => mkdtempSync(join(tmpdir(), 'icarus-update-'));

  it('descarga, informa del progreso y verifica el SHA-256', async () => {
    routes = new Map([['/releases/download/v0.2.2/ICARUS-Browser-Setup-0.2.2.exe', { body: payload }]]);
    const destination = join(dir(), 'setup.exe');
    const progress: number[] = [];
    await downloadVerified(options(destination, { onProgress: (received) => progress.push(received) }));
    expect(readFileSync(destination).equals(payload)).toBe(true);
    expect(progress.at(-1)).toBe(payload.length);
  });

  it('rechaza un archivo con otro hash y no lo deja en disco', async () => {
    routes = new Map([['/releases/download/v0.2.2/ICARUS-Browser-Setup-0.2.2.exe', { body: Buffer.alloc(payload.length, 8) }]]);
    const destination = join(dir(), 'setup.exe');
    await expect(downloadVerified(options(destination))).rejects.toMatchObject({ code: 'hash-mismatch' });
    expect(existsSync(destination)).toBe(false);
    expect(existsSync(`${destination}.part`)).toBe(false);
  });

  it('reanuda una descarga interrumpida', async () => {
    const path = '/releases/download/v0.2.2/ICARUS-Browser-Setup-0.2.2.exe';
    routes = new Map([[path, { body: payload, cutAfter: 100_000 }]]);
    const destination = join(dir(), 'setup.exe');
    await expect(downloadVerified(options(destination))).rejects.toBeInstanceOf(UpdateDownloadError);
    expect(existsSync(`${destination}.part`)).toBe(true);
    routes = new Map([[path, { body: payload }]]);
    await downloadVerified(options(destination));
    expect(sha(readFileSync(destination))).toBe(digest);
  });

  it('se niega si no hay espacio y no descarga más de lo anunciado', async () => {
    const path = '/releases/download/v0.2.2/ICARUS-Browser-Setup-0.2.2.exe';
    routes = new Map([[path, { body: payload }]]);
    await expect(downloadVerified(options(join(dir(), 'a.exe'), { freeSpace: async () => 1000 }))).rejects.toMatchObject({ code: 'disk-space' });
    routes = new Map([[path, { body: Buffer.concat([payload, Buffer.alloc(10)]) }]]);
    await expect(downloadVerified(options(join(dir(), 'b.exe')))).rejects.toMatchObject({ code: 'size-mismatch' });
  });

  it('una descarga que deja de recibir datos se da por interrumpida y se puede reanudar', async () => {
    const path = '/releases/download/v0.2.2/ICARUS-Browser-Setup-0.2.2.exe';
    const destination = join(dir(), 'setup.exe');
    routes = new Map([[path, { body: payload, stallAfter: 120_000 }]]);
    await expect(downloadVerified(options(destination, { stallTimeoutMs: 300 }))).rejects.toMatchObject({ code: 'interrupted' });
    expect(existsSync(`${destination}.part`)).toBe(true);
    routes = new Map([[path, { body: payload, hang: true }]]);
    await expect(downloadVerified(options(destination, { stallTimeoutMs: 300 }))).rejects.toMatchObject({ code: 'interrupted' });
    routes = new Map([[path, { body: payload }]]);
    await downloadVerified(options(destination, { stallTimeoutMs: 300 }));
    expect(sha(readFileSync(destination))).toBe(digest);
  });

  it('reutiliza una descarga ya verificada sin volver a pedirla', async () => {
    routes = new Map();
    const destination = join(dir(), 'setup.exe');
    writeFileSync(destination, payload);
    await expect(downloadVerified(options(destination))).resolves.toBe(destination);
  });
});
