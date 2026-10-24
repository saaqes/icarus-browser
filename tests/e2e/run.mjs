/**
 * Pruebas de extremo a extremo de la aplicación de escritorio (Electron real).
 *
 * Arranca ICARUS compilado (npm run build), un servidor HTTP local con páginas
 * de prueba y comprueba con Playwright la navegación real dentro de las
 * pestañas, el bloqueo de Shield, las descargas, los alias y la persistencia.
 *
 * Uso: npm run build && npm run test:e2e
 * En Linux necesita una pantalla (p. ej. `xvfb-run -a npm run test:e2e`) y un
 * usuario que no sea root (Chromium no admite su sandbox como root).
 *
 * ICARUS_E2E_INTERNET=1 añade pruebas con sitios HTTPS reales (Wikipedia, Google y
 * YouTube, o los de ICARUS_E2E_SITES separados por comas). ICARUS_E2E_PROXY pasa
 * un proxy a Chromium (--proxy-server); los certificados se siguen verificando.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright-core');
const electronPath = require('electron');
const projectDir = fileURLToPath(new URL('../..', import.meta.url));

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
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
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
    case '/app.js':
      return send(200, 'text/javascript', 'window.appLoaded = true;');
    case '/ads/banner.js':
      return send(200, 'text/javascript', 'window.adLoaded = true;');
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

/* ------------------------------ Utilidades app ------------------------------ */

const dataDir = mkdtempSync(join(tmpdir(), 'icarus-e2e-'));
const downloadDir = mkdtempSync(join(tmpdir(), 'icarus-descargas-'));

async function launch() {
  const env = { ...process.env, ICARUS_USER_DATA_DIR: dataDir, ICARUS_SHIELD_AUTO_UPDATE: '0' };
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_RUN_AS_NODE;
  const extraArgs = process.env.ICARUS_E2E_PROXY ? [`--proxy-server=${process.env.ICARUS_E2E_PROXY}`] : [];
  const app = await _electron.launch({ executablePath: electronPath, args: [projectDir, ...extraArgs], env, cwd: projectDir });
  const win = await app.firstWindow();
  await win.waitForSelector('.browser--desktop', { timeout: 30_000 });
  return { app, win };
}

