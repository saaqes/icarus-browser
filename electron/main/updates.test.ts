// @vitest-environment node
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '../../src/types/native';
import { loopbackSource, type FetchLike } from '../update/source';
import { planInstall, type InstallPlan } from './updateInstall';
import { sanitizeUpdates, UpdateService, type UpdateInstaller } from './updates';

const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PAYLOAD = Buffer.alloc(50_000, 3);
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');

let server: http.Server;
let base = '';
const files = new Map<string, Buffer | string>();

function publish(version: string, channel: 'stable' | 'preview' = 'stable', payload = PAYLOAD) {
  files.clear();
  const manifest = JSON.stringify({
    schema: 1,
    product: 'icarus-browser',
    version,
    channel,
    tag: `v${version}`,
    commit: '1'.repeat(40),
    releasedAt: '2026-10-26T10:00:00Z',
    notes: `Novedades de ${version}`,
    assets: [{ platform: 'windows', arch: 'x64', kind: 'nsis', file: `ICARUS-Browser-Setup-${version}.exe`, size: PAYLOAD.length, sha256: sha(PAYLOAD) }],
  });
  const signature = sign('sha256', Buffer.from(manifest), { key: keys.privateKey, dsaEncoding: 'der' }).toString('base64');
  files.set('/releases/latest/download/icarus-update.json', manifest);
  files.set('/releases/latest/download/icarus-update.json.sig', signature);
  files.set(`/releases/download/v${version}/ICARUS-Browser-Setup-${version}.exe`, payload);
}

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const body = files.get(request.url ?? '');
    if (body === undefined) response.writeHead(404).end();
    else response.writeHead(200, { 'content-length': Buffer.byteLength(body) }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

const WINDOWS_PLAN: InstallPlan = { mode: 'automatic', target: { platform: 'windows', arch: 'x64', kinds: ['nsis'] } };
const nodeFetch: FetchLike = (url, init) => fetch(url, init as RequestInit);

function setup(options: { dataDir?: string; version?: string; plan?: InstallPlan; publicKey?: string | null; isPackaged?: boolean; feed?: string } = {}) {
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), 'icarus-updates-'));
  const states: UpdateState[] = [];
  const installer: UpdateInstaller & { launches: Array<{ prepared: string; relaunch: boolean }> } = {
    launches: [],
    prepare: vi.fn(async (file: string) => file),
    launch(prepared, relaunch) {
      this.launches.push({ prepared, relaunch });
    },
    reveal: vi.fn(),
  };
  const quit = vi.fn();
  const requestRestart = vi.fn();
  const service = new UpdateService({
    dataDir,
    currentVersion: options.version ?? '0.2.1',
    plan: options.plan ?? WINDOWS_PLAN,
    publicKey: options.publicKey === undefined ? PUBLIC_KEY : options.publicKey,
    isPackaged: options.isPackaged ?? true,
    fetch: nodeFetch,
    source: loopbackSource(options.feed ?? base)!,
    installer,
    emit: (state) => states.push(state),
    requestRestart,
    restartTimeoutMs: 50,
    quit,
  });
  return { service, states, installer, quit, requestRestart, dataDir };
}

