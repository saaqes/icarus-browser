/**
 * Pruebas de extremo a extremo de la aplicación de escritorio (Electron real).
 *
 * Arranca ICARUS compilado (npm run build), un servidor HTTP local con páginas
 * de prueba y comprueba con Playwright la navegación real dentro de las
 * pestañas, el bloqueo de Shield, las descargas, las direcciones personalizadas
 * (escenarios A–H) y la persistencia.
 *
 * Uso: npm run build && npm run test:e2e
 * En Linux necesita una pantalla (p. ej. `xvfb-run -a npm run test:e2e`) y un
 * usuario que no sea root (Chromium no admite su sandbox como root).
 *
 * ICARUS_E2E_INTERNET=1 añade pruebas con sitios HTTPS reales (Wikipedia, Google y
 * YouTube, o los de ICARUS_E2E_SITES separados por comas). ICARUS_E2E_PROXY pasa
 * un proxy a Chromium (--proxy-server); los certificados se siguen verificando.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright-core');
const electronPath = require('electron');
const projectDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/* ------------------------------- Mini runner ------------------------------- */

const results = [];
async function step(name, fn) {
  const started = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, note });
    console.log(`  ✓ ${name}${note ? ` — ${note}` : ''} (${Date.now() - started} ms)`);
  } catch (error) {
    results.push({ name, ok: false, note: error.message });
    console.log(`  ✗ ${name}\n      ${String(error.message).split('\n').join('\n      ')}`);
    // Un paso fallido puede dejar abierto un menú o un diálogo: se cierra para que el
    // fallo no arrastre a los pasos siguientes.
    for (let i = 0; i < 2; i += 1) await win?.keyboard.press('Escape').catch(() => {});
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
/** Paso que no puede ejecutarse en este entorno: se informa, no cuenta como superado. */
function skip(name, reason) {
  results.push({ name, ok: true, skipped: true, note: reason });
  console.log(`  – ${name} (omitida: ${reason})`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(fn, message, timeout = 15_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await sleep(150);
  }
  throw new Error(`${message} (último valor: ${last instanceof Error ? last.message : JSON.stringify(last)})`);
}

/* ---------------------------- Servidor de pruebas --------------------------- */

const hits = { a: 0 };
const slowResponses = new Set();
// PNG de 1×1 píxeles usado como favicon de prueba.
const ICON_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
// GIF de 1×1 píxeles: segundo icono de /iconos.html, servido sin tipo de imagen.
const ICON_GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#d33"/></svg>';
const page = (title, body) =>
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const send = (status, type, body, headers = {}) => {
    response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers });
    response.end(body);
  };
  switch (url.pathname) {
    case '/a.html':
      hits.a += 1;
      return send(
        200,
        'text/html; charset=utf-8',
        page(
          'Página A',
          '<a id="to-b" href="/b.html">Ir a B</a> <a id="blank" href="/b.html?nueva=1" target="_blank">B en pestaña nueva</a>' +
            '<script src="/app.js"></script><script src="/ads/banner.js"></script>',
        ),
      );
    case '/b.html':
      return send(200, 'text/html; charset=utf-8', page('Página B', '<p>Segunda página</p>'));
    case '/app':
    case '/panel/usuarios':
      // Aplicación de una página: muestra su ruta (fragmento y consulta incluidos).
      return send(
        200,
        'text/html; charset=utf-8',
        page('Aplicación', '<p id="ruta"></p><script>const f=()=>ruta.textContent=location.pathname+location.search+location.hash;f();addEventListener("hashchange",f)</script>'),
      );
    case '/app.js':
      return send(200, 'text/javascript', 'window.appLoaded = true;');
    case '/ads/banner.js':
      return send(200, 'text/javascript', 'window.adLoaded = true;');
    case '/icono.html':
      // Chromium solo tiene en cuenta los <link rel="icon"> del <head>.
      return send(
        200,
        'text/html; charset=utf-8',
        '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Con icono</title><link rel="icon" href="/icono.png"></head><body><p>Icono propio</p></body></html>',
      );
    case '/icono.png':
      return send(200, 'image/png', Buffer.from(ICON_PNG, 'base64'));
    case '/iconos.html':
      // El primer icono no existe; el segundo es un GIF real servido como binario genérico.
      return send(
        200,
        'text/html; charset=utf-8',
        '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Varios iconos</title><link rel="icon" href="/no-existe.png"><link rel="icon" href="/icono-binario"></head><body><p>Iconos</p></body></html>',
      );
    case '/articulo.html':
      // Artículo con navegación, anuncio lateral y texto que parece HTML: el modo lectura
      // debe mostrar solo el texto principal y como texto.
      return send(
        200,
        'text/html; charset=utf-8',
        '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Diario de vuelo</title><meta name="author" content="Dédalo"></head><body>' +
          '<nav><a href="/a.html">Menú del sitio</a></nav><aside><p>Publicidad molesta que no debe leerse en el modo lectura.</p></aside>' +
          '<article><h1>Diario de vuelo</h1><p>El vuelo empezó al amanecer, con las alas recién enceradas y el viento a favor.</p>' +
          '<h2>Sobre el mar</h2><p>Ícaro subió demasiado y la cera empezó a ablandarse con el calor del sol de mediodía.</p>' +
          '<p>&lt;b&gt;Esto no es HTML&lt;/b&gt; y se muestra como texto.</p><ul><li>Plumas</li><li>Cera</li></ul></article>' +
          '<script src="/ads/banner.js"></script></body></html>',
      );
    case '/icono-binario':
      return send(200, 'application/octet-stream', Buffer.from(ICON_GIF, 'base64'));
    case '/lento.html':
      // Envía el principio del documento y deja la respuesta abierta para que la pestaña siga cargando.
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.write('<!doctype html><title>Página lenta</title><p>Cargando…');
      slowResponses.add(response);
      response.on('close', () => slowResponses.delete(response));
      return undefined;
    case '/enlaces.html':
      return send(
        200,
        'text/html; charset=utf-8',
        page('Enlaces', '<a id="mail" href="mailto:prueba@example.com">Correo</a> <a id="file" href="file:///etc/hosts">Archivo local</a>'),
      );
    case '/ubicacion.html':
      return send(
        200,
        'text/html; charset=utf-8',
        page(
          'Ubicación',
          '<script>window.pedirUbicacion = () => navigator.geolocation.getCurrentPosition(() => (window.geo = "ok"), (error) => (window.geo = "error-" + error.code));</script>',
        ),
      );
    case '/privado':
      if (request.headers.authorization === `Basic ${Buffer.from('icarus:secreto').toString('base64')}`) {
        return send(200, 'text/html; charset=utf-8', page('Zona privada', '<p>Acceso concedido</p>'));
      }
      return send(401, 'text/html; charset=utf-8', page('Acceso denegado', '<p>Hace falta iniciar sesión</p>'), {
        'www-authenticate': 'Basic realm="Zona de pruebas ICARUS"',
      });
    case '/texto.html':
      return send(200, 'text/html; charset=utf-8', page('Texto', '<p>Cuaderno de vuelo</p><p>El vuelo de ICARUS</p><p>Plan de vuelo nocturno</p>'));
    case '/salto':
      // Redirección dentro del mismo sitio: se sigue mostrando la dirección personalizada.
      return send(302, 'text/plain', 'Redirigiendo', { location: '/b.html' });
    case '/redirige':
      // Redirección a otro sitio: la barra pasa a mostrar la dirección real del sitio de llegada.
      return send(302, 'text/plain', 'Redirigiendo', { location: `${local}/b.html` });
    case '/archivo.txt':
      return send(200, 'text/plain; charset=utf-8', 'Contenido de prueba de ICARUS\n', {
        'content-disposition': 'attachment; filename="informe-icarus.txt"',
      });
    default:
      return send(404, 'text/plain', 'No encontrado');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
// El mismo servidor con otro host: la dirección personalizada del paso 12 solo cubre 127.0.0.1.
const local = base.replace('127.0.0.1', 'localhost');
const localHost = new URL(local).host;

/**
 * Servidor HTTPS con un certificado autofirmado creado con openssl, para comprobar
 * que ICARUS rechaza certificados no válidos. Devuelve null si no hay openssl.
 */
async function startSelfSignedServer() {
  const dir = mkdtempSync(join(tmpdir(), 'icarus-tls-'));
  const candidates = process.platform === 'win32' ? ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe'] : ['openssl'];
  const args = ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'];
  for (const command of candidates) {
    const result = spawnSync(command, [...args, '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], {
      stdio: 'ignore',
      // Evita que el openssl de Git para Windows convierta «/CN=…» en una ruta.
      env: { ...process.env, MSYS2_ARG_CONV_EXCL: '*' },
    });
    if (result.status !== 0) continue;
    const tls = https.createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>No debería mostrarse</title>');
    });
    await new Promise((resolve) => tls.listen(0, '127.0.0.1', resolve));
    return { tls, dir };
  }
  rmSync(dir, { recursive: true, force: true });
  return null;
}

/* ------------------------------ Utilidades app ------------------------------ */

const dataDir = mkdtempSync(join(tmpdir(), 'icarus-e2e-'));
const downloadDir = mkdtempSync(join(tmpdir(), 'icarus-descargas-'));

async function launch() {
  // ELECTRON_ENABLE_LOGGING añade los mensajes de Chromium al registro si el arranque falla.
  // ICARUS_STARTUP_DELAY_MS deja que Playwright termine de conectarse antes de que se cree la ventana.
  const env = {
    ...process.env,
    ICARUS_USER_DATA_DIR: dataDir,
    ICARUS_SHIELD_AUTO_UPDATE: '0',
    ICARUS_STARTUP_DELAY_MS: '2000',
    ELECTRON_ENABLE_LOGGING: '1',
  };
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_RUN_AS_NODE;
  const extraArgs = process.env.ICARUS_E2E_PROXY ? [`--proxy-server=${process.env.ICARUS_E2E_PROXY}`] : [];
  const app = await _electron.launch({ executablePath: electronPath, args: [projectDir, ...extraArgs], env, cwd: projectDir, timeout: 90_000 });
  const win = await app.firstWindow();
  await win.waitForSelector('.browser--desktop', { timeout: 30_000 });
  return { app, win };
}

