/**
 * Prueba de humo del ejecutable empaquetado por electron-builder.
 *
 * El ejecutable final tiene los fusibles de Electron activados (sin
 * `--inspect` ni ELECTRON_RUN_AS_NODE), así que Playwright no puede
 * controlarlo como en run.mjs. Esta prueba lo arranca con el puerto de
 * depuración de Chromium, se conecta por CDP a la interfaz y abre una página
 * de un servidor local desde la barra de direcciones.
 *
 * Uso: npm run dist:dir (o dist:win) && node tests/e2e/smoke-packaged.mjs [ejecutable [argumentos…]]
 * Sin argumento busca el ejecutable de release/ para la plataforma actual. Con
 * el Electron de desarrollo hay que pasar la carpeta del proyecto:
 *   node tests/e2e/smoke-packaged.mjs node_modules/electron/dist/electron .
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
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
async function eventually(fn, message, timeout = 20_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await sleep(200);
  }
  throw new Error(`${message} (último valor: ${last instanceof Error ? last.message : JSON.stringify(last)})`);
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
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
    if (match) resolve(match[1]);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code) => reject(new Error(`El ejecutable terminó al arrancar (código ${code}).\n${output}`)));
  setTimeout(() => reject(new Error(`El ejecutable no abrió el puerto de depuración.\n${output}`)), 60_000);
});

let browser;
let failed = false;
try {
  browser = await chromium.connectOverCDP(await endpoint);
  const pages = () => browser.contexts().flatMap((context) => context.pages());
  const ui = await eventually(() => pages().find((page) => page.url().startsWith('icarus-app://ui/')), 'No apareció la interfaz icarus-app://');
  await ui.waitForSelector('.browser--desktop', { timeout: 30_000 });

  const info = await ui.evaluate(() => ({
    version: window.icarusNative?.appVersion,
    chromium: window.icarusNative?.chromiumVersion,
    node: typeof window.require !== 'undefined' || typeof window.process !== 'undefined',
  }));
  assert(info.version === pkg.version, `La versión no coincide (${info.version} ≠ ${pkg.version})`);
  assert(!info.node, 'La interfaz tiene acceso a Node.js');
  console.log(`  ✓ Interfaz cargada · ICARUS ${info.version} · Chromium ${info.chromium}`);

  const bar = ui.getByRole('combobox', { name: 'Barra de direcciones' });
  await bar.click();
  await ui.keyboard.press('Control+A');
  await ui.keyboard.type(pageUrl);
  await ui.keyboard.press('Enter');
  const web = await eventually(() => pages().find((page) => page.url() === pageUrl), 'La página local no se abrió en una vista web');
  await eventually(async () => (await web.title()) === 'Humo ICARUS', 'La página local no terminó de cargar');
  assert(await web.evaluate(() => typeof window.icarusNative === 'undefined'), 'La página web recibió el puente nativo');
  await eventually(async () => (await ui.locator('[role="tab"][aria-selected="true"]').innerText()).includes('Humo ICARUS'), 'La pestaña no muestra el título real');
  console.log('  ✓ Página cargada dentro de la pestaña, sin acceso al puente nativo');

  const files = await eventually(() => {
    const list = readdirSync(dataDir);
    return list.includes('ui-storage.json') ? list : null;
  }, 'No se guardaron datos en la carpeta de usuario');
  console.log(`  ✓ Datos guardados en la carpeta de usuario (${files.length} elementos)`);
} catch (error) {
  failed = true;
  console.error(`  ✗ ${error.message}`);
  console.error(`\n--- Salida del ejecutable (últimos 6000 caracteres) ---\n${output.slice(-6000)}`);
  if (process.platform === 'win32') console.error(`\n--- Ventanas abiertas por el ejecutable ---\n${describeWindows(child.pid)}`);
} finally {
  await browser?.close().catch(() => {});
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
