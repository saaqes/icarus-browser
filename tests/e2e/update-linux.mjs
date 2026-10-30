/**
 * Prueba real de actualización en Linux (AppImage), con los casos de fallo.
 *
 * Usa el AppImage instalado de una versión (copiado a una carpeta temporal, como
 * haría el usuario en ~/Aplicaciones) y sirve en 127.0.0.1 la versión siguiente con
 * la misma estructura que GitHub Releases: manifiesto firmado con una clave de
 * prueba, su firma y el paquete. Todo pasa por el ICARUS real (descarga, SHA-256,
 * sustitución, reinicio y vuelta atrás); nada se simula dentro de la app.
 *
 *  1. Sin versiones nuevas publicadas (manifiesto 404).
 *  2. Versión ya actualizada (el manifiesto anuncia la instalada).
 *  3. Sin conexión con el servidor de actualizaciones.
 *  4. Error de descarga (el servidor responde 500 al paquete).
 *  5. Paquete con un SHA-256 distinto del firmado.
 *  6. Actualización fallida: el paquete nuevo no arranca → se restaura la anterior.
 *  7. Descarga interrumpida a medias → se reanuda (Range) y se completa.
 *  8. Actualización real: se aplica, ICARUS se reinicia en la versión nueva, los
 *     datos siguen intactos y la versión no se vuelve a ofrecer.
 *
 * Uso:
 *   node tests/e2e/update-linux.mjs --app ICARUS-Browser-0.2.0-linux-x64.AppImage \
 *     --feed CARPETA_CON_0.2.1_Y_MANIFIESTO_FIRMADO --public-key prueba.pub --private-key prueba.key \
 *     --from 0.2.0 --to 0.2.1
 *
 * Sin FUSE (contenedores), exporta APPIMAGE_EXTRACT_AND_RUN=1: el AppImage se extrae
 * en /tmp en lugar de montarse; el resto es igual.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { chmodSync, copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { assert, CdpSession, eventually, sleep } from './cdp.mjs';

const { values } = parseArgs({
  options: {
    app: { type: 'string' },
    feed: { type: 'string' },
    'public-key': { type: 'string' },
    'private-key': { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
  },
});
for (const name of ['app', 'feed', 'public-key', 'private-key', 'from', 'to']) {
  if (!values[name]) {
    console.error(`Falta --${name}`);
    process.exit(1);
  }
}
if (process.platform !== 'linux') {
  console.error('Esta prueba es para Linux (AppImage).');
  process.exit(1);
}
const { from, to } = values;
const feedDir = resolve(values.feed);
const privateKey = createPrivateKey(readFileSync(resolve(values['private-key'])));
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const nextPatch = (version) => version.replace(/(\d+)$/, (patch) => String(Number(patch) + 1));

/* ------------------------------ Instalación de prueba ------------------------------ */

// Como un usuario: el AppImage en una carpeta suya, con permiso de escritura.
const work = mkdtempSync(join(tmpdir(), 'icarus-appimage-'));
const appDir = join(work, 'Aplicaciones');
mkdirSync(appDir);
const app = join(appDir, 'ICARUS-Browser.AppImage');
copyFileSync(resolve(values.app), app);
chmodSync(app, 0o755);
const originalSha = sha256(app);
const dataDir = join(work, 'datos');
const confirmFile = join(dataDir, 'updates-confirmed');

/* --------------------------------- Paquetes y feeds --------------------------------- */

const manifestText = readFileSync(join(feedDir, 'icarus-update.json'), 'utf8');
const manifest = JSON.parse(manifestText);
assert(manifest.version === to, `El manifiesto del feed es de la versión ${manifest.version}, no ${to}`);
const asset = manifest.assets.find((item) => item.platform === 'linux' && item.kind === 'appimage');
assert(asset, 'El feed no tiene AppImage');
const newFile = join(feedDir, asset.file);
assert(sha256(newFile) === asset.sha256, 'El AppImage del feed no coincide con su manifiesto');