let app;
let win;
const addressBar = () => win.getByRole('combobox', { name: 'Barra de direcciones' });
async function go(text) {
  await addressBar().click();
  // Seleccionar todo: ⌘A en macOS (allí Ctrl+A mueve el cursor al principio de la línea).
  await win.keyboard.press('ControlOrMeta+A');
  await win.keyboard.type(text);
  await win.keyboard.press('Enter');
}
const activeTabText = () => win.locator('[role="tab"][aria-selected="true"]').innerText();
async function waitForActiveTab(text) {
  return eventually(async () => (await activeTabText()).includes(text), `La pestaña activa no muestra «${text}»`);
}
/** Vistas web del proceso principal: URL, visibilidad y si están destruidas. */
function views() {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].contentView.children.map((view) => ({
      visible: view.getVisible(),
      url: view.webContents.isDestroyed() ? null : view.webContents.getURL(),
    })),
  );
}
function pageEval(urlPart, code) {
  return app.evaluate(
    ({ BrowserWindow, webContents }, [part, source]) => {
      const ui = BrowserWindow.getAllWindows()[0].webContents;
      const contents = webContents.getAllWebContents().find((wc) => wc !== ui && !wc.isDestroyed() && wc.getURL().includes(part));
      return contents ? contents.executeJavaScript(source, true) : '__sin_pagina__';
    },
    [urlPart, code],
  );
}
/** Evalúa código en la página de la pestaña visible (no en otra pestaña con una URL parecida). */
function visiblePageEval(code) {
  return app.evaluate(({ BrowserWindow }, source) => {
    const view = BrowserWindow.getAllWindows()[0].contentView.children.find((child) => child.getVisible() && !child.webContents.isDestroyed());
    return view ? view.webContents.executeJavaScript(source, true) : '__sin_pagina__';
  }, code);
}
async function openSettings(section) {
  // Como en Chrome y Edge, Configuración está en el menú principal. Si ya está abierto,
  // pulsar el botón lo cerraría.
  const menu = win.getByRole('button', { name: 'Menú de ICARUS' });
  if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  await win.getByRole('menuitem', { name: 'Configuración' }).click();
  await win.getByRole('button', { name: section, exact: true }).click();
}

/* -------------------------- Direcciones personalizadas -------------------------- */

/** Texto visible de la barra sin foco (dirección en forma corta). */
const shownAddress = () => win.evaluate(() => document.querySelector('.omnibox__display')?.textContent ?? '');
/** Todo el texto de la barra (chip de seguridad incluido) y el título emergente de la pestaña activa. */
const visibleChrome = () =>
  win.evaluate(() => `${document.querySelector('.omnibox')?.textContent ?? ''} ${document.querySelector('.tab.is-active')?.getAttribute('title') ?? ''}`);
const securityState = () => win.evaluate(() => document.querySelector('.omnibox__info')?.getAttribute('data-security') ?? null);
/**
 * Dirección visible en forma corta. En Panorama (Edge) la barra siempre lleva el protocolo
 * real delante: se exige y se compara el resto (sin `www.` ni la barra final de la raíz).
 */
async function shownShort() {
  const shown = await shownAddress();
  if ((await win.locator('.icarus-root').getAttribute('data-theme')) !== 'edge-inspired' || !shown) return shown;
  const match = /^https?:\/\/(?:www\.)?(.*?)(\/?)$/.exec(shown);
  return match ? (match[1].includes('/') ? `${match[1]}${match[2]}` : match[1]) : `(sin protocolo en Panorama) ${shown}`;
}
async function expectShown(text, message) {
  return eventually(
    async () => ((await shownAddress()) === text || (await shownShort()) === text ? text : null),
    `${message ?? 'La barra no muestra la dirección esperada'}: «${text}»`,
  );
}
async function openAddressEditor() {
  await openSettings('Avanzado');
  await win.getByRole('button', { name: 'Personalizar direcciones URL' }).click();
  return win.getByRole('dialog', { name: 'Direcciones personalizadas' });
}
/** Crea una dirección personalizada desde Configuración, como lo haría el usuario. */
async function addCustomAddress(target, address) {
  const editor = await openAddressEditor();
  await editor.getByRole('button', { name: 'Añadir dirección' }).click();
  await editor.getByLabel('1. Destino real').fill(target);
  await editor.getByLabel('2. Dirección que se mostrará').fill(address);
  await editor.getByRole('button', { name: 'Guardar', exact: true }).click();
  await win.getByText(/^Dirección .+ guardada\.$/).last().waitFor();
  await editor.getByRole('button', { name: 'Cerrar' }).first().click();
}
const visibleUrl = async () => (await views()).find((view) => view.visible)?.url ?? null;

/* --------------------------------- Pruebas --------------------------------- */

console.log(`ICARUS e2e · Electron ${require('electron/package.json').version} · servidor ${base}`);

await step('1. Iniciar ICARUS', async () => {
  ({ app, win } = await launch());
  assert(win.url().startsWith('icarus-app://ui/'), `La interfaz no se cargó desde icarus-app:// (${win.url()})`);
  assert(await win.evaluate(() => Boolean(window.icarusNative)), 'El puente nativo no está disponible');
  await waitForActiveTab('Nueva pestaña');
  const engine = await app.evaluate(() => process.versions.chrome);
  return `Chromium ${engine}`;
});

await step('2. Abrir una página dentro de la pestaña', async () => {
  await go(`${base}/a.html`);
  await waitForActiveTab('Página A');
  const list = await eventually(async () => {
    const all = await views();
    return all.some((view) => view.visible && view.url?.endsWith('/a.html')) ? all : null;
  }, 'La vista web visible no muestra a.html');
  assert((await addressBar().inputValue()) === `${base}/a.html`, 'La barra de direcciones no muestra la URL real');
  const title = await pageEval('/a.html', 'document.title');
  assert(title === 'Página A', `El documento no se renderizó (${title})`);
  return `${list.length} vista(s) web`;
});

await step('3. Sin buscador: una palabra se intenta como dominio, nunca se busca', async () => {
  await go('icaruslandia');
  // La barra muestra el dominio intentado; ICARUS no abre ningún buscador.
  await expectShown('icaruslandia', 'La palabra no se intentó como dominio');
  await eventually(async () => (await views()).some((view) => view.url?.startsWith('https://icaruslandia')), 'El motor no intentó el dominio', 30_000);
  const views_ = await views();
  assert(!views_.some((view) => (view.url ?? '').includes('/search?q=')), 'Se activó un buscador general');
  return 'icaruslandia → https://icaruslandia/ (dominio, no búsqueda)';
});

await step('4. Volver atrás tras la búsqueda', async () => {
  await win.locator('.nav-controls').getByRole('button', { name: 'Atrás' }).click();
  await waitForActiveTab('Página A');
});

await step('5. Abrir dos páginas en pestañas diferentes y cambiar entre ellas', async () => {
  await win.getByRole('button', { name: 'Nueva pestaña', exact: true }).click();
  await go(`${base}/b.html`);
  await waitForActiveTab('Página B');
  assert((await win.getByRole('tab').count()) === 2, 'No hay dos pestañas');
  await eventually(async () => (await views()).some((v) => v.visible && v.url?.endsWith('/b.html')), 'b.html no es la vista visible');
  await win.getByRole('tab', { name: /Página A/ }).click();
  await eventually(async () => {
    const all = await views();
    return all.some((v) => v.visible && v.url?.endsWith('/a.html')) && !all.some((v) => v.visible && v.url?.endsWith('/b.html'));
  }, 'Al cambiar de pestaña no se mostró a.html');
});

await step('6. Navegar atrás y adelante', async () => {
  await pageEval('/a.html', "document.getElementById('to-b').click()");
  await waitForActiveTab('Página B');
  await win.locator('.nav-controls').getByRole('button', { name: 'Atrás' }).click();
  await waitForActiveTab('Página A');
  await win.locator('.nav-controls').getByRole('button', { name: 'Adelante' }).click();
  await waitForActiveTab('Página B');
  await win.locator('.nav-controls').getByRole('button', { name: 'Atrás' }).click();
  await waitForActiveTab('Página A');
});

await step('7. Recargar una página', async () => {
  const before = hits.a;
  await win.locator('.nav-controls').getByRole('button', { name: 'Recargar' }).click();
  await eventually(() => hits.a > before, 'El servidor no recibió la recarga');
  return `${hits.a - before} petición nueva`;
});

await step('8. Enlaces target=_blank abren pestañas de ICARUS (no ventanas)', async () => {
  const windowsBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  await pageEval('/a.html', "document.getElementById('blank').click()");
  await eventually(async () => (await win.getByRole('tab').count()) === 3, 'No se abrió una tercera pestaña');
  // La vista de la pestaña nueva se crea después de la pestaña: se espera a que exista.
  await eventually(async () => (await views()).length === 3, 'La pestaña nueva no tiene su vista web');
  const windowsAfter = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  assert(windowsBefore === windowsAfter, 'Se creó una ventana emergente');
});