async function until(service: UpdateService, status: UpdateState['status']) {
  for (let i = 0; i < 200 && service.getState().status !== status; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(service.getState().status).toBe(status);
}

describe('servicio de actualizaciones', () => {
  it('no ofrece nada si la versión instalada es la última', async () => {
    publish('0.2.1');
    const { service } = setup();
    const state = await service.check();
    expect(state).toMatchObject({ status: 'up-to-date', available: null });
    expect(state.lastCheckedAt).not.toBeNull();
  });

  it('detecta una versión nueva con sus notas', async () => {
    publish('0.2.2');
    const { service } = setup();
    const state = await service.check();
    expect(state).toMatchObject({ status: 'available', available: { version: '0.2.2', notes: 'Novedades de 0.2.2', file: 'ICARUS-Browser-Setup-0.2.2.exe' } });
  });

  it('el canal estable ignora una preliminar', async () => {
    publish('0.3.0-preview.1', 'preview');
    const { service } = setup();
    // El manifiesto preliminar servido como «latest» se rechaza.
    expect((await service.check()).status).toBe('error');
  });

  it('descarga, verifica, guarda la sesión, instala y se cierra una sola vez', async () => {
    publish('0.2.2');
    const { service, installer, quit, requestRestart, dataDir } = setup();
    await service.check();
    service.download(true);
    await until(service, 'installing');
    for (let i = 0; i < 100 && quit.mock.calls.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(requestRestart).toHaveBeenCalledTimes(1);
    expect(installer.launches).toEqual([{ prepared: join(dataDir, 'updates', '0.2.2', 'ICARUS-Browser-Setup-0.2.2.exe'), relaunch: true }]);
    expect(quit).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(readFileSync(join(dataDir, 'updates.json'), 'utf8')).data;
    expect(stored.pending).toMatchObject({ from: '0.2.1', to: '0.2.2', manual: false });

    // Arranque siguiente con la versión nueva: se confirma y se borran las descargas.
    const after = setup({ dataDir, version: '0.2.2' });
    expect(after.service.getState().justUpdated).toEqual({ from: '0.2.1', to: '0.2.2' });
    expect(existsSync(join(dataDir, 'updates'))).toBe(false);
    after.service.acknowledge();
    expect(after.service.getState().justUpdated).toBeNull();
  });

  it('si la instalación no se completa, lo dice y no vuelve a instalar sola (sin bucles)', async () => {
    publish('0.2.2');
    const dataDir = mkdtempSync(join(tmpdir(), 'icarus-updates-'));
    writeFileSync(join(dataDir, 'updates.json'), JSON.stringify({ version: 1, data: { pending: { from: '0.2.1', to: '0.2.2', at: '2026-10-26T10:00:00Z', manual: false } } }));
    const { service, installer, quit } = setup({ dataDir });
    expect(service.getState()).toMatchObject({ status: 'error', failedVersion: '0.2.2', error: { code: 'install-failed' } });
    // Las comprobaciones siguientes avisan, pero nada se descarga ni se instala sin el usuario.
    await service.check(false);
    expect(service.getState().status).toBe('available');
    expect(installer.launches).toEqual([]);
    expect(quit).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(join(dataDir, 'updates.json'), 'utf8')).data.pending).toBeNull();
  });

  it('rechaza un paquete con otro hash y no lo instala', async () => {
    publish('0.2.2', 'stable', Buffer.alloc(PAYLOAD.length, 9));
    const { service, installer } = setup();
    await service.check();
    service.download(true);
    await until(service, 'error');
    expect(service.getState().error?.code).toBe('hash-mismatch');
    expect(installer.launches).toEqual([]);
  });

  it('recordármelo más tarde se guarda por versión e instalar al cerrar espera al cierre', async () => {
    publish('0.2.2');
    const { service, installer, dataDir } = setup();
    await service.check();
    service.postpone();
    expect(setup({ dataDir }).service.getState().postponedVersion).toBe('0.2.2');
    service.download(false);
    await until(service, 'ready');
    await service.install('on-quit');
    expect(installer.launches).toEqual([]);
    service.onQuit();
    expect(installer.launches).toEqual([{ prepared: expect.stringContaining('0.2.2'), relaunch: false }]);
  });

  it('un fallo de red solo se muestra si el usuario pidió la comprobación', async () => {
    const { service } = setup({ feed: 'http://127.0.0.1:9' });
    expect(await service.check(false)).toMatchObject({ status: 'idle', error: null });
    expect(await service.check(true)).toMatchObject({ status: 'error', error: { code: 'network' } });
  });

  it('sin clave pública o sin empaquetar no ofrece actualizaciones', async () => {
    publish('0.2.2');
    expect(setup({ publicKey: null }).service.getState()).toMatchObject({ mode: 'unsupported', unsupportedReason: 'no-key' });
    const dev = setup({ isPackaged: false }).service;
    expect(dev.getState()).toMatchObject({ mode: 'unsupported', unsupportedReason: 'development' });
    expect((await dev.check()).status).toBe('idle');
  });

  it('el modo manual muestra el paquete verificado y no marca un fallo si aún no se colocó', async () => {
    publish('0.2.2');
    const plan: InstallPlan = { mode: 'manual-portable', target: { platform: 'windows', arch: 'x64', kinds: ['nsis'] } };
    const { service, installer, dataDir } = setup({ plan });
    await service.check();
    service.download(false);
    await until(service, 'ready');
    expect(installer.reveal).toHaveBeenCalledWith(service.getState().manualFile);
    service.reveal();
    expect(installer.reveal).toHaveBeenCalledTimes(2);
    expect(setup({ dataDir, plan }).service.getState().status).toBe('idle');
  });

  it('no cambia de canal con una actualización descargada', async () => {
    publish('0.2.2');
    const { service, dataDir } = setup();
    await service.check();
    service.download(false);
    await until(service, 'ready');
    service.setChannel('preview');
    expect(service.getState()).toMatchObject({ channel: 'stable', status: 'ready', available: { version: '0.2.2' } });
    expect(setup({ dataDir }).service.getState().channel).toBe('stable');
  });

  it('las preferencias guardadas se sanean sin perder el canal', () => {
    expect(sanitizeUpdates({ channel: 'preview', postponedVersion: '0.2.2', failedVersion: 'x', pending: { from: '1' } })).toEqual({
      channel: 'preview',
      lastCheckedAt: null,
      postponedVersion: '0.2.2',
      failedVersion: null,
      pending: null,
    });
    expect(sanitizeUpdates('basura').channel).toBe('stable');
  });

  it('no toca los datos del usuario', async () => {
    publish('0.2.2');
    const dataDir = mkdtempSync(join(tmpdir(), 'icarus-updates-'));
    const userFiles = { 'ui-storage.json': '{"icarus.aliasRules":"[]"}', 'history.json': '{"items":[1]}', 'preferences.json': '{"a":1}' };
    for (const [name, content] of Object.entries(userFiles)) writeFileSync(join(dataDir, name), content);
    mkdirSync(join(dataDir, 'Partitions'));
    const { service, quit } = setup({ dataDir });
    await service.check();
    service.download(true);
    await until(service, 'installing');
    for (let i = 0; i < 100 && quit.mock.calls.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    const after = setup({ dataDir, version: '0.2.2' });
    expect(after.service.getState().justUpdated).not.toBeNull();
    for (const [name, content] of Object.entries(userFiles)) expect(readFileSync(join(dataDir, name), 'utf8')).toBe(content);
    expect(existsSync(join(dataDir, 'Partitions'))).toBe(true);
  });
});

describe('plan de instalación', () => {
  it('Windows: instalador NSIS si existe el desinstalador; si no, versión portátil', () => {
    const exe = 'C:\\Users\\a\\AppData\\Local\\Programs\\ICARUS Browser\\ICARUS Browser.exe';
    const uninstaller = 'C:\\Users\\a\\AppData\\Local\\Programs\\ICARUS Browser\\Uninstall ICARUS Browser.exe';
    expect(planInstall({ platform: 'win32', arch: 'x64', execPath: exe, exists: (path) => path === uninstaller })).toMatchObject({ mode: 'automatic', target: { kinds: ['nsis'] } });
    expect(planInstall({ platform: 'win32', arch: 'x64', execPath: exe, exists: () => false })).toMatchObject({ mode: 'manual-portable', target: { kinds: ['zip'] } });
  });

  it('macOS: sustituye la app si su carpeta es escribible; si no, .dmg', () => {
    const exe = '/Applications/ICARUS Browser.app/Contents/MacOS/ICARUS Browser';
    expect(planInstall({ platform: 'darwin', arch: 'arm64', execPath: exe, isWritable: () => true })).toMatchObject({
      mode: 'automatic',
      bundlePath: '/Applications/ICARUS Browser.app',
      target: { arch: 'arm64', kinds: ['zip'] },
    });
    expect(planInstall({ platform: 'darwin', arch: 'arm64', execPath: exe, isWritable: () => false }).mode).toBe('manual-dmg');
    const translocated = '/private/var/folders/x/AppTranslocation/ABC/d/ICARUS Browser.app/Contents/MacOS/ICARUS Browser';
    expect(planInstall({ platform: 'darwin', arch: 'arm64', execPath: translocated, isWritable: () => true }).mode).toBe('manual-dmg');
    // App de Intel con Rosetta en Apple Silicon: se instala la versión nativa.
    expect(planInstall({ platform: 'darwin', arch: 'x64', execPath: exe, isWritable: () => true, runningUnderArm64Translation: true }).target.arch).toBe('arm64');
  });

  it('Linux: no hay paquete publicado, solo aviso', () => {
    expect(planInstall({ platform: 'linux', arch: 'x64', execPath: '/opt/icarus/icarus-browser' })).toMatchObject({ mode: 'manual-release', target: { kinds: [] } });
  });
});
