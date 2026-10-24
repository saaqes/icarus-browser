/**
 * Prueba de humo del ejecutable empaquetado por electron-builder.
 *
 * El ejecutable final tiene los fusibles de Electron activados (sin
 * `--inspect` ni ELECTRON_RUN_AS_NODE), así que Playwright no puede
 * controlarlo como en run.mjs. Esta prueba lo arranca con el puerto de
 * depuración de Chromium y habla directamente el protocolo DevTools (CDP):
 * espera a que la interfaz aparezca en /json/list, escribe una dirección en la
 * barra y comprueba que la página se carga en una vista web sin el puente
 * nativo. No usa la conexión automática de Playwright a todas las vistas.
 *
 * Uso: npm run dist:dir (o dist:win) && node tests/e2e/smoke-packaged.mjs [ejecutable [argumentos…]]
 * Sin argumento busca el ejecutable de release/ para la plataforma actual. Con
 * el Electron de desarrollo hay que pasar la carpeta del proyecto:
 *   node tests/e2e/smoke-packaged.mjs node_modules/electron/dist/electron .
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));

const DEFAULT_EXECUTABLES = {
  win32: join(projectDir, 'release', 'win-unpacked', `${pkg.productName}.exe`),
  linux: join(projectDir, 'release', 'linux-unpacked', pkg.name),
  darwin: join(projectDir, 'release', 'mac', `${pkg.productName}.app`, 'Contents', 'MacOS', pkg.productName),
};
const executable = process.argv[2] ?? DEFAULT_EXECUTABLES[process.platform];
if (!executable || !existsSync(executable)) {
  console.error(`No se encontró el ejecutable empaquetado: ${executable}`);
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(fn, message, timeout = 30_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await sleep(250);
  }
  throw new Error(`${message} (último valor: ${last instanceof Error ? last.message : JSON.stringify(last)})`);
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/* ------------------------------ Cliente CDP mínimo ----------------------------- */

class CdpSession {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error(`No se pudo conectar a ${url}`)), { once: true });
    });
    return new CdpSession(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      const waiter = message.id ? this.pending.get(message.id) : undefined;
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
      else waiter.resolve(message.result);
    });
  }

  send(method, params = {}, timeout = 15_000) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: sin respuesta en ${timeout} ms`));
      }, timeout);
      this.pending.set(id, {
        method,
        resolve: (value) => (clearTimeout(timer), resolve(value)),
        reject: (error) => (clearTimeout(timer), reject(error)),
      });
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }

  close() {
    this.socket.close();
  }
}

/**
 * Diagnóstico en Windows: lista las ventanas de nivel superior de los procesos
 * de Electron y el texto que contienen (p. ej. un cuadro de error que bloquea
 * el proceso principal), mediante UI Automation.
 */
function describeWindows(rootPid) {
  const script = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$ids = @(${rootPid}) + @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${rootPid} } | ForEach-Object { $_.ProcessId })
$root = [Windows.Automation.AutomationElement]::RootElement
$all = [Windows.Automation.Condition]::TrueCondition
foreach ($window in $root.FindAll([Windows.Automation.TreeScope]::Children, $all)) {
  if ($ids -notcontains $window.Current.ProcessId) { continue }
  "Ventana «$($window.Current.Name)» clase=$($window.Current.ClassName) pid=$($window.Current.ProcessId)"
  $window.FindAll([Windows.Automation.TreeScope]::Descendants, $all) |
    Where-Object { $_.Current.Name } | Select-Object -First 40 |
    ForEach-Object { "    [$($_.Current.ControlType.ProgrammaticName)] $($_.Current.Name)" }
}`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 60_000 });
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() || '(ninguna ventana encontrada)';
}

/* --------------------------------- Prueba ---------------------------------- */

const server = http.createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><title>Humo ICARUS</title><h1>Página servida localmente</h1>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const pageUrl = `http://127.0.0.1:${server.address().port}/humo.html`;
const dataDir = mkdtempSync(join(tmpdir(), 'icarus-smoke-'));