await step('9. Cerrar y crear pestañas libera las vistas', async () => {
  const before = (await views()).length;
  const describeState = async () => {
    const list = (await views()).map((view) => `${view.visible ? '*' : ''}${view.url}`).join(', ');
    const tabs = (await win.locator('.tab').evaluateAll((items) => items.map((item) => `${item.classList.contains('is-active') ? '*' : ''}${item.getAttribute('title')?.split('\n')[0]}`))).join(', ');
    return `vistas [${list}] · pestañas [${tabs}]`;
  };
  const initial = await describeState();
  await win.locator('.tab.is-active .tab__close').click();
  await eventually(async () => (await win.getByRole('tab').count()) === 2, 'La pestaña no se cerró');
  try {
    await eventually(async () => (await views()).length === before - 1, 'La vista web no se liberó');
  } catch (error) {
    throw new Error(`${error.message}. Antes: ${initial}. Después: ${await describeState()}`);
  }
  await win.keyboard.press('Control+T');
  await eventually(async () => (await win.getByRole('tab').count()) === 3, 'Ctrl+T no creó una pestaña');
  return `vistas: ${before} → ${before - 1}`;
});

await step('10. Comprobar los tres temas', async () => {
  const seen = [];
  for (const [name, id] of [['Esencial', 'google-inspired'], ['Panorama', 'edge-inspired'], ['ICARUS', 'icarus']]) {
    await win.getByRole('button', { name: 'Personalizar', exact: true }).first().click();
    await win.locator('.theme-card', { hasText: name }).click();
    await eventually(async () => (await win.locator('.icarus-root').getAttribute('data-theme')) === id, `No se aplicó ${name}`);
    await win.keyboard.press('Escape');
    seen.push(id);
  }
  return seen.join(', ');
});

await step('11. Menús sobre la página: captura y ocultación de la vista', async () => {
  await win.getByRole('tab', { name: /Página A/ }).click();
  await eventually(async () => (await views()).some((v) => v.visible && v.url?.endsWith('/a.html')), 'a.html no visible');
  await win.getByRole('button', { name: 'Menú de ICARUS' }).click();
  await eventually(async () => !(await views()).some((v) => v.visible), 'La vista no se ocultó con el menú abierto');
  // Si la captura tarda más que la reserva de 500 ms, la vista se oculta antes y la captura aparece al llegar.
  await eventually(() => win.locator('.viewport__snapshot').isVisible(), 'No se muestra la captura de la página', 5_000);
  await win.keyboard.press('Escape');
  await eventually(async () => (await views()).some((v) => v.visible && v.url?.endsWith('/a.html')), 'La vista no volvió a mostrarse');
});

await step('12. A · Dirección personalizada: la barra muestra solo miweb.com y Chromium carga la URL real', async () => {
  // Destino: el servidor de pruebas (127.0.0.1, HTTP). La dirección se escribe sin protocolo ni sufijos.
  await addCustomAddress(`${base}/`, 'miweb.com');
  await go(`${base}/a.html`);
  await waitForActiveTab('Página A');
  await expectShown('miweb.com/a.html');
  const chrome = await visibleChrome();
  assert(!chrome.includes('127.0.0.1') && !/alias|\.icarus/i.test(chrome), `La barra o la pestaña muestran la dirección original o un alias: ${chrome}`);
  assert((await addressBar().inputValue()) === 'http://miweb.com/a.html', 'El campo no contiene la dirección personalizada completa');
  // Seguridad real: la página es HTTP, así que se indica «No seguro».
  assert((await securityState()) === 'insecure', `Estado de seguridad inesperado: ${await securityState()}`);
  assert(await win.getByRole('button', { name: 'No seguro · Ver información del sitio' }).isVisible(), 'No se muestra «No seguro»');
  const real = await visibleUrl();
  assert(real === `${base}/a.html`, `Chromium no cargó la URL real (${real})`);
  assert(!(await views()).some((view) => view.url?.includes('miweb')), 'Una vista navegó a la dirección personalizada');

  // Escribir la dirección personalizada lleva a la página real equivalente.
  await go('miweb.com/b.html');
  await waitForActiveTab('Página B');
  await eventually(async () => (await visibleUrl()) === `${base}/b.html`, 'Escribir miweb.com/b.html no abrió la página real');
  await expectShown('miweb.com/b.html');

  // Escape cancela la edición y recupera la dirección de la página.
  await addressBar().click();
  await win.keyboard.type('algo escrito');
  assert((await addressBar().inputValue()) === 'algo escrito', 'El clic no seleccionó la dirección para reemplazarla');
  await win.keyboard.press('Escape');
  assert((await addressBar().inputValue()) === 'http://miweb.com/b.html', 'Escape no recuperó la dirección');
  await win.keyboard.press('Escape');
  return `barra: «${await shownAddress()}» · Chromium: ${real}`;
});

await step('13. ICARUS Shield bloquea solicitudes reales', async () => {
  await openSettings('ICARUS Shield');
  await win.locator('#shield-custom-rules').fill('/ads/banner.js');
  await win.getByRole('button', { name: 'Guardar reglas' }).click();
  await win.getByText('Reglas guardadas.').waitFor();
  // Pestaña propia con una URL única: otras pestañas cargaron a.html antes de la regla.
  const page = '/a.html?shield=1';
  await win.keyboard.press('Control+T');
  await go(`${base}${page}`);
  const loaded = await eventually(async () => {
    const result = await pageEval(page, '[window.appLoaded === true, window.adLoaded === true]');
    return Array.isArray(result) && result[0] ? result : null;
  }, 'La página no terminó de cargar');
  assert(loaded[1] === false, 'El script de anuncio se cargó a pesar de la regla');
  const label = await eventually(
    async () => {
      const value = await win.locator('.shield-btn').getAttribute('aria-label');
      return /\b[1-9]\d* solicitud/.test(value ?? '') ? value : null;
    },
    'El contador de Shield no refleja el bloqueo',
  );

  await win.locator('.shield-btn').click();
  await win.getByRole('switch', { name: /Activo en 127\.0\.0\.1/ }).click();
  await win.keyboard.press('Escape');
  await eventually(async () => (await pageEval(page, 'window.adLoaded === true')) === true, 'La excepción por sitio no permitió el script');
  await win.locator('.shield-btn').click();
  await win.getByRole('switch', { name: /Activo en 127\.0\.0\.1/ }).click();
  await win.keyboard.press('Escape');
  return label;
});

await step('14. Descargas reales', async () => {
  await win.evaluate(
    (directory) =>
      window.icarusNative.preferences.set({
        downloads: { askWhereToSave: false, directory },
        privacy: { clearOnExit: { history: false, cookies: false, cache: false } },
      }),
    downloadDir,
  );
  await go(`${base}/archivo.txt`);
  const item = await eventually(async () => {
    const list = await win.evaluate(() => window.icarusNative.downloads.list());
    return list.find((download) => download.state === 'completed');
  }, 'La descarga no se completó');
  assert(existsSync(item.savePath), 'El archivo no existe en disco');
  assert(readFileSync(item.savePath, 'utf8').includes('Contenido de prueba'), 'El contenido descargado no coincide');
  // La interfaz recibe el aviso de la descarga un instante después que el proceso principal.
  await eventually(() => win.locator('.downloads-btn').isVisible(), 'No aparece el botón de descargas');
  return item.savePath;
});

await step('15. Historial persistente', async () => {
  await win.keyboard.press('Control+H');
  await win.getByRole('heading', { name: 'Historial' }).waitFor();
  await eventually(async () => (await win.locator('.history-row__title', { hasText: 'Página A' }).count()) > 0, 'El historial no lista Página A');
});

await step('16. Iconos reales de los sitios (detectados solos) y detener la carga', async () => {
  await go(`${local}/icono.html`);
  await waitForActiveTab('Con icono');
  const icon = await eventually(
    () => win.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"] img.favicon')?.getAttribute('src') ?? null),
    'La pestaña no muestra el icono real del sitio',
  );
  assert(icon.startsWith('data:image/png;base64,'), `El icono no procede del sitio (${icon.slice(0, 30)})`);

  // Varios iconos declarados: se prueban en orden y se reconoce la imagen por su contenido.
  await go(`${base}/iconos.html`);
  await waitForActiveTab('Varios iconos');
  await eventually(
    () => win.evaluate((gif) => document.querySelector('[role="tab"][aria-selected="true"] img.favicon')?.getAttribute('src') === `data:image/gif;base64,${gif}`, ICON_GIF),
    'La pestaña no muestra el segundo icono declarado (el primero no existe)',
  );

  // Un sitio nunca visitado (acceso directo, favorito): sin /favicon.ico, el icono se
  // descubre en los <link rel="icon"> de su página principal.
  const iconSite = http.createServer((request, response) => {
    const routes = {
      '/': ['text/html; charset=utf-8', '<!doctype html><html><head><link rel="shortcut icon" href="/static/marca.svg"></head><body>Tienda</body></html>'],
      '/static/marca.svg': ['image/svg+xml', ICON_SVG],
    };
    const route = routes[new URL(request.url, 'http://x').pathname];
    response.writeHead(route ? 200 : 404, { 'content-type': route ? route[0] : 'text/html' });
    response.end(route ? route[1] : '<p>No encontrado</p>');
  });
  await new Promise((resolve) => iconSite.listen(0, '127.0.0.1', resolve));
  try {
    const discovered = await win.evaluate((url) => window.icarusNative.favicons.get(url), `http://127.0.0.1:${iconSite.address().port}/tienda/ofertas`);
    assert(discovered === `data:image/svg+xml;base64,${Buffer.from(ICON_SVG).toString('base64')}`, `No se descubrió el icono del sitio (${String(discovered).slice(0, 40)})`);
  } finally {
    iconSite.close();
  }

  await go(`${local}/lento.html`);
  const controls = win.locator('.nav-controls');
  await controls.getByRole('button', { name: 'Detener' }).click({ timeout: 10_000 });
  await controls.getByRole('button', { name: 'Recargar' }).waitFor({ timeout: 10_000 });
  const loading = await app.evaluate(({ webContents }) =>
    webContents.getAllWebContents().some((wc) => !wc.isDestroyed() && wc.getURL().includes('/lento.html') && wc.isLoading()),
  );
  assert(!loading, 'Chromium sigue cargando la página después de detenerla');
  return 'icono data:image/png · segundo candidato GIF · SVG descubierto · carga detenida';
});