/** Manifiesto firmado con la clave de prueba (para los casos que la necesitan). */
function signed(body) {
  const text = `${JSON.stringify(body, null, 2)}\n`;
  return { text, signature: `${sign('sha256', Buffer.from(text), { key: privateKey, dsaEncoding: 'der' }).toString('base64')}\n` };
}
const feeds = {
  normal: { manifest: { text: manifestText, signature: readFileSync(join(feedDir, 'icarus-update.json.sig'), 'utf8') }, files: { [asset.file]: newFile } },
};
// 2. La versión instalada.
feeds.same = {
  manifest: signed({ ...manifest, version: from, tag: `v${from}`, assets: [{ ...asset, file: asset.file.replace(to, from), sha256: originalSha, size: statSync(app).size }] }),
  files: {},
};
// 5. El mismo paquete, pero el manifiesto firmado anuncia otra huella.
feeds.badHash = { manifest: signed({ ...manifest, assets: [{ ...asset, sha256: '0'.repeat(64) }] }), files: feeds.normal.files };
// 6. Un AppImage dañado (cortado) de una versión posterior: pasa la verificación (su
// huella es la firmada) pero no arranca.
const broken = nextPatch(to);
const brokenFile = join(work, `ICARUS-Browser-${broken}-linux-x64.AppImage`);
writeFileSync(brokenFile, readFileSync(newFile).subarray(0, 4 * 1024 * 1024));
feeds.broken = {
  manifest: signed({ ...manifest, version: broken, tag: `v${broken}`, assets: [{ ...asset, file: `ICARUS-Browser-${broken}-linux-x64.AppImage`, size: statSync(brokenFile).size, sha256: sha256(brokenFile) }] }),
  files: { [`ICARUS-Browser-${broken}-linux-x64.AppImage`]: brokenFile },
};

/* ----------------------- Servidor con la estructura de GitHub ---------------------- */