console.log(`ICARUS prueba de humo · ${executable}`);
const child = spawn(executable, [...process.argv.slice(3), '--remote-debugging-port=0'], {
  env: { ...process.env, ICARUS_USER_DATA_DIR: dataDir, ICARUS_SHIELD_AUTO_UPDATE: '0', ELECTRON_ENABLE_LOGGING: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
const endpoint = new Promise((resolve, reject) => {
  const onData = (chunk) => {
    output += chunk;
    const match = /DevTools listening on (ws:\/\/\S+)/.exec(output);
    if (match) resolve(new URL(match[1]));
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code) => reject(new Error(`El ejecutable terminó (código ${code}).`)));
  setTimeout(() => reject(new Error('El ejecutable no abrió el puerto de depuración.')), 60_000);
});

let devtoolsBase = null;
async function targets() {
  const response = await fetch(`${devtoolsBase}/json/list`, { signal: AbortSignal.timeout(5000) });
  return response.json();
}

const sessions = [];
let failed = false;
try {
  const url = await endpoint;
  devtoolsBase = `http://${url.host}`;

  const uiTarget = await eventually(
    async () => (await targets()).find((target) => target.type === 'page' && target.url.startsWith('icarus-app://ui/')),
    'La interfaz icarus-app:// no apareció entre las vistas',
  );
  const ui = await CdpSession.connect(uiTarget.webSocketDebuggerUrl);
  sessions.push(ui);
  await eventually(() => ui.evaluate("Boolean(document.querySelector('.browser--desktop'))"), 'La interfaz no terminó de cargar');

  const info = await ui.evaluate(`({
    version: window.icarusNative?.appVersion,
    chromium: window.icarusNative?.chromiumVersion,
    node: typeof window.require !== 'undefined' || typeof window.process !== 'undefined',
  })`);
  assert(info.version === pkg.version, `La versión no coincide (${info.version} ≠ ${pkg.version})`);
  assert(!info.node, 'La interfaz tiene acceso a Node.js');
  console.log(`  ✓ Interfaz cargada · ICARUS ${info.version} · Chromium ${info.chromium}`);

  await ui.send('Page.bringToFront');
  await ui.evaluate(`(() => {
    const bar = document.querySelector('.toolbar input[role="combobox"]');
    bar.focus();
    bar.select();
    return true;
  })()`);
  await ui.send('Input.insertText', { text: pageUrl });
  for (const type of ['keyDown', 'keyUp']) {
    await ui.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) });
  }

  const webTarget = await eventually(
    async () => (await targets()).find((target) => target.url === pageUrl),
    'La página local no se abrió en una vista web',
  );
  const web = await CdpSession.connect(webTarget.webSocketDebuggerUrl);
  sessions.push(web);
  await eventually(async () => (await web.evaluate('document.readyState === "complete" && document.title')) === 'Humo ICARUS', 'La página local no terminó de cargar');
  assert((await web.evaluate('typeof window.icarusNative')) === 'undefined', 'La página web recibió el puente nativo');
  await eventually(
    () => ui.evaluate(`document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.includes('Humo ICARUS')`),
    'La pestaña no muestra el título real',
  );
  console.log('  ✓ Página cargada dentro de la pestaña, sin acceso al puente nativo');

  const files = await eventually(() => {
    const list = readdirSync(dataDir);
    return list.includes('ui-storage.json') ? list : null;
  }, 'No se guardaron datos en la carpeta de usuario');
  console.log(`  ✓ Datos guardados en la carpeta de usuario (${files.length} elementos)`);
} catch (error) {
  failed = true;
  console.error(`  ✗ ${error.message}`);
  if (devtoolsBase) {
    // Si /json/version no responde, el proceso principal está bloqueado.
    const version = await fetch(`${devtoolsBase}/json/version`, { signal: AbortSignal.timeout(5000) })
      .then((response) => response.text())
      .catch((reason) => `sin respuesta (${reason.message})`);
    const list = await targets()
      .then((items) => items.map((item) => `${item.type} ${item.url}`).join('\n'))
      .catch((reason) => `sin respuesta (${reason.message})`);
    console.error(`\n--- /json/version ---\n${version}\n--- /json/list ---\n${list}`);
  }
  console.error(`\n--- Salida del ejecutable (últimos 6000 caracteres) ---\n${output.slice(-6000)}`);
  if (process.platform === 'win32') console.error(`\n--- Ventanas abiertas por el ejecutable ---\n${describeWindows(child.pid)}`);
} finally {
  for (const session of sessions) session.close();
  const exited = new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', resolve)));
  // En Windows se termina todo el árbol de procesos de Chromium para liberar la carpeta de datos.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill();
  await Promise.race([exited, sleep(10_000)]);
  server.close();
  await sleep(1000);
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch (error) {
    console.warn(`  · No se pudo borrar la carpeta temporal ${dataDir}: ${error.message}`);
  }
}
console.log(failed ? 'La prueba de humo falló.' : 'Prueba de humo superada.');
process.exit(failed ? 1 : 0);