await step('17. Atajos: Ctrl+L desde la página, Ctrl+W, Ctrl+Mayús+T y Ctrl+Tab', async () => {
  await go(`${local}/b.html`);
  await waitForActiveTab('Página B');
  // Ctrl+L con el foco dentro de la página web: lo intercepta el proceso principal.
  await app.evaluate(({ webContents }, url) => {
    const contents = webContents.getAllWebContents().find((wc) => !wc.isDestroyed() && wc.getURL() === url);
    contents.focus();
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'L', modifiers: ['control'] });
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'L', modifiers: ['control'] });
  }, `${local}/b.html`);
  await eventually(
    () =>
      win.evaluate(() => {
        const bar = document.querySelector('.toolbar input[role="combobox"]');
        return document.activeElement === bar && bar.value.length > 0 && bar.selectionStart === 0 && bar.selectionEnd === bar.value.length;
      }),
    'Ctrl+L no seleccionó toda la dirección',
  );

  const tabs = win.locator('[role="tab"]');
  const before = await tabs.count();
  await win.keyboard.press('Escape');
  await win.keyboard.press('Control+W');
  await eventually(async () => (await tabs.count()) === before - 1, 'Ctrl+W no cerró la pestaña');
  await win.keyboard.press('Control+Shift+T');
  await eventually(async () => (await tabs.count()) === before, 'Ctrl+Mayús+T no reabrió la pestaña');
  await waitForActiveTab('Página B');
  await eventually(async () => (await addressBar().inputValue()) === `${local}/b.html`, 'La pestaña reabierta no conserva su URL');
  const active = await activeTabText();
  await win.keyboard.press('Control+Tab');
  await eventually(async () => (await activeTabText()) !== active, 'Ctrl+Tab no cambió de pestaña');
  return `${before} pestañas`;
});

await step('18. B y D · Editar sin .icarus; rutas, pushState, fragmentos y redirecciones', async () => {
  const editor = await openAddressEditor();
  await editor.getByRole('button', { name: 'Editar miweb.com' }).click();
  await editor.getByLabel('2. Dirección que se mostrará').fill('otraweb.com');
  await editor.getByRole('button', { name: 'Guardar cambios' }).click();
  await win.getByText('Cambios guardados.').waitFor();
  assert(!(await editor.innerText()).includes('.icarus'), 'El editor menciona .icarus');
  await editor.getByRole('button', { name: 'Cerrar' }).first().click();

  await go('otraweb.com/a.html');
  await waitForActiveTab('Página A');
  await expectShown('otraweb.com/a.html');
  await pageEval('/a.html', "document.getElementById('to-b').click(); true");
  await waitForActiveTab('Página B');
  await expectShown('otraweb.com/b.html', 'Al seguir un enlace');
  await pageEval('/b.html', "history.pushState({}, '', '/ruta/nueva?x=1#parte'); true");
  await expectShown('otraweb.com/ruta/nueva?x=1#parte', 'Tras history.pushState');
  await pageEval('/ruta/nueva', "location.hash = '#otra'; true");
  await expectShown('otraweb.com/ruta/nueva?x=1#otra', 'Tras cambiar el fragmento');
  const chrome = await visibleChrome();
  assert(!chrome.includes('127.0.0.1'), `Reapareció la dirección original: ${chrome}`);

  // Redirección dentro del destino: se mantiene la dirección personalizada.
  await go('otraweb.com/salto');
  await eventually(async () => (await visibleUrl()) === `${base}/b.html`, 'La redirección no llegó a b.html');
  await expectShown('otraweb.com/b.html', 'Tras una redirección dentro del sitio');
  // Redirección a otro sitio: se muestra la dirección real de llegada (no se finge que sigue en el destino).
  await go('otraweb.com/redirige');
  await eventually(async () => (await visibleUrl()) === `${local}/b.html`, 'La redirección a otro sitio no se completó');
  await expectShown(`${localHost}/b.html`, 'Tras una redirección a otro sitio');
  return 'enlace, pushState, fragmento y redirección interna → otraweb.com · redirección externa → dirección real';
});

await step('19. Protocolos peligrosos bloqueados (barra y enlaces)', async () => {
  await go(`${local}/enlaces.html`);
  await waitForActiveTab('Enlaces');
  await go('javascript:alert(1)');
  await win.getByText(/no abre direcciones «javascript:?»/).first().waitFor({ timeout: 10_000 });
  for (const id of ['mail', 'file']) await pageEval('/enlaces.html', `document.getElementById('${id}').click(); true`);
  await win.getByText(/El protocolo «mailto:?» no es compatible/).first().waitFor({ timeout: 10_000 });
  await sleep(1000);
  const urls = (await views()).map((view) => view.url ?? '');
  assert(urls.includes(`${local}/enlaces.html`), 'La pestaña salió de la página de enlaces');
  assert(!urls.some((url) => /^(mailto|file|javascript):/i.test(url)), `Una vista cargó un protocolo bloqueado (${urls.join(', ')})`);
  return 'javascript:, mailto: y file: no se abren';
});

const tlsServer = await startSelfSignedServer();
if (!tlsServer) {
  skip('20. Certificado no válido: error sin opción de omitirlo', 'no hay openssl para crear el certificado de prueba');
} else {
  await step('20. Certificado no válido: error sin opción de omitirlo', async () => {
    const url = `https://127.0.0.1:${tlsServer.tls.address().port}/`;
    await go(url);
    await win.getByRole('heading', { name: 'La conexión no es segura' }).waitFor({ timeout: 15_000 });
    const details = await win.locator('.error-card__details').innerText();
    assert(/ERR_CERT_/.test(details), `El error no es de certificado (${details})`);
    const buttons = await win.locator('.error-card__actions button').allInnerTexts();
    assert(!buttons.some((text) => /omitir|continuar|de todos modos|acceder/i.test(text)), `Hay un botón para omitir el error: ${buttons.join(', ')}`);
    assert(!(await views()).some((view) => view.visible && view.url?.startsWith(url)), 'Se muestra la página con el certificado no válido');
    return details.match(/ERR_CERT_\w+/)?.[0];
  });
}

await step('21. Permiso de ubicación: se pregunta con el origen real y se deniega', async () => {
  await go(`${local}/ubicacion.html`);
  await waitForActiveTab('Ubicación');
  await pageEval('/ubicacion.html', 'window.pedirUbicacion(); true');
  const request = win.getByRole('alertdialog');
  await request.waitFor({ timeout: 10_000 });
  const text = (await request.innerText()).replace(/\s+/g, ' ').trim();
  assert(text.includes(local) && text.includes('ubicación'), `La solicitud no muestra el origen real (${text})`);
  await request.getByRole('button', { name: 'Bloquear' }).click();
  await eventually(async () => (await pageEval('/ubicacion.html', 'window.geo')) === 'error-1', 'La página no recibió la denegación');
  // La decisión se recuerda durante la sesión: no se vuelve a preguntar.
  await pageEval('/ubicacion.html', 'window.geo = undefined; window.pedirUbicacion(); true');
  await eventually(async () => (await pageEval('/ubicacion.html', 'window.geo')) === 'error-1', 'La segunda solicitud no se denegó');
  assert(!(await request.isVisible()), 'Se volvió a preguntar por el mismo permiso');
  return text;
});

await step('22. Autenticación HTTP: cancelar, contraseña incorrecta y correcta', async () => {
  const dialog = win.getByRole('dialog', { name: 'Iniciar sesión' });
  const fill = async (username, password) => {
    await dialog.getByLabel('Usuario').fill(username);
    await dialog.getByLabel('Contraseña').fill(password);
    await dialog.getByRole('button', { name: 'Iniciar sesión' }).click();
  };
  await go(`${local}/privado`);
  await dialog.waitFor({ timeout: 10_000 });
  const text = (await dialog.innerText()).replace(/\s+/g, ' ');
  assert(text.includes(local) && text.includes('Zona de pruebas ICARUS'), `El diálogo no muestra el origen y el mensaje del sitio (${text})`);
  assert(text.includes('no es segura'), 'No se avisa de que la conexión HTTP no está cifrada');
  // La vista nativa se dibuja encima del HTML: con el diálogo abierto debe estar oculta.
  await eventually(async () => !(await views()).some((view) => view.visible), 'La página tapa el diálogo de autenticación', 5_000);
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await waitForActiveTab('Acceso denegado');

  await win.locator('.nav-controls').getByRole('button', { name: 'Recargar' }).click();
  await dialog.waitFor({ timeout: 10_000 });
  await fill('icarus', 'incorrecta');
  // Chromium vuelve a pedir las credenciales: aparece una solicitud nueva con el formulario vacío.
  await eventually(
    async () => (await dialog.isVisible()) && (await dialog.getByLabel('Contraseña').inputValue()) === '',
    'No se volvió a pedir la contraseña',
  );
  await fill('icarus', 'secreto');
  await waitForActiveTab('Zona privada');
  assert(!(await dialog.isVisible()), 'El diálogo sigue abierto');
  return 'Basic · 401 al cancelar · reintento tras contraseña incorrecta';
});

