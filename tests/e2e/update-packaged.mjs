/**
 * Prueba real de actualización de ICARUS ya instalado, de una versión a la
 * siguiente, en Windows (instalador NSIS) y macOS (app en una carpeta con
 * permiso de escritura).
 *
 * 1. Sirve en 127.0.0.1 la versión nueva con la misma estructura que GitHub
 *    Releases: manifiesto firmado con una clave de prueba, su firma y el paquete.
 * 2. Arranca la versión instalada con una carpeta de datos temporal, abre dos
 *    páginas en dos pestañas y guarda datos (almacenamiento de la interfaz,
 *    preferencias e historial).
 * 3. Pulsa el aviso «Actualizar» de la barra y «Actualizar ahora», como un
 *    usuario. Comprueba que ICARUS guarda las pestañas, se cierra solo, que el
 *    paquete sustituye a la versión instalada y que ICARUS se vuelve a abrir.
 * 4. Vuelve a arrancarlo: versión nueva, los mismos datos, la instalación
 *    confirmada sin errores y la versión nueva no se vuelve a ofrecer (sin bucles).
 *
 * Uso:
 *   node tests/e2e/update-packaged.mjs --app EJECUTABLE_INSTALADO --feed CARPETA_VERSION_NUEVA \
 *     --public-key CLAVE_DE_PRUEBA.pem --from 0.2.0 --to 0.2.1
 *
 * La carpeta del paquete nuevo se genera con scripts/release/make-manifest.mjs y
 * sign-manifest.mjs (ver .github/workflows/windows.yml y macos.yml).
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { assert, CdpSession, eventually, sleep } from './cdp.mjs';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');

const { values } = parseArgs({
  options: {
    app: { type: 'string' },
    feed: { type: 'string' },
    'public-key': { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
  },
});
for (const name of ['app', 'feed', 'public-key', 'from', 'to']) {
  if (!values[name]) {
    console.error(`Falta --${name}`);
    process.exit(1);
  }
}
const app = resolve(values.app);
const feedDir = resolve(values.feed);
const from = values.from;
const to = values.to;
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
if (!isWindows && !isMac) {
  console.error('La prueba de actualización instalada solo existe para Windows y macOS.');
  process.exit(1);
}
// macOS: …/ICARUS Browser.app/Contents/MacOS/ICARUS Browser
const bundle = isMac ? resolve(app, '..', '..', '..') : null;
const appAsar = isMac ? join(bundle, 'Contents', 'Resources', 'app.asar') : join(dirname(app), 'resources', 'app.asar');

/* ----------------------- Servidor con la estructura de GitHub ---------------------- */