let app;
let win;
const addressBar = () => win.getByRole('combobox', { name: 'Barra de direcciones' });
async function go(text) {
  await addressBar().click();
  await win.keyboard.press('Control+A');
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
async function openSettings(section) {
  await win.getByRole('button', { name: 'Configuración', exact: true }).first().click();
  await win.getByRole('button', { name: section, exact: true }).click();
}

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

await step('3. Buscar texto desde la barra', async () => {
  await go('icarus prueba');
  const value = await eventually(async () => {
    const current = await addressBar().inputValue();
    return current.startsWith('https://www.google.com/search?q=icarus') ? current : null;
  }, 'La búsqueda no navegó al proveedor');
  // Se espera a que el motor confirme la navegación (página cargada o página de error).
  await eventually(async () => (await views()).some((view) => view.url?.startsWith('https://www.google.com/search?q=icarus')), 'El motor no navegó a la búsqueda', 30_000);
  await eventually(async () => !(await win.locator('[role="tab"][aria-selected="true"] .tab__spinner').count()), 'La búsqueda no terminó de cargar', 30_000);
  const blocked = await win.getByRole('heading', { name: 'No se puede acceder a este sitio' }).isVisible().catch(() => false);
  return blocked ? `${value} (la red del entorno bloquea google.com: se mostró la página de error real)` : value;
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
  const windowsAfter = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  assert(windowsBefore === windowsAfter, 'Se creó una ventana emergente');
});

await step('9. Cerrar y crear pestañas libera las vistas', async () => {
  const before = (await views()).length;
  await win.locator('.tab.is-active .tab__close').click();
  await eventually(async () => (await win.getByRole('tab').count()) === 2, 'La pestaña no se cerró');
  await eventually(async () => (await views()).length === before - 1, 'La vista web no se liberó');
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
  assert(await win.locator('.viewport__snapshot').isVisible(), 'No se muestra la captura de la página');
  await win.keyboard.press('Escape');
  await eventually(async () => (await views()).some((v) => v.visible && v.url?.endsWith('/a.html')), 'La vista no volvió a mostrarse');
});

await step('12. Alias de URL conectados a la navegación real', async () => {
  await openSettings('Avanzado');
  await win.getByRole('button', { name: 'Cambiar nombre de URL' }).click();
  const manager = win.getByRole('dialog', { name: 'Cambiar nombre de URL' });
  await manager.getByRole('button', { name: 'Nueva regla' }).click();
  await manager.getByRole('radio', { name: 'Sitio (host)' }).check({ force: true });
  await manager.getByLabel('Nombre de la regla').fill('Pruebas locales');
  await manager.getByLabel('URL original o patrón de coincidencia').fill('127.0.0.1');
  await manager.getByLabel('Nombre visible del sitio').fill('Servidor local');
  await manager.getByLabel('Alias mostrado en ICARUS').fill('local.icarus');
  await manager.getByLabel('URL de destino real').fill(`${base}/a.html`);
  await manager.getByRole('button', { name: 'Guardar', exact: true }).click();
  await win.getByText('Regla creada.').waitFor();
  await manager.getByRole('button', { name: 'Cerrar' }).first().click();

  await win.getByRole('tab', { name: /Página A|Servidor local/ }).first().click();
  await waitForActiveTab('Servidor local');
  const display = await win.locator('.omnibox__display').innerText();
  assert(display.includes('local.icarus') && display.includes('127.0.0.1'), `La barra no muestra alias y host real (${display})`);
  assert((await addressBar().inputValue()) === `${base}/a.html`, 'La URL real no se conserva en la barra');
  const realUrls = (await views()).map((view) => view.url);
  assert(realUrls.some((url) => url === `${base}/a.html`), 'El motor no conserva la URL real');
  assert(!realUrls.some((url) => url?.includes('icarus')), 'Una vista navegó a un alias');

  await go('local.icarus');
  await eventually(async () => (await addressBar().inputValue()) === `${base}/a.html`, 'Escribir el alias no abrió su destino');
  return display.replace(/\s+/g, ' ');
});

await step('13. ICARUS Shield bloquea solicitudes reales', async () => {
  await openSettings('ICARUS Shield');
  await win.locator('#shield-custom-rules').fill('/ads/banner.js');
  await win.getByRole('button', { name: 'Guardar reglas' }).click();
  await win.getByText('Reglas guardadas.').waitFor();
  await win.getByRole('tab', { name: /Servidor local/ }).first().click();
  await win.locator('.nav-controls').getByRole('button', { name: 'Recargar' }).click();
  const loaded = await eventually(async () => {
    const result = await pageEval('/a.html', '[window.appLoaded === true, window.adLoaded === true]');
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
  await eventually(async () => (await pageEval('/a.html', 'window.adLoaded === true')) === true, 'La excepción por sitio no permitió el script');
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
  assert(await win.locator('.downloads-btn').isVisible(), 'No aparece el botón de descargas');
  return item.savePath;
});

await step('15. Historial persistente', async () => {
  await win.keyboard.press('Control+H');
  await win.getByRole('heading', { name: 'Historial' }).waitFor();
  await eventually(async () => (await win.locator('.history-row__title', { hasText: 'Página A' }).count()) > 0, 'El historial no lista Página A');
});

await step('16. Cerrar y volver a abrir conserva los datos', async () => {
  const customize = win.getByRole('button', { name: 'Personalizar', exact: true }).first();
  if (!(await customize.isVisible())) await win.keyboard.press('Control+T');
  await customize.click();
  await win.locator('.theme-card', { hasText: 'Panorama' }).click();
  await win.keyboard.press('Escape');
  await app.close();
  ({ app, win } = await launch());
  assert((await win.locator('.icarus-root').getAttribute('data-theme')) === 'edge-inspired', 'El estilo no se conservó');
  const state = await win.evaluate(() => window.icarusNative.shield.getState());
  assert(state.customRules.includes('/ads/banner.js'), 'Las reglas de Shield no se conservaron');
  const history = await win.evaluate(() => window.icarusNative.history.list());
  assert(history.some((item) => item.title === 'Página A'), 'El historial no se conservó');
  const storage = JSON.parse(readFileSync(join(dataDir, 'ui-storage.json'), 'utf8'));
  assert(String(storage.data['icarus.aliasRules']).includes('local.icarus'), 'Las reglas de alias no se guardaron en disco');
  return `datos en ${dataDir}`;
});

if (process.env.ICARUS_E2E_INTERNET === '1') {
  const sites = process.env.ICARUS_E2E_SITES?.split(',').filter(Boolean) ?? ['https://www.wikipedia.org/', 'https://www.google.com/', 'https://www.youtube.com/'];
  for (const url of sites) {
    await step(`Internet: ${url}`, async () => {
      await go(url);
      const host = new URL(url).hostname;
      const outcome = await eventually(async () => {
        if (await win.locator('.error-page').count()) {
          return { error: `${await win.locator('#error-page-title').innerText()} · ${await win.locator('.error-card__details').innerText()}` };
        }
        const title = await pageEval(host, 'document.readyState === "complete" ? document.title : ""');
        return title && title !== '__sin_pagina__' ? { title } : null;
      }, `No se cargó ${url}`, 45_000);
      assert(!outcome.error, outcome.error?.replace(/\s+/g, ' '));
      return `«${outcome.title}»`;
    });
  }
}

await app?.close().catch(() => {});
server.close();
for (const dir of [dataDir, downloadDir]) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch (error) {
    console.warn(`No se pudo borrar la carpeta temporal ${dir}: ${error.message}`);
  }
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} pruebas superadas.`);
process.exit(failed.length ? 1 : 0);