await step('23. Buscar en la página (Ctrl+F desde la página, siguiente, anterior y Escape)', async () => {
  await go(`${local}/texto.html`);
  await waitForActiveTab('Texto');
  await app.evaluate(({ webContents }, url) => {
    const contents = webContents.getAllWebContents().find((wc) => !wc.isDestroyed() && wc.getURL() === url);
    contents.focus();
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: ['control'] });
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'F', modifiers: ['control'] });
  }, `${local}/texto.html`);
  const bar = win.getByRole('search', { name: 'Buscar en la página' });
  const input = bar.getByLabel('Texto que buscar en la página');
  await eventually(() => input.evaluate((element) => document.activeElement === element), 'Ctrl+F no abrió la barra de búsqueda con el foco');
  const count = bar.getByRole('status');
  const expectCount = async (text) => {
    let actual = '';
    try {
      await eventually(async () => (actual = (await count.innerText()).trim()) === text, 'contador');
    } catch {
      throw new Error(`El contador muestra «${actual}» en lugar de «${text}»`);
    }
  };
  await win.keyboard.type('vuelo');
  await expectCount('1 de 3');
  await win.keyboard.press('Enter');
  await expectCount('2 de 3');
  await win.keyboard.press('Shift+Enter');
  await expectCount('1 de 3');
  await win.keyboard.type('xyz');
  await expectCount('Sin resultados');
  await win.keyboard.press('Escape');
  await bar.waitFor({ state: 'hidden', timeout: 5_000 });
  return 'contador real de Chromium: 3 coincidencias';
});

await step('24. E · Cerrar y volver a abrir conserva los datos y la dirección personalizada', async () => {
  const customize = win.getByRole('button', { name: 'Personalizar', exact: true }).first();
  if (!(await customize.isVisible())) await win.keyboard.press('Control+T');
  await customize.click();
  await win.locator('.theme-card', { hasText: 'Panorama' }).click();
  await win.keyboard.press('Escape');
  // Restaurar la sesión al abrir, con una página personalizada en la pestaña activa.
  await openSettings('General');
  await win.getByRole('radio', { name: 'Restaurar las pestañas de la sesión anterior' }).check();
  await win.keyboard.press('Control+T');
  await go('otraweb.com/a.html');
  await waitForActiveTab('Página A');
  await expectShown('otraweb.com/a.html');
  await app.close();
  ({ app, win } = await launch());
  await waitForActiveTab('Página A');
  await expectShown('otraweb.com/a.html', 'Tras reiniciar');
  await eventually(async () => (await visibleUrl()) === `${base}/a.html`, 'La pestaña restaurada no cargó la página real');
  assert((await win.locator('.icarus-root').getAttribute('data-theme')) === 'edge-inspired', 'El estilo no se conservó');
  const state = await win.evaluate(() => window.icarusNative.shield.getState());
  assert(state.customRules.includes('/ads/banner.js'), 'Las reglas de Shield no se conservaron');
  const history = await win.evaluate(() => window.icarusNative.history.list());
  assert(history.some((item) => item.title === 'Página A'), 'El historial no se conservó');
  const storage = JSON.parse(readFileSync(join(dataDir, 'ui-storage.json'), 'utf8'));
  const saved = String(storage.data['icarus.aliasRules']);
  assert(saved.includes('http://otraweb.com/') && saved.includes(`${base}/`), 'La dirección personalizada no se guardó en disco');
  assert(!saved.includes('.icarus'), 'Los datos guardados contienen .icarus');
  return `datos en ${dataDir}`;
});

await step('25. Borrar el historial', async () => {
  await win.keyboard.press('Control+H');
  await win.getByRole('heading', { name: 'Historial' }).waitFor();
  await win.getByLabel('Borrar historial…').selectOption('all');
  await win.getByRole('button', { name: 'Borrar', exact: true }).click();
  await win.getByText('Todavía no hay páginas en el historial.').waitFor({ timeout: 10_000 });
  const items = await win.evaluate(() => window.icarusNative.history.list());
  assert(items.length === 0, `Quedan ${items.length} entradas en el historial`);
});