const requests = [];
const PAGES = { '/paginas/uno.html': 'Página uno', '/paginas/dos.html': 'Página dos' };
const server = http.createServer((request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  requests.push(`${request.method} ${path}${request.headers.range ? ` (${request.headers.range})` : ''}`);
  if (PAGES[path]) {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>${PAGES[path]}</title><h1>${PAGES[path]}</h1>`);
    return;
  }
  // Solo el manifiesto de «latest» y los archivos de la versión nueva.
  const latest = /^\/releases\/latest\/download\/([^/]+)$/.exec(path);
  const asset = /^\/releases\/download\/([^/]+)\/([^/]+)$/.exec(path);
  const name = latest ? latest[1] : asset && asset[1] === `v${to}` ? asset[2] : null;
  const file = name ? join(feedDir, basename(name)) : null;
  if (!file || !existsSync(file)) {
    response.writeHead(404);
    response.end();
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
  createReadStream(file).pipe(response);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const pageOne = `${origin}/paginas/uno.html`;
const pageTwo = `${origin}/paginas/dos.html`;

const dataDir = mkdtempSync(join(tmpdir(), 'icarus-update-'));
const env = {
  ...process.env,
  ICARUS_USER_DATA_DIR: dataDir,
  ICARUS_SHIELD_AUTO_UPDATE: '0',
  ICARUS_UPDATE_FEED: origin,
  ICARUS_UPDATE_PUBLIC_KEY_FILE: resolve(values['public-key']),
  ICARUS_UPDATE_CHECK_DELAY_MS: '0',
  ELECTRON_ENABLE_LOGGING: '1',
};

/* ----------------------------------- Utilidades ----------------------------------- */

function builtVersion() {
  try {
    // @electron/asar guarda la cabecera de cada archivo: el instalador lo sustituye.
    asar.uncache(appAsar);
    return JSON.parse(asar.extractFile(appAsar, 'dist-electron/build-info.json').toString('utf8')).version;
  } catch {
    return null;
  }
}

function readJson(name) {
  try {
    return JSON.parse(readFileSync(join(dataDir, name), 'utf8')).data ?? null;
  } catch {
    return null;
  }
}

/** Procesos principales de ICARUS (sin los auxiliares de Chromium) con su línea de órdenes. */
function icarusProcesses() {
  if (isWindows) {
    const script =
      "Get-CimInstance Win32_Process -Filter \"Name = 'ICARUS Browser.exe'\" | ForEach-Object { '{0}`t{1}' -f $_.ProcessId, $_.CommandLine }";
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
    return parseProcesses(result.stdout);
  }
  // Solo procesos cuyo ejecutable es ICARUS (la línea de esta prueba también contiene la ruta).
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  return parseProcesses(
    result.stdout
      .split('\n')
      .map((line) => line.trim().replace(/^(\d+)\s+/, '$1\t'))
      .filter((line) => /^\d+\t\/.*\/ICARUS Browser\.app\/Contents\/MacOS\/ICARUS Browser(\s|$)/.test(line))
      .join('\n'),
  );
}

function parseProcesses(text) {
  return (text ?? '')
    .split(/\r?\n/)
    .map((line) => line.split('\t'))
    .filter(([pid, command]) => /^\d+$/.test(pid ?? '') && Number(pid) !== process.pid && command && !command.includes('--type='))
    .map(([pid, command]) => ({ pid: Number(pid), command }));
}

const alive = (pid) => icarusProcesses().some((item) => item.pid === pid);

/**
 * Cierre normal (como cerrar la ventana o Cmd+Q): ICARUS guarda sus datos al salir.
 * Devuelve cómo se cerró; si no responde, se termina a la fuerza y se indica.
 */
async function closeGracefully(pid) {
  const waitExit = async (ms) => {
    for (let i = 0; i < ms / 500 && alive(pid); i++) await sleep(500);
    return !alive(pid);
  };
  if (isWindows) {
    spawnSync('taskkill', ['/PID', String(pid)], { stdio: 'ignore' });
    if (await waitExit(30_000)) return 'cerrar la ventana';
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    await waitExit(10_000);
    return 'terminada a la fuerza (no respondió al cierre)';
  }
  // macOS: el evento «quit» de las apps (lo mismo que Cmd+Q).
  spawnSync('/usr/bin/osascript', ['-e', 'quit app id "io.github.saaqes.icarusbrowser"'], { stdio: 'ignore', timeout: 15_000 });
  if (await waitExit(20_000)) return 'evento quit (Cmd+Q)';
  spawnSync('/bin/kill', ['-TERM', String(pid)], { stdio: 'ignore' });
  if (await waitExit(15_000)) return 'SIGTERM';
  spawnSync('/bin/kill', ['-KILL', String(pid)], { stdio: 'ignore' });
  await waitExit(10_000);
  return 'terminada a la fuerza (no respondió a quit ni a SIGTERM)';
}

/** Arranca el ejecutable instalado con el puerto de depuración y conecta con la interfaz. */
async function launch(label) {
  const child = spawn(app, ['--remote-debugging-port=0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const run = { label, child, output: '', exitCode: undefined, sessions: [] };
  const exited = new Promise((done) =>
    child.once('exit', (code) => {
      run.exitCode = code;
      done(code);
    }),
  );
  run.exited = exited;
  const endpoint = await new Promise((done, reject) => {
    const onData = (chunk) => {
      run.output += chunk;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(run.output);
      if (match) done(new URL(match[1]));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    exited.then((code) => reject(new Error(`${label}: el ejecutable terminó (código ${code})\n${run.output.slice(-4000)}`)));
    setTimeout(() => reject(new Error(`${label}: no abrió el puerto de depuración`)), 90_000);
  });
  const base = `http://${endpoint.host}`;
  run.targets = async () => (await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  const target = await eventually(
    async () => (await run.targets()).find((item) => item.type === 'page' && item.url.startsWith('icarus-app://ui/')),
    `${label}: la interfaz no apareció`,
    60_000,
  );
  run.ui = await CdpSession.connect(target.webSocketDebuggerUrl);
  run.sessions.push(run.ui);
  await eventually(() => run.ui.evaluate("Boolean(document.querySelector('.browser--desktop'))"), `${label}: la interfaz no terminó de cargar`);
  return run;
}

async function navigate(ui, url) {
  await ui.send('Page.bringToFront');
  await ui.evaluate(`(() => {
    const bar = document.querySelector('.toolbar input[role="combobox"]');
    bar.focus();
    bar.select();
    return true;
  })()`);
  await ui.send('Input.insertText', { text: url });
  for (const type of ['keyDown', 'keyUp']) {
    await ui.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) });
  }
}

const tabTitles = (ui) => ui.evaluate(`[...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent.trim())`);
const clickButton = (ui, scope, text) =>
  ui.evaluate(`(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find((item) => item.textContent.includes(${JSON.stringify(text)}));
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);

/* ------------------------------------- Prueba ------------------------------------- */

let failed = false;
const runs = [];
try {
  console.log(`ICARUS · actualización real ${from} → ${to} · ${app}`);
  assert(builtVersion() === from, `La versión instalada es ${builtVersion()}, no ${from}`);

  /* 1. Versión instalada: datos del usuario. */
  const first = await launch('Versión instalada');
  runs.push(first);
  const { ui } = first;
  assert((await ui.evaluate('window.icarusNative.appVersion')) === from, 'La interfaz no es la versión instalada');
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
  console.log('  ✓ Dos pestañas, historial, preferencias y almacenamiento de la interfaz con datos');

  /* 2. Aviso de la versión nueva y «Actualizar ahora». */
  const available = await eventually(async () => {
    const state = await ui.evaluate('window.icarusNative.updates.getState()');
    if (state.status === 'error') throw new Error(`Error del actualizador: ${JSON.stringify(state.error)}`);
    return state.status === 'available' && state.available?.version === to ? state : null;
  }, 'No se detectó la versión nueva', 60_000);
  assert(available.mode === 'automatic', `Modo de instalación ${available.mode}, se esperaba automatic`);
  await eventually(() => ui.evaluate(`Boolean(document.querySelector('.update-btn'))`), 'No apareció el aviso «Actualizar» en la barra');
  await ui.evaluate(`document.querySelector('.update-btn').click()`);
  await eventually(() => clickButton(ui, '.update-popover', 'Actualizar ahora'), 'No apareció «Actualizar ahora»');
  console.log(`  ✓ Aviso de la versión ${to} y «Actualizar ahora» pulsado`);

  const code = await Promise.race([first.exited, sleep(240_000).then(() => 'timeout')]);
  assert(code !== 'timeout', 'ICARUS no se cerró para instalar la actualización');
  for (const session of first.sessions) session.close();
  console.log(`  ✓ ICARUS se cerró solo para instalar (código ${code})`);
  const restart = readJson('ui-storage.json')?.['icarus.updateRestartSession'];
  const pending = readJson('updates.json')?.pending;
  // La relanzada puede haber empezado ya en Windows; si no, las pestañas deben estar guardadas.
  if (restart) {
    const tabs = JSON.parse(restart).data.tabs;
    assert(tabs.length === 2, `Se guardaron ${tabs.length} pestañas para el reinicio`);
    console.log('  ✓ Pestañas guardadas para reabrirlas tras el reinicio');
  }
  assert(pending === undefined || pending === null || (pending.from === from && pending.to === to && pending.manual === false), `Marca de instalación inesperada: ${JSON.stringify(pending)}`);

  /* 3. Instalación y reinicio automático. */
  await eventually(() => builtVersion() === to, `La versión instalada no cambió a ${to}`, 300_000);
  if (isWindows) {
    await eventually(() => {
      const list = spawnSync('tasklist', ['/FI', `IMAGENAME eq ICARUS-Browser-Setup-${to}.exe`, '/NH'], { encoding: 'utf8' }).stdout ?? '';
      return !list.includes('ICARUS-Browser-Setup');
    }, 'El instalador no terminó', 300_000);
  } else {
    assert(!existsSync(`${bundle}.icarus-anterior`), 'Quedó la copia de la versión anterior');
    const plist = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', join(bundle, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim();
    assert(plist === to, `Info.plist dice ${plist}`);
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
  }
  console.log(`  ✓ El paquete sustituyó a la versión instalada (${to})`);

  const relaunched = await eventually(() => icarusProcesses()[0] ?? null, 'ICARUS no se volvió a abrir tras instalar', 90_000);
  console.log(`  ✓ ICARUS se volvió a abrir solo (pid ${relaunched.pid}${relaunched.command.includes('--updated') ? ', con --updated' : ''})`);
  await sleep(8000);
  console.log(`  · ICARUS reabierto cerrado con: ${await closeGracefully(relaunched.pid)}`);
  const resolvedByRelaunch = !readJson('updates.json')?.pending;

  /* 4. Versión nueva: datos conservados y sin bucles. */
  const second = await launch('Versión nueva');
  runs.push(second);
  const next = second.ui;
  assert((await next.evaluate('window.icarusNative.appVersion')) === to, 'La interfaz no es la versión nueva');
  const state = await next.evaluate('window.icarusNative.updates.getState()');
  assert(state.currentVersion === to && state.failedVersion === null && state.error === null, `Estado tras actualizar: ${JSON.stringify(state)}`);
  if (resolvedByRelaunch) {
    // El ICARUS reabierto por el instalador ya confirmó la instalación (y reabrió las pestañas).
    assert(readJson('ui-storage.json')?.['icarus.updateRestartSession'] === undefined, 'La sesión del reinicio no se usó');
    console.log('  ✓ La instancia reabierta confirmó la instalación y usó las pestañas guardadas');
  } else {
    assert(state.justUpdated?.from === from && state.justUpdated?.to === to, `Sin confirmación de la actualización: ${JSON.stringify(state.justUpdated)}`);
    const titles = await tabTitles(next);
    assert(titles.length === 2 && titles.some((title) => title.includes('Página uno')) && titles.some((title) => title.includes('Página dos')), `Pestañas tras actualizar: ${JSON.stringify(titles)}`);
    console.log('  ✓ Se reabrieron las dos pestañas');
    await navigate(next, 'icarus://configuracion/actualizaciones');
    await eventually(
      () => next.evaluate(`document.body.innerText.includes(${JSON.stringify(`ICARUS se ha actualizado de la versión ${from} a la ${to}.`)})`),
      'Configuración → Actualizaciones no confirma la versión instalada',
    );
    console.log(`  ✓ Configuración confirma «actualizado de la versión ${from} a la ${to}»`);
  }
  assert(!existsSync(join(dataDir, 'updates')), 'No se borró la carpeta de descargas de actualizaciones');

  const snapshot = await next.evaluate('window.icarusNative.storage.snapshot');
  assert(snapshot['icarus.e2eUpdateMarker'] === 'conservado', 'Se perdió el almacenamiento de la interfaz');
  const after = await next.evaluate('window.icarusNative.preferences.get()');
  assert(after.downloads.askWhereToSave === askWhereToSave, 'Se perdieron las preferencias');
  const history = (await next.evaluate('window.icarusNative.history.list()')).map((item) => item.url);
  assert(history.includes(pageOne) && history.includes(pageTwo), 'Se perdió el historial');
  console.log('  ✓ Almacenamiento, preferencias e historial conservados');

  // La comprobación automática al arrancar puede estar en curso: se espera a que termine.
  const recheck = await eventually(async () => {
    const result = await next.evaluate('window.icarusNative.updates.check()');
    return result.status === 'checking' ? null : result;
  }, 'La comprobación tras actualizar no terminó');
  assert(recheck.status === 'up-to-date', `Tras actualizar se ofrece otra vez: ${recheck.status}`);
  await sleep(5000);
  assert(second.exitCode === undefined, 'ICARUS se cerró solo después de actualizar (posible bucle)');
  assert(!(await next.evaluate(`Boolean(document.querySelector('.update-btn'))`)), 'El aviso de actualización sigue en la barra');
  console.log('  ✓ La versión nueva no vuelve a ofrecerse ni a instalarse (sin bucles)');
  const downloads = requests.filter((line) => line.includes(`/releases/download/v${to}/`));
  console.log(`  · Descargas servidas: ${downloads.join(', ')}`);
} catch (error) {
  failed = true;
  console.error(`  ✗ ${error.stack ?? error.message}`);
  for (const run of runs) console.error(`\n--- Salida de «${run.label}» (últimos 5000 caracteres) ---\n${run.output.slice(-5000)}`);
  console.error(`\n--- Peticiones al servidor de prueba ---\n${requests.join('\n')}`);
  console.error(`\n--- updates.json ---\n${JSON.stringify(readJson('updates.json'))}`);
  for (const name of ['reinicio.log', 'reiniciar.cmd']) {
    const path = join(dataDir, 'updates', name);
    if (existsSync(path)) console.error(`\n--- updates/${name} ---\n${readFileSync(path, 'utf8')}`);
  }
} finally {
  for (const run of runs) {
    for (const session of run.sessions) session.close();
    if (run.exitCode === undefined && run.child.exitCode === null) {
      console.log(`  · «${run.label}» cerrada con: ${await closeGracefully(run.child.pid)}`);
    }
  }
  for (const item of icarusProcesses()) await closeGracefully(item.pid);
  server.close();
  await sleep(1000);
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
console.log(failed ? 'La prueba de actualización falló.' : 'Prueba de actualización superada.');
process.exit(failed ? 1 : 0);