let mode = 'normal';
let interrupted = false;
const requests = [];
const PAGES = { '/paginas/uno.html': 'Página uno', '/paginas/dos.html': 'Página dos' };
const server = http.createServer((request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  if (PAGES[path]) {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>${PAGES[path]}</title><h1>${PAGES[path]}</h1>`);
    return;
  }
  requests.push(`${mode} ${request.method} ${path}${request.headers.range ? ` (${request.headers.range})` : ''}`);
  if (mode === 'offline') {
    request.socket.destroy();
    return;
  }
  const feed = mode === 'same' ? feeds.same : mode === 'bad-hash' ? feeds.badHash : mode === 'broken' ? feeds.broken : feeds.normal;
  const latest = /^\/releases\/latest\/download\/([^/]+)$/.exec(path);
  if (latest) {
    if (mode === 'none') {
      response.writeHead(404).end();
      return;
    }
    const body = latest[1] === 'icarus-update.json' ? feed.manifest.text : latest[1] === 'icarus-update.json.sig' ? feed.manifest.signature : null;
    if (body === null) response.writeHead(404).end();
    else response.writeHead(200, { 'content-type': 'application/octet-stream' }).end(body);
    return;
  }
  const download = /^\/releases\/download\/([^/]+)\/([^/]+)$/.exec(path);
  const file = download ? feed.files[download[2]] : null;
  if (!file) {
    response.writeHead(404).end();
    return;
  }
  if (mode === 'asset-error') {
    response.writeHead(500).end('Error interno');
    return;
  }
  const size = statSync(file).size;
  const range = /^bytes=(\d+)-$/.exec(request.headers.range ?? '');
  if (range && Number(range[1]) < size) {
    const start = Number(range[1]);
    response.writeHead(206, { 'content-length': size - start, 'content-range': `bytes ${start}-${size - 1}/${size}` });
    createReadStream(file, { start }).pipe(response);
    return;
  }
  response.writeHead(200, { 'content-length': size, 'content-type': 'application/octet-stream' });
  if (mode === 'interrupt' && !interrupted) {
    // Se corta la conexión a mitad del paquete (una sola vez).
    interrupted = true;
    createReadStream(file, { start: 0, end: Math.floor(size / 2) })
      .on('data', (chunk) => response.write(chunk))
      .on('end', () => setTimeout(() => response.socket?.destroy(), 200));
    return;
  }
  createReadStream(file).pipe(response);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const pageOne = `${origin}/paginas/uno.html`;
const pageTwo = `${origin}/paginas/dos.html`;

const env = {
  ...process.env,
  ICARUS_USER_DATA_DIR: dataDir,
  ICARUS_SHIELD_AUTO_UPDATE: '0',
  ICARUS_UPDATE_FEED: origin,
  ICARUS_UPDATE_PUBLIC_KEY_FILE: resolve(values['public-key']),
  // Las comprobaciones las pide la prueba, en el momento de cada caso.
  ICARUS_UPDATE_CHECK_DELAY_MS: '3600000',
};

/* ----------------------------------- Utilidades ----------------------------------- */

function readJson(name) {
  try {
    return JSON.parse(readFileSync(join(dataDir, name), 'utf8')).data ?? null;
  } catch {
    return null;
  }
}

/** Procesos principales de ICARUS (el ejecutable dentro del AppImage montado o extraído). */
function icarusProcesses() {
  const result = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
  return result.stdout
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter((match) => match && /\/(appimage_extracted_[^/]+|\.mount_[^/]+)\/icarus-browser(\s|$)/.test(match[2]) && !match[2].includes('--type='))
    .map((match) => ({ pid: Number(match[1]), command: match[2] }));
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Cierre ordenado (SIGTERM: ICARUS guarda sus datos al salir, como al cerrar la ventana). */
async function closeGracefully(pid) {
  if (!alive(pid)) return 'ya estaba cerrada';
  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 60 && alive(pid); i++) await sleep(500);
  if (!alive(pid)) return 'SIGTERM';
  process.kill(pid, 'SIGKILL');
  for (let i = 0; i < 20 && alive(pid); i++) await sleep(500);
  return 'terminada a la fuerza';
}

const runs = [];
async function launch(label) {
  const child = spawn(app, ['--remote-debugging-port=0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const run = { label, child, output: '', exitCode: undefined, sessions: [] };
  runs.push(run);
  run.exited = new Promise((done) =>
    child.once('exit', (code) => {
      run.exitCode = code;
      done(code);
    }),
  );
  const endpoint = await new Promise((done, reject) => {
    const onData = (chunk) => {
      run.output += chunk;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(run.output);
      if (match) done(new URL(match[1]));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    run.exited.then((code) => reject(new Error(`${label}: el AppImage terminó (código ${code})\n${run.output.slice(-3000)}`)));
    setTimeout(() => reject(new Error(`${label}: no abrió el puerto de depuración`)), 120_000);
  });
  const base = `http://${endpoint.host}`;
  const target = await eventually(
    async () => (await (await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(5000) })).json()).find((item) => item.type === 'page' && item.url.startsWith('icarus-app://ui/')),
    `${label}: la interfaz no apareció`,
    60_000,
  );
  run.ui = await CdpSession.connect(target.webSocketDebuggerUrl);
  run.sessions.push(run.ui);
  await eventually(() => run.ui.evaluate("Boolean(document.querySelector('.browser--desktop'))"), `${label}: la interfaz no terminó de cargar`);
  return run;
}

async function navigate(ui, url) {
  await ui.evaluate(`(() => { const bar = document.querySelector('.toolbar input[role="combobox"]'); bar.focus(); bar.select(); return true; })()`);
  await ui.send('Input.insertText', { text: url });
  for (const type of ['keyDown', 'keyUp']) {
    await ui.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) });
  }
}
const tabTitles = (ui) => ui.evaluate(`[...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent.trim())`);
const state = (ui) => ui.evaluate('window.icarusNative.updates.getState()');
/** Comprueba como el botón «Buscar actualizaciones» (espera a que termine). */
async function check(ui) {
  await ui.evaluate('window.icarusNative.updates.check()');
  return eventually(async () => {
    const current = await state(ui);
    return current.status === 'checking' ? null : current;
  }, 'La comprobación no terminó', 60_000);
}
async function waitStatus(ui, statuses, message, timeout = 120_000) {
  return eventually(async () => {
    const current = await state(ui);
    return statuses.includes(current.status) ? current : null;
  }, message, timeout);
}
/** Espera a que ICARUS se reabra solo (lo abre el proceso auxiliar) y lo cierra. */
async function waitRelaunchedAndClose(label) {
  const relaunched = await eventually(() => icarusProcesses()[0] ?? null, `${label}: ICARUS no se volvió a abrir`, 120_000);
  // Se deja arrancar del todo (escribe la confirmación y confirma la instalación).
  await sleep(10_000);
  const how = await closeGracefully(relaunched.pid);
  for (const item of icarusProcesses()) await closeGracefully(item.pid);
  return { relaunched, how };
}
const results = [];
function ok(name, note) {
  results.push(name);
  console.log(`  ✓ ${name}${note ? ` — ${note}` : ''}`);
}