await step('26. C · Escribir google.com navega a la dirección real (añade https://)', async () => {
  await win.keyboard.press('Control+T');
  await go('google.com');
  const outcome = await eventually(async () => {
    const url = await visibleUrl();
    if (url && /^https:\/\/(www\.)?google\.com\//.test(url)) return { url };
    if (await win.locator('.error-page').count()) return { error: (await win.locator('.error-card__details').innerText()).replace(/\s+/g, ' ') };
    return null;
  }, 'google.com no navegó', 30_000);
  const shown = await shownShort();
  assert(/^google\.com/.test(shown), `La barra no muestra google.com (${shown})`);
  if (outcome.error) {
    assert(outcome.error.includes('https://google.com/'), `No se intentó abrir https://google.com/ (${outcome.error})`);
    return `https://google.com/ (la red del entorno bloquea google.com: se mostró la página de error real)`;
  }
  return `${outcome.url} · barra: «${shown}»`;
});

await step('27. F · Pestaña nueva, atrás, adelante, recargar y restaurar con la dirección personalizada', async () => {
  await win.keyboard.press('Control+T');
  await go('otraweb.com/a.html');
  await waitForActiveTab('Página A');
  await expectShown('otraweb.com/a.html');
  await pageEval('/a.html', "document.getElementById('to-b').click(); true");
  await waitForActiveTab('Página B');
  const controls = win.locator('.nav-controls');
  await controls.getByRole('button', { name: 'Atrás' }).click();
  await waitForActiveTab('Página A');
  await expectShown('otraweb.com/a.html', 'Tras volver atrás');
  await controls.getByRole('button', { name: 'Adelante' }).click();
  await waitForActiveTab('Página B');
  await expectShown('otraweb.com/b.html', 'Tras avanzar');
  await controls.getByRole('button', { name: 'Recargar' }).click();
  await eventually(async () => !(await win.locator('[role="tab"][aria-selected="true"] .tab__spinner').count()), 'La recarga no terminó');
  await expectShown('otraweb.com/b.html', 'Tras recargar');
  const tabs = win.locator('[role="tab"]');
  const before = await tabs.count();
  await win.keyboard.press('Control+W');
  await eventually(async () => (await tabs.count()) === before - 1, 'Ctrl+W no cerró la pestaña');
  await win.keyboard.press('Control+Shift+T');
  await waitForActiveTab('Página B');
  await expectShown('otraweb.com/b.html', 'Tras restaurar la pestaña cerrada');
  assert(!(await visibleChrome()).includes('127.0.0.1'), 'Reapareció la dirección original');
  return 'atrás, adelante, recargar y Ctrl+Mayús+T conservan otraweb.com';
});

if (!tlsServer) {
  skip('28. H · Un certificado no válido muestra el sitio real y «No seguro»', 'no hay openssl para crear el certificado de prueba');
} else {
  await step('28. H · Un certificado no válido muestra el sitio real y «No seguro»', async () => {
    const origin = `https://127.0.0.1:${tlsServer.tls.address().port}`;
    await addCustomAddress(`${origin}/`, 'segura.miweb.com');
    await win.keyboard.press('Control+T');
    await go('segura.miweb.com');
    await win.getByRole('heading', { name: 'La conexión no es segura' }).waitFor({ timeout: 15_000 });
    // El aviso se refiere al sitio que respondió: la barra muestra su dirección real, con https tachado.
    await expectShown(`https://127.0.0.1:${tlsServer.tls.address().port}/`, 'Con un error de certificado');
    assert((await securityState()) === 'dangerous', `Estado de seguridad inesperado: ${await securityState()}`);
    assert(await win.locator('.omnibox__scheme.is-struck').isVisible(), 'El protocolo no aparece tachado');
    assert(!(await views()).some((view) => view.visible && view.url?.startsWith(origin)), 'Se muestra la página con el certificado no válido');
    const buttons = await win.locator('.error-card__actions button').allInnerTexts();
    assert(!buttons.some((text) => /omitir|continuar|de todos modos|acceder/i.test(text)), `Hay un botón para omitir el error: ${buttons.join(', ')}`);
    return `barra: «${await shownAddress()}» · estado: ${await securityState()}`;
  });
}

await step('29. G · La barra se comporta igual en los estilos Esencial (Chrome) y Panorama (Edge)', async () => {
  const seen = [];
  for (const [name, id] of [['Esencial', 'google-inspired'], ['Panorama', 'edge-inspired']]) {
    await win.keyboard.press('Control+T');
    await win.getByRole('button', { name: 'Personalizar', exact: true }).first().click();
    await win.locator('.theme-card', { hasText: name }).click();
    await eventually(async () => (await win.locator('.icarus-root').getAttribute('data-theme')) === id, `No se aplicó ${name}`);
    await win.keyboard.press('Escape');
    await go('otraweb.com/a.html');
    await waitForActiveTab('Página A');
    await expectShown('otraweb.com/a.html', `En ${name}`);
    // Panorama (Edge) muestra siempre el protocolo real; Esencial (Chrome), la forma corta.
    const expectedText = id === 'edge-inspired' ? 'http://otraweb.com/a.html' : 'otraweb.com/a.html';
    assert((await shownAddress()) === expectedText, `En ${name}, la barra muestra «${await shownAddress()}» en lugar de «${expectedText}»`);
    assert(!(await visibleChrome()).includes('127.0.0.1'), `En ${name} se ve la dirección original`);
    assert((await securityState()) === 'insecure', `En ${name}, estado de seguridad inesperado: ${await securityState()}`);
    // Clic: dirección completa seleccionada; escribir la reemplaza y Escape la recupera.
    await addressBar().click();
    assert((await addressBar().inputValue()) === 'http://otraweb.com/a.html', `En ${name}, el campo no tiene la dirección completa`);
    await win.keyboard.type('x');
    assert((await addressBar().inputValue()) === 'x', `En ${name}, el clic no seleccionó toda la dirección`);
    await win.keyboard.press('Escape');
    assert((await addressBar().inputValue()) === 'http://otraweb.com/a.html', `En ${name}, Escape no recuperó la dirección`);
    await win.keyboard.press('Escape');
    // La información del sitio dice qué sitio recibe las solicitudes.
    await win.locator('.omnibox__info').click();
    const custom = win.getByTestId('site-custom-address');
    await custom.waitFor();
    assert((await custom.innerText()).includes('127.0.0.1'), `En ${name}, la información del sitio no nombra el sitio real`);
    await win.keyboard.press('Escape');
    seen.push(name);
  }
  return `${seen.join(' y ')}: misma barra, misma dirección y misma seguridad`;
});

/* ----------------- Barra inteligente, zoom, favoritos y diseño ----------------- */

/** Texto escrito en el campo «Dirección base» (modo Editar base). */
const baseField = () => win.getByRole('combobox', { name: 'Dirección base' });
async function editBase(newBase) {
  await addressBar().click();
  await win.getByRole('button', { name: 'Editar base' }).click();
  await baseField().fill(newBase);
  await win.keyboard.press('Enter');
}
async function setStyle(name, id) {
  await win.keyboard.press('Control+T');
  await win.getByRole('button', { name: 'Personalizar', exact: true }).first().click();
  await win.locator('.theme-card', { hasText: name }).click();
  await eventually(async () => (await win.locator('.icarus-root').getAttribute('data-theme')) === id, `No se aplicó ${name}`);
  await win.keyboard.press('Escape');
}
/** Direcciones personalizadas guardadas en disco (ui-storage.json), tras escribirse. */
async function savedAddresses() {
  return eventually(() => {
    try {
      const storage = JSON.parse(readFileSync(join(dataDir, 'ui-storage.json'), 'utf8'));
      const saved = JSON.parse(String(storage.data['icarus.aliasRules']));
      return (saved.data ?? saved).map((entry) => entry.address);
    } catch {
      return null;
    }
  }, 'No se pudieron leer las direcciones guardadas');
}
/**
 * Zoom real (el de Chromium) de las páginas del servidor de pruebas. Es por sitio, así
 * que vale cualquier pestaña del servidor (con un menú abierto la vista está oculta).
 */
const pageZoom = () =>
  app.evaluate(({ BrowserWindow, webContents }, origin) => {
    const ui = BrowserWindow.getAllWindows()[0].webContents;
    const contents = webContents.getAllWebContents().find((wc) => wc !== ui && !wc.isDestroyed() && wc.getURL().startsWith(origin));
    return contents ? contents.getZoomFactor() : null;
  }, `${base}/`);

for (const [name, id] of [['Esencial', 'google-inspired'], ['Panorama', 'edge-inspired']]) {
  await step(`30. Barra inteligente en ${name}: editar la base conserva /#inicio, /#dashboard y ruta con consulta`, async () => {
    await setStyle(name, id);
    // La dirección personalizada vigente es otraweb.com → servidor de pruebas.
    await go('otraweb.com/app#inicio');
    await waitForActiveTab('Aplicación');
    await expectShown('otraweb.com/app#inicio');

    // Editar base: solo la base en el campo y el sufijo fijo a la derecha.
    await addressBar().click();
    await win.getByRole('button', { name: 'Editar base' }).click();
    assert((await baseField().inputValue()) === 'http://otraweb.com', `Base inesperada: ${await baseField().inputValue()}`);
    assert((await win.getByTestId('rebase-suffix').innerText()).includes('/app#inicio'), 'No se muestra el sufijo que se conserva');
    await baseField().fill('miweb2.com');
    await win.keyboard.press('Enter');
    const choices = win.getByRole('listbox', { name: 'Qué hacer con la base nueva' });
    await choices.waitFor();
    const options = await choices.getByRole('option').allInnerTexts();
    assert(
      options[0]?.includes('Guardar miweb2.com') && options[1]?.includes('Guardar miweb2.com solo para #inicio') && options[2]?.includes('Ir a miweb2.com/app#inicio'),
      `Opciones inesperadas: ${options.join(' | ')}`,
    );
    await win.keyboard.press('Enter');
    // Se guarda y la misma página real se muestra con la base nueva y la misma ruta.
    await expectShown('miweb2.com/app#inicio', 'Tras guardar la base');
    // La lista de opciones oculta la página como cualquier menú; vuelve a verse un instante después.
    await eventually(async () => (await visibleUrl()) === `${base}/app#inicio`, 'La página real cambió');
    await eventually(async () => (await savedAddresses()).includes('http://miweb2.com/'), 'La base nueva no se guardó en disco');

    // Otra sección de la aplicación: misma configuración, sin entradas nuevas.
    const before = (await savedAddresses()).length;
    await visiblePageEval("location.hash = 'dashboard'; true");
    await expectShown('miweb2.com/app#dashboard', 'Al cambiar de sección');
    assert((await savedAddresses()).length === before, 'Se creó una configuración nueva por fragmento');

    // Ruta de varios niveles con consulta: se conserva igual; se vuelve a la base anterior.
    await go('miweb2.com/panel/usuarios?id=10');
    await expectShown('miweb2.com/panel/usuarios?id=10');
    await editBase('otraweb.com');
    await choices.waitFor();
    await win.keyboard.press('Enter');
    await expectShown('otraweb.com/panel/usuarios?id=10', 'Tras volver a la base anterior');
    await eventually(async () => (await visibleUrl()) === `${base}/panel/usuarios?id=10`, 'La ruta con consulta no se conservó');

    // Una dirección completa nueva no hereda la ruta anterior.
    await go('otraweb.com');
    await eventually(async () => (await visibleUrl()) === `${base}/`, 'Escribir otraweb.com heredó la ruta anterior');
    await expectShown('otraweb.com');

    // Sin dirección personalizada (localhost), «Editar base» cambia el origen y navega directamente.
    const port = new URL(base).port;
    await go(`http://localhost:${port}/app?x=1#chart`);
    await waitForActiveTab('Aplicación');
    await editBase(`127.0.0.1:${port}`);
    await eventually(async () => (await visibleUrl()) === `${base}/app?x=1#chart`, 'La base nueva no conservó la ruta');
    await expectShown('otraweb.com/app?x=1#chart');
    return 'guardar (persistente), otra sección, ruta con consulta, dirección nueva y origen sin personalizar';
  });
}

await step('31. Cerrar y restaurar una pestaña personalizada conserva la dirección', async () => {
  await go('otraweb.com/app#chart');
  await waitForActiveTab('Aplicación');
  await win.keyboard.press('Control+W');
  await win.keyboard.press('Control+Shift+T');
  await waitForActiveTab('Aplicación');
  await expectShown('otraweb.com/app#chart', 'Tras restaurar la pestaña');
  await eventually(async () => (await visibleUrl()) === `${base}/app#chart`, 'La pestaña restaurada no cargó la página real');
});

await step('32. Zoom real por sitio: ampliar, reducir, restablecer y menú', async () => {
  await go('otraweb.com/a.html');
  await waitForActiveTab('Página A');
  await eventually(async () => (await pageZoom()) === 1, 'El zoom inicial no es 100 %');
  await addressBar().click();
  await win.keyboard.press('Escape');
  await win.keyboard.press('Escape');
  // Con el foco en la interfaz, Ctrl + / − cambian el zoom de la página (no el de la interfaz).
  await win.locator('.toolbar').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await win.keyboard.press('Control+=');
  await win.keyboard.press('Control+=');
  await eventually(async () => (await pageZoom()) === 1.25, 'Ctrl+= no amplió la página al 125 %');
  const uiZoom = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
  assert(uiZoom === 1, `Cambió el zoom de la interfaz (${uiZoom})`);
  const indicator = win.getByTestId('zoom-indicator');
  await indicator.waitFor();
  // La interfaz recibe el zoom con el estado de la pestaña, que llega por IPC después.
  await eventually(async () => (await indicator.getAttribute('aria-label')) === 'Zoom: 125 %', 'El indicador no muestra 125 %');
  // Otra pestaña del mismo sitio usa el mismo zoom.
  await win.keyboard.press('Control+T');
  await go('otraweb.com/b.html');
  await waitForActiveTab('Página B');
  await eventually(async () => (await pageZoom()) === 1.25, 'El zoom no se aplicó a otra página del mismo sitio');
  // Menú: Reducir; indicador: Restablecer.
  await win.getByRole('button', { name: 'Menú de ICARUS' }).click();
  await win.getByRole('menuitem', { name: 'Reducir' }).click();
  await eventually(async () => (await win.getByTestId('zoom-value').innerText()) === '110 %', 'El menú no muestra 110 %');
  await win.keyboard.press('Escape');
  await eventually(async () => (await pageZoom()) === 1.1, 'Reducir desde el menú no cambió el zoom');
  await win.getByTestId('zoom-indicator').click();
  await win.getByRole('button', { name: 'Restablecer' }).click();
  await eventually(async () => (await pageZoom()) === 1, 'Restablecer no volvió al 100 %');
  // Se deja un 110 % para comprobar que se guarda al reiniciar.
  await win.keyboard.press('Control+=');
  await eventually(async () => (await pageZoom()) === 1.1, 'No se volvió a ampliar');
  return 'Ctrl+=, menú, mismo sitio en otra pestaña e indicador; la interfaz no cambia de tamaño';
});

await step('33. Favoritos: guardar, nombre, carpeta, abrir y eliminar (dirección personalizada, nunca la real)', async () => {
  await go('otraweb.com/app#dashboard');
  await waitForActiveTab('Aplicación');
  const star = win.getByTestId('bookmark-star');
  assert((await star.getAttribute('aria-pressed')) === 'false', 'La página ya era un favorito');
  await star.click();
  const editor = win.getByRole('dialog', { name: 'Favorito añadido' });
  await editor.waitFor();
  assert(!(await editor.innerText()).includes('127.0.0.1'), 'El editor muestra la dirección real');
  await editor.getByLabel('Nombre').fill('Panel ICARUS');
  await editor.getByLabel('Carpeta').selectOption({ label: 'Nueva carpeta…' });
  await editor.getByLabel('Nombre de la carpeta nueva').fill('Trabajo');
  await editor.getByRole('button', { name: 'Hecho' }).click();
  await eventually(async () => (await star.getAttribute('aria-pressed')) === 'true', 'La estrella no se rellenó');
  // Se abre con un clic desde el botón Favoritos.
  await go('otraweb.com/b.html');
  await waitForActiveTab('Página B');
  await win.getByTestId('bookmarks-button').click();
  const hub = win.getByRole('dialog', { name: 'Favoritos' });
  await hub.waitFor();
  const hubText = await hub.innerText();
  // El nombre de la carpeta se muestra en mayúsculas (CSS).
  assert(/trabajo/i.test(hubText) && hubText.includes('otraweb.com/app#dashboard') && !hubText.includes('127.0.0.1'), `Favoritos: ${hubText}`);
  await hub.getByRole('button', { name: /Panel ICARUS/ }).click();
  await expectShown('otraweb.com/app#dashboard', 'Al abrir el favorito');
  // Ctrl+D sobre otra página y eliminar desde icarus://favoritos.
  await go('otraweb.com/b.html');
  await waitForActiveTab('Página B');
  await win.keyboard.press('Control+D');
  await win.getByRole('dialog', { name: 'Favorito añadido' }).getByRole('button', { name: 'Hecho' }).click();
  await go('icarus://favoritos');
  await win.getByRole('heading', { level: 1, name: 'Favoritos' }).waitFor();
  const row = win.getByTestId('bookmark-row').filter({ hasText: 'Página B' });
  await row.getByRole('button', { name: /Eliminar/ }).click();
  await eventually(async () => (await win.getByTestId('bookmark-row').count()) === 0, 'Quedan favoritos en la carpeta «Favoritos»');
  return 'Panel ICARUS en «Trabajo»; Página B eliminada';
});

await step('34. La barra ocupa todo el ancho entre los controles y las acciones (Esencial y Panorama, 1600 y 900 px)', async () => {
  const notes = [];
  for (const [name, id] of [['Esencial', 'google-inspired'], ['Panorama', 'edge-inspired']]) {
    await setStyle(name, id);
    await go('otraweb.com/a.html');
    for (const width of [1600, 900]) {
      await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setSize(w, 800), width);
      await sleep(400);
      const layout = await win.evaluate(() => {
        const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
        const nav = rect('.nav-controls');
        const omnibox = rect('.omnibox');
        const actions = rect('.toolbar__actions');
        return { window: window.innerWidth, navRight: nav.right, left: omnibox.left, right: omnibox.right, actionsLeft: actions.left, top: omnibox.top, navTop: nav.top };
      });
      const gapLeft = layout.left - layout.navRight;
      const gapRight = layout.actionsLeft - layout.right;
      assert(gapLeft >= 0 && gapLeft <= 12, `${name} a ${width}px: hueco a la izquierda de ${gapLeft}px`);
      assert(gapRight >= 0 && gapRight <= 20, `${name} a ${width}px: hueco a la derecha de ${gapRight}px`);
      assert(layout.right <= layout.window, `${name} a ${width}px: la barra se desborda`);
      notes.push(`${name} ${width}px: ${Math.round(layout.right - layout.left)}px (huecos ${Math.round(gapLeft)}/${Math.round(gapRight)})`);
    }
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800));
  return notes.join(' · ');
});

await step('35. Reiniciar conserva la base editada, los favoritos y el zoom; sin alias ni .icarus', async () => {
  await app.close();
  ({ app, win } = await launch());
  await win.keyboard.press('Control+T');
  await go('otraweb.com/a.html');
  await waitForActiveTab('Página A');
  await expectShown('otraweb.com/a.html', 'Tras reiniciar');
  await eventually(async () => (await pageZoom()) === 1.1, 'El zoom del sitio no se conservó al reiniciar');
  const bookmarks = await win.evaluate(() => JSON.parse(window.icarusNative.storage.snapshot['icarus.bookmarks'] ?? 'null'));
  const items = bookmarks?.data?.items ?? [];
  assert(items.some((item) => item.title === 'Panel ICARUS' && item.url === `${base}/app#dashboard`), 'Los favoritos no se conservaron');
  assert(items.length === 1, `Favoritos tras reiniciar: ${items.length}`);
  const html = await win.evaluate(() => document.body.innerHTML);
  assert(!/\.icarus\b/.test(html), 'La interfaz muestra un sufijo .icarus');
  const storage = readFileSync(join(dataDir, 'ui-storage.json'), 'utf8');
  assert(!storage.includes('.icarus'), 'Los datos guardados contienen .icarus');
  return `${items.length} favorito · zoom 110 % · otraweb.com`;
});

await step('36. Secciones: otro dominio para #home en el mismo sitio, en otra pestaña y tras reiniciar', async () => {
  await win.keyboard.press('Control+T');
  await go('otraweb.com/app#home');
  await waitForActiveTab('Aplicación');
  await expectShown('otraweb.com/app#home');
  await editBase('seccion.com');
  const choices = win.getByRole('listbox', { name: 'Qué hacer con la base nueva' });
  await choices.waitFor();
  const options = await choices.getByRole('option').allInnerTexts();
  assert(options.length === 3 && options[1]?.includes('Guardar seccion.com solo para #home'), `Opciones inesperadas: ${options.join(' | ')}`);
  await win.keyboard.press('ArrowDown');
  await win.keyboard.press('Enter');
  await expectShown('seccion.com/app#home', 'Tras guardar solo para #home');
  await eventually(async () => (await visibleUrl()) === `${base}/app#home`, 'La página real cambió');
  // Otra sección de la misma página: vuelve la dirección general del sitio.
  await visiblePageEval("location.hash = 'inicio'; true");
  await expectShown('otraweb.com/app#inicio', 'En #inicio');
  // Otra pestaña: escribir seccion.com abre la sección #home del sitio real.
  await win.keyboard.press('Control+T');
  await go('seccion.com/app');
  await eventually(async () => (await visibleUrl()) === `${base}/app#home`, 'seccion.com no abrió #home del sitio real');
  await expectShown('seccion.com/app#home', 'En otra pestaña');
  // Guardado en disco junto a la dirección general, sin tocarla.
  const entries = await eventually(() => {
    try {
      const stored = JSON.parse(String(JSON.parse(readFileSync(join(dataDir, 'ui-storage.json'), 'utf8')).data['icarus.aliasRules']));
      const list = stored.data ?? stored;
      return list.some((entry) => entry.address === 'http://seccion.com/' && entry.sections?.join() === 'home') ? list : null;
    } catch {
      return null;
    }
  }, 'La dirección de la sección no se guardó en disco');
  assert(entries.some((entry) => entry.address === 'http://otraweb.com/' && !entry.sections), 'La dirección general del sitio cambió');
  await app.close();
  ({ app, win } = await launch());
  await win.keyboard.press('Control+T');
  await go(`${base}/app#home`);
  await waitForActiveTab('Aplicación');
  await expectShown('seccion.com/app#home', 'Tras reiniciar');
  return 'seccion.com en #home · otraweb.com en #inicio · otra pestaña · tras reiniciar';
});

await step('37. Misma dirección para dos sitios reales repartiendo las secciones («Duplicar»)', async () => {
  // 127.0.0.1 y localhost son dos sitios distintos para Chromium (otro origen).
  const port = new URL(base).port;
  const editor = await openAddressEditor();
  await editor.getByRole('button', { name: 'Añadir dirección' }).click();
  await editor.getByLabel('1. Destino real').fill(`${base}/`);
  await editor.getByLabel('2. Dirección que se mostrará').fill('miweb3.com');
  await editor.getByLabel('3. Secciones (opcional)').fill('#inicio');
  await editor.getByRole('button', { name: 'Guardar', exact: true }).click();
  await win.getByText('Dirección miweb3.com guardada.').last().waitFor();
  // Duplicar: mismo destino y misma dirección, sin secciones y con el foco en ellas.
  await editor.getByRole('button', { name: 'Duplicar' }).click();
  const sections = editor.getByLabel('3. Secciones (opcional)');
  const shownField = await editor.getByLabel('2. Dirección que se mostrará').inputValue();
  assert(shownField === 'http://miweb3.com/', `Duplicar no repitió la dirección (${shownField})`);
  assert((await sections.inputValue()) === '', 'Duplicar no vació las secciones');
  assert(await sections.evaluate((element) => element === document.activeElement), 'El foco no está en las secciones');
  await editor.getByLabel('1. Destino real').fill(`http://localhost:${port}/`);
  await sections.fill('#home');
  await editor.getByRole('button', { name: 'Guardar', exact: true }).click();
  await eventually(async () => (await editor.getByText('Solo en #home', { exact: true }).count()) > 0, 'No se guardó la segunda entrada');
  await editor.getByRole('button', { name: 'Cerrar' }).first().click();
  // La misma dirección escrita abre el sitio real de su sección, y la barra la conserva.
  await win.keyboard.press('Control+T');
  await go('miweb3.com/app#home');
  await eventually(async () => (await visibleUrl()) === `http://localhost:${port}/app#home`, 'miweb3.com/app#home no abrió localhost');
  await expectShown('miweb3.com/app#home');
  await go('miweb3.com/app#inicio');
  await eventually(async () => (await visibleUrl()) === `${base}/app#inicio`, 'miweb3.com/app#inicio no abrió 127.0.0.1');
  await expectShown('miweb3.com/app#inicio');
  return 'miweb3.com#inicio → 127.0.0.1 · miweb3.com#home → localhost (duplicada)';
});