/* ------------------------------------- Prueba ------------------------------------- */

let failed = false;
try {
  console.log(`ICARUS · actualización real de AppImage ${from} → ${to} · ${app}`);
  const first = await launch('Versión instalada');
  const { ui } = first;
  assert((await ui.evaluate('window.icarusNative.appVersion')) === from, 'La interfaz no es la versión instalada');
  const initial = await state(ui);
  assert(initial.mode === 'automatic', `Modo ${initial.mode} (${initial.unsupportedReason}): ICARUS no detectó que es un AppImage escribible`);
  ok('El AppImage se detecta como instalación que se actualiza sola', `modo ${initial.mode}`);

  // Datos del usuario que deben sobrevivir a todo.
  await navigate(ui, pageOne);
  await eventually(async () => (await tabTitles(ui)).some((title) => title.includes('Página uno')), 'No se abrió la primera página');
  await ui.evaluate(`document.querySelector('.tabstrip__new').click()`);
  await eventually(async () => (await tabTitles(ui)).length === 2, 'No se abrió la segunda pestaña');
  await navigate(ui, pageTwo);
  await eventually(async () => (await tabTitles(ui)).some((title) => title.includes('Página dos')), 'No se abrió la segunda página');
  await ui.evaluate(`window.icarusNative.storage.setItem('icarus.e2eUpdateMarker', 'conservado')`);
  const preferences = await ui.evaluate('window.icarusNative.preferences.get()');
  const askWhereToSave = !preferences.downloads.askWhereToSave;
  await ui.evaluate(`window.icarusNative.preferences.set(${JSON.stringify({ ...preferences, downloads: { ...preferences.downloads, askWhereToSave } })})`);
  await eventually(async () => {
    const urls = (await ui.evaluate('window.icarusNative.history.list()')).map((item) => item.url);
    return urls.includes(pageOne) && urls.includes(pageTwo);
  }, 'El historial no registró las dos páginas');
  const dataIntact = async (ui2, label) => {
    const snapshot = await ui2.evaluate('window.icarusNative.storage.snapshot');
    assert(snapshot['icarus.e2eUpdateMarker'] === 'conservado', `${label}: se perdió el almacenamiento de la interfaz`);
    const after = await ui2.evaluate('window.icarusNative.preferences.get()');
    assert(after.downloads.askWhereToSave === askWhereToSave, `${label}: se perdieron las preferencias`);
    const history = (await ui2.evaluate('window.icarusNative.history.list()')).map((item) => item.url);
    assert(history.includes(pageOne) && history.includes(pageTwo), `${label}: se perdió el historial`);
  };
  ok('Datos del usuario preparados', 'dos pestañas, historial, preferencias y almacenamiento');

  // 1. Sin versiones nuevas.
  mode = 'none';
  let result = await check(ui);
  assert(result.status === 'up-to-date' && result.available === null, `Sin versiones: ${result.status}`);
  ok('Ausencia de nuevas versiones', 'el manifiesto no existe → «Tu navegador está actualizado»');

  // 2. Ya actualizado.
  mode = 'same';
  result = await check(ui);
  assert(result.status === 'up-to-date' && result.latestVersion === from, `Misma versión: ${result.status} ${result.latestVersion}`);
  ok('Versión ya actualizada', `el manifiesto anuncia ${from} → actualizado, última disponible ${result.latestVersion}`);

  // 3. Sin conexión.
  mode = 'offline';
  result = await check(ui);
  assert(result.status === 'error' && result.error?.code === 'network', `Sin conexión: ${result.status} ${JSON.stringify(result.error)}`);
  ok('Sin conexión', 'conexión cortada por el servidor → error «network» y nada descargado');

  // 4. Error de descarga.
  mode = 'asset-error';
  result = await check(ui);
  assert(result.status === 'available' && result.available?.version === to, `Error de descarga, comprobación: ${result.status}`);
  await ui.evaluate('window.icarusNative.updates.download({ install: false })');
  result = await waitStatus(ui, ['error'], 'La descarga con error 500 no terminó en error');
  assert(sha256(app) === originalSha, 'El AppImage instalado cambió tras un error de descarga');
  assert(result.error?.code === 'server', `Error de descarga: ${JSON.stringify(result.error)}`);
  ok('Error de descarga', `HTTP 500 → error «${result.error?.code}» («respondió con un error»), AppImage intacto`);

  // 5. Hash incorrecto.
  mode = 'bad-hash';
  result = await check(ui);
  assert(result.status === 'available', `Hash incorrecto, comprobación: ${result.status}`);
  await ui.evaluate('window.icarusNative.updates.download({ install: false })');
  result = await waitStatus(ui, ['error'], 'Un paquete con otra huella no terminó en error');
  assert(result.error?.code === 'hash-mismatch', `Hash incorrecto: ${JSON.stringify(result.error)}`);
  assert(!existsSync(join(dataDir, 'updates', to, asset.file)), 'El paquete con otra huella no se borró');
  assert(sha256(app) === originalSha, 'El AppImage instalado cambió con un paquete con otra huella');
  ok('Paquete con hash incorrecto', 'descargado entero, rechazado («hash-mismatch»), borrado y sin instalar');

  // 6. Actualización fallida: el paquete nuevo no arranca → vuelve la versión anterior.
  mode = 'broken';
  result = await check(ui);
  assert(result.status === 'available' && result.available?.version === broken, `Paquete dañado, comprobación: ${result.status} ${result.available?.version}`);
  await ui.evaluate('window.icarusNative.updates.download({ install: true })');
  const code = await Promise.race([first.exited, sleep(180_000).then(() => 'timeout')]);
  assert(code !== 'timeout', 'ICARUS no se cerró para instalar el paquete dañado');
  for (const session of first.sessions) session.close();
  const restored = await waitRelaunchedAndClose('Tras el paquete dañado');
  const log = readFileSync(join(dataDir, 'updates', 'actualizacion.log'), 'utf8');
  assert(/se restaura la anterior/.test(log), `El proceso auxiliar no restauró la versión anterior:\n${log}`);
  assert(sha256(app) === originalSha, 'Tras el fallo, el AppImage no es el original');
  assert(!existsSync(`${app}.icarus-anterior`), 'Quedó la copia de seguridad tras restaurar');
  const third = await launch('Versión restaurada');
  assert((await third.ui.evaluate('window.icarusNative.appVersion')) === from, 'Tras el fallo no se ejecuta la versión anterior');
  result = await state(third.ui);
  // La instancia que reabrió el proceso auxiliar ya mostró el fallo; queda registrado para no reintentarlo solo.
  assert(result.failedVersion === broken && !readJson('updates.json')?.pending, `Tras el fallo: ${JSON.stringify({ failed: result.failedVersion, pending: readJson('updates.json')?.pending })}`);
  await dataIntact(third.ui, 'Tras el fallo');
  ok('Actualización fallida y recuperación', `${broken} no arrancó → se restauró ${from} (${restored.how}); avisa «install-failed», no la reintenta sola y los datos siguen`);

  // 7. Descarga interrumpida → se reanuda.
  mode = 'interrupt';
  result = await check(third.ui);
  assert(result.status === 'available' && result.available?.version === to, `Interrumpida, comprobación: ${result.status} ${result.available?.version}`);
  await third.ui.evaluate('window.icarusNative.updates.download({ install: false })');
  result = await waitStatus(third.ui, ['error', 'ready'], 'La descarga interrumpida no terminó');
  assert(result.status === 'error' && ['interrupted', 'network'].includes(result.error?.code), `Interrumpida: ${result.status} ${JSON.stringify(result.error)}`);
  const interruption = result.error.code;
  mode = 'normal';
  await third.ui.evaluate('window.icarusNative.updates.download({ install: false })');
  result = await waitStatus(third.ui, ['ready', 'error'], 'La descarga reanudada no terminó');
  assert(result.status === 'ready', `Reanudada: ${result.status} ${JSON.stringify(result.error)}`);
  assert(requests.some((line) => line.startsWith('normal GET') && line.includes(`/v${to}/`) && line.includes('(bytes=')), `No se reanudó con Range:\n${requests.join('\n')}`);
  ok('Actualización interrumpida', `corte a la mitad → «${interruption}»; al reintentar se reanuda con Range y se verifica`);

  // 8. Actualización real con reinicio.
  await third.ui.evaluate(`window.icarusNative.updates.install('now')`);
  const code2 = await Promise.race([third.exited, sleep(180_000).then(() => 'timeout')]);
  assert(code2 !== 'timeout', 'ICARUS no se cerró para instalar');
  for (const session of third.sessions) session.close();
  ok('ICARUS se cerró solo para instalar', `código ${code2}`);
  await eventually(() => sha256(app) === asset.sha256, `El AppImage no se sustituyó por la versión ${to}`, 120_000);
  const relaunched = await waitRelaunchedAndClose('Versión nueva');
  ok('El AppImage se sustituyó y ICARUS se volvió a abrir solo', `pid ${relaunched.relaunched.pid}${relaunched.relaunched.command.includes('--updated') ? ', con --updated' : ''}; cerrado con ${relaunched.how}`);
  const confirmed = readFileSync(confirmFile, 'utf8').trim();
  assert(confirmed === to, `Confirmación de arranque: ${confirmed}`);
  // La instancia reabierta usó las pestañas guardadas antes del reinicio.
  const restartSession = (() => {
    try {
      return JSON.parse(readFileSync(join(dataDir, 'ui-storage.json'), 'utf8')).data['icarus.updateRestartSession'];
    } catch {
      return null;
    }
  })();
  assert(restartSession === undefined, 'La instancia reabierta no usó las pestañas guardadas para el reinicio');
  assert(!existsSync(`${app}.icarus-anterior`), 'No se borró la copia de la versión anterior tras confirmar');
  assert(statSync(app).mode & 0o100, 'El AppImage nuevo no es ejecutable');

  const fourth = await launch('Versión nueva (comprobación)');
  assert((await fourth.ui.evaluate('window.icarusNative.appVersion')) === to, 'La interfaz no es la versión nueva');
  result = await state(fourth.ui);
  assert(result.currentVersion === to && result.failedVersion === null && result.error === null, `Estado tras actualizar: ${JSON.stringify(result)}`);
  assert(!readJson('updates.json')?.pending, 'La instalación no se confirmó');
  await dataIntact(fourth.ui, 'Tras actualizar');
  ok('Versión nueva en ejecución con los datos intactos', `${to}; la instancia reabierta usó las pestañas guardadas antes del reinicio`);
  result = await check(fourth.ui);
  assert(result.status === 'up-to-date', `Tras actualizar se ofrece otra vez: ${result.status}`);
  await sleep(3000);
  assert(fourth.exitCode === undefined, 'ICARUS se cerró solo después de actualizar (posible bucle)');
  ok('No se vuelve a ofrecer ni a instalar (sin bucles)');
} catch (error) {
  failed = true;
  console.error(`  ✗ ${error.stack ?? error.message}`);
  for (const run of runs) console.error(`\n--- Salida de «${run.label}» (últimos 3000 caracteres) ---\n${run.output.slice(-3000)}`);
  console.error(`\n--- Peticiones al servidor de prueba ---\n${requests.join('\n')}`);
  console.error(`\n--- updates.json ---\n${JSON.stringify(readJson('updates.json'))}`);
  const log = join(dataDir, 'updates', 'actualizacion.log');
  if (existsSync(log)) console.error(`\n--- updates/actualizacion.log ---\n${readFileSync(log, 'utf8')}`);
} finally {
  for (const run of runs) {
    for (const session of run.sessions) session.close();
    if (run.exitCode === undefined && run.child.exitCode === null) await closeGracefully(run.child.pid);
  }
  for (const item of icarusProcesses()) await closeGracefully(item.pid);
  server.close();
  await sleep(1000);
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
console.log(failed ? 'La prueba de actualización de Linux falló.' : `Prueba de actualización de Linux superada (${results.length} comprobaciones).`);
process.exit(failed ? 1 : 0);