await step('38. Panorama como Edge: pestaña pegada, protocolo visible, iconos de la derecha, modo lectura, Nueva pestaña y perfil', async () => {
  await setStyle('Panorama', 'edge-inspired');
  await go(`${local}/articulo.html`);
  await waitForActiveTab('Diario de vuelo');
  // La dirección lleva siempre el protocolo real delante (aquí http://, nunca https://).
  await eventually(async () => (await shownAddress()) === `${local}/articulo.html`, 'La barra no muestra el protocolo delante');
  assert((await securityState()) === 'insecure', `Una página HTTP no se indica como no segura (${await securityState()})`);

  // La pestaña activa está pegada a la barra, con su mismo fondo (como en Esencial).
  const geometry = await win.evaluate(() => {
    const tab = document.querySelector('.tab.is-active');
    const strip = document.querySelector('.tabstrip').getBoundingClientRect();
    return {
      gap: Math.round(strip.bottom - tab.getBoundingClientRect().bottom),
      tab: getComputedStyle(tab).backgroundColor,
      bar: getComputedStyle(document.querySelector('.toolbar')).backgroundColor,
    };
  });
  assert(geometry.gap === 0 && geometry.tab === geometry.bar, `La pestaña activa no está pegada a la barra: ${JSON.stringify(geometry)}`);

  // Derecha, en el orden de Edge: Extensiones, Favoritos, (descargas), perfil y «…».
  const labels = await win.evaluate(() => [...document.querySelectorAll('.toolbar__actions button[aria-label]')].map((button) => button.getAttribute('aria-label')));
  const at = (pattern) => labels.findIndex((label) => pattern.test(label));
  const order = [at(/^Extensiones/), at(/^Favoritos$/), at(/^Perfil: /), at(/^Menú de ICARUS$/)];
  assert(order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1])), `Orden inesperado: ${labels.join(' | ')}`);
  assert(at(/Shield/) === at(/^Extensiones/), `Shield no está dentro de Extensiones: ${labels.join(' | ')}`);
  await win.getByTestId('extensions-button').click();
  const extensions = win.getByRole('dialog', { name: 'Extensiones' });
  await extensions.waitFor();
  const extensionsText = await extensions.innerText();
  assert(extensionsText.includes('ICARUS Shield') && extensionsText.includes('Integrada en ICARUS'), `Panel de extensiones inesperado: ${extensionsText}`);
  await win.keyboard.press('Escape');
  await extensions.waitFor({ state: 'hidden' });

  // Modo lectura: solo el texto del artículo, como texto, con la página oculta debajo.
  await win.getByTestId('reader-button').click();
  const reader = win.getByTestId('reader-view');
  await reader.waitFor();
  await eventually(async () => (await reader.innerText()).includes('El vuelo empezó al amanecer'), 'El modo lectura no muestra el texto del artículo');
  const readerText = await reader.innerText();
  assert(readerText.includes('Sobre el mar') && readerText.includes('Plumas') && readerText.includes('Dédalo'), 'Faltan partes del artículo');
  assert(!readerText.includes('Publicidad molesta') && !readerText.includes('Menú del sitio'), 'El modo lectura incluye la navegación o el anuncio');
  assert(readerText.includes('<b>Esto no es HTML</b>'), 'El texto con aspecto de HTML no se muestra como texto');
  assert((await reader.locator('b, script, img, iframe, a').count()) === 0, 'El modo lectura contiene elementos de la página');
  await eventually(async () => !(await views()).some((view) => view.visible), 'La página sigue visible sobre el modo lectura');
  await win.keyboard.press('Escape');
  await reader.waitFor({ state: 'hidden' });
  await eventually(async () => (await views()).some((view) => view.visible && view.url?.endsWith('/articulo.html')), 'La página no volvió a mostrarse');

  // «Añadir a Nueva pestaña» (icono de aplicaciones de la barra).
  const appButton = win.getByTestId('app-shortcut-button');
  await appButton.click();
  await eventually(async () => (await appButton.getAttribute('aria-pressed')) === 'true', 'La página no se añadió a Nueva pestaña');
  await win.keyboard.press('Control+T');
  await win.getByRole('button', { name: /Diario de vuelo/ }).first().waitFor({ timeout: 10_000 });

  // Perfil personalizable: nombre y foto, visibles al momento y guardados en disco.
  await win.getByTestId('profile-button').click();
  await win.getByRole('button', { name: 'Personalizar perfil' }).click();
  await win.getByRole('textbox', { name: 'Nombre del perfil' }).fill('Ícaro');
  await win.getByTestId('profile-photo-input').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from(ICON_PNG, 'base64') });
  await eventually(
    async () => (await win.getByTestId('profile-button').locator('img').getAttribute('src').catch(() => null))?.startsWith('data:image/jpeg;base64,'),
    'La foto del perfil no aparece en la barra',
  );
  assert((await win.getByTestId('profile-button').getAttribute('aria-label')) === 'Perfil: Ícaro', 'El nombre del perfil no se aplicó');
  await eventually(() => {
    try {
      const storage = JSON.parse(readFileSync(join(dataDir, 'ui-storage.json'), 'utf8'));
      const saved = JSON.parse(String(storage.data['icarus.settings']));
      const profile = (saved.data ?? saved).profile;
      return profile.name === 'Ícaro' && String(profile.photo).startsWith('data:image/jpeg;base64,');
    } catch {
      return false;
    }
  }, 'El perfil no se guardó en disco');
  return `${labels.join(' · ')} · lectura, acceso directo y perfil`;
});

if (process.env.ICARUS_E2E_INTERNET === '1') {
  await step('Internet (A): https://bot.deriv.me/ con la dirección personalizada https://miweb.com/', async () => {
    await addCustomAddress('https://bot.deriv.me', 'https://miweb.com');
    await win.keyboard.press('Control+T');
    await go('miweb.com');
    const outcome = await eventually(async () => {
      if (await win.locator('.error-page').count()) {
        return { error: `${await win.locator('#error-page-title').innerText()} · ${await win.locator('.error-card__details').innerText()}` };
      }
      const url = await visibleUrl();
      const ready = url ? await pageEval(new URL(url).host, 'document.readyState === "complete"') : false;
      return ready === true ? { url } : null;
    }, 'No se cargó bot.deriv.me', 45_000);
    assert(!outcome.error, outcome.error?.replace(/\s+/g, ' '));
    const finalHost = new URL(outcome.url).host;
    const shown = await shownShort();
    if (finalHost === 'bot.deriv.me') {
      assert(shown.startsWith('miweb.com'), `La barra no muestra miweb.com (${shown})`);
      assert(!(await visibleChrome()).includes('deriv'), 'La barra o la pestaña muestran bot.deriv.me');
      assert((await securityState()) === 'secure', `La conexión HTTPS real no se indica como segura (${await securityState()})`);
      return `Chromium: ${outcome.url} · barra: «${shown}» · conexión: ${await securityState()}`;
    }
    // Si el sitio redirige a otro dominio, se muestra la dirección real de llegada.
    assert(shown.startsWith(finalHost.replace(/^www\./, '')), `Tras redirigir a ${finalHost}, la barra muestra «${shown}»`);
    return `bot.deriv.me redirigió a ${outcome.url}: la barra muestra la dirección real «${shown}»`;
  });

  const sites = process.env.ICARUS_E2E_SITES?.split(',').filter(Boolean) ?? ['https://www.wikipedia.org/', 'https://www.google.com/', 'https://www.youtube.com/'];
  for (const url of sites) {
    await step(`Internet: ${url}`, async () => {
      await go(url);
      // Se comprueba la pestaña visible: otra pestaña abierta antes puede tener el mismo sitio.
      const domain = new URL(url).hostname.replace(/^www\./, '');
      const outcome = await eventually(async () => {
        if (await win.locator('.error-page').count()) {
          return { error: `${await win.locator('#error-page-title').innerText()} · ${await win.locator('.error-card__details').innerText()}` };
        }
        const current = (await visibleUrl()) ?? '';
        const host = URL.canParse(current) ? new URL(current).hostname : '';
        if (host !== domain && !host.endsWith(`.${domain}`)) return null;
        const title = await visiblePageEval('document.readyState === "complete" ? document.title : ""');
        return title && title !== '__sin_pagina__' ? { title, url: current } : null;
      }, `No se cargó ${url}`, 45_000);
      assert(!outcome.error, outcome.error?.replace(/\s+/g, ' '));
      assert(outcome.url.startsWith('https://'), `La página no se cargó por HTTPS (${outcome.url})`);
      // HTTPS verificado por Chromium: candado delante de la dirección.
      const icon = await win.evaluate(() => document.querySelector('.omnibox__info')?.getAttribute('data-icon') ?? null);
      assert((await securityState()) === 'secure' && icon === 'lock', `No se muestra el candado (${await securityState()}, ${icon})`);
      return `«${outcome.title}» · ${new URL(outcome.url).host} · candado`;
    });
  }
}

await app?.close().catch(() => {});
for (const response of slowResponses) response.destroy();
server.close();
if (tlsServer) {
  tlsServer.tls.close();
  rmSync(tlsServer.dir, { recursive: true, force: true });
}
for (const dir of [dataDir, downloadDir]) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch (error) {
    console.warn(`No se pudo borrar la carpeta temporal ${dir}: ${error.message}`);
  }
}

const failed = results.filter((result) => !result.ok);
const skipped = results.filter((result) => result.skipped);
const run = results.length - skipped.length;
console.log(`\n${run - failed.length}/${run} pruebas superadas${skipped.length ? ` · ${skipped.length} omitida(s)` : ''}.`);
process.exit(failed.length ? 1 : 0);
