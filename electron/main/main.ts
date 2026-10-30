/**
 * Proceso principal de ICARUS Browser (Electron).
 *
 * Separación de privilegios:
 * - La interfaz de ICARUS se carga desde `icarus-app://ui/` en su propia
 *   sesión, con un preload mínimo y aislamiento de contexto.
 * - Las páginas web se cargan en WebContentsView con sandbox, sin Node, sin
 *   preload y en la sesión «persist:icarus-web».
 */

import { join, resolve } from 'node:path';
import { app, Menu, net, session, shell, webContents, type WebContents } from 'electron';
import type { ClearDataOptions, DesktopPreferences, NativeEvent } from '../../src/types/native';
import { macMenuTemplate } from './appMenu';
import { DownloadManager } from './downloads';
import { FaviconService } from './favicons';
import { HistoryStore } from './history';
import { registerIpc } from './ipc';
import { AuthManager } from './auth';
import { PermissionManager } from './permissions';
import { createPreferencesFile } from './preferences';
import { createListFetcher, ShieldService } from './shieldService';
import { TabManager } from './tabs';
import { ZoomStore } from './zoom';
import { registerUiScheme, serveUi, UI_ENTRY, UI_ORIGIN } from './uiProtocol';
import { UiStorage } from './uiStorage';
import { electronFetch } from './updateFetch';
import {
  launchAppImageSwap,
  launchMacSwap,
  launchWindowsInstaller,
  macNeedsKeychainApproval,
  planInstall,
  removeAppImageBackup,
  stageAppImage,
  stageMacUpdate,
  verifyWindowsInstaller,
} from './updateInstall';
import { UpdateService, type UpdateInstaller } from './updates';
import { readBuildInfo, updateConfig } from './updateSetup';
import { createMainWindow } from './window';

// Carpeta de datos alternativa (pruebas automáticas o instalación portátil).
if (process.env.ICARUS_USER_DATA_DIR) app.setPath('userData', resolve(process.env.ICARUS_USER_DATA_DIR));

const devServerUrl = !app.isPackaged ? process.env.ICARUS_DEV_SERVER_URL : undefined;
const WEB_PARTITION = 'persist:icarus-web';
const UI_PARTITION = 'icarus-ui';

app.enableSandbox();
registerUiScheme();

// Las páginas reciben un agente de usuario de Chromium estándar (sin «Electron»).
app.userAgentFallback = app.userAgentFallback.replace(/\s(?:Electron|icarus-browser|ICARUS[^/]*)\/\S+/gi, '');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('web-contents-created', (_event, contents) => {
    // Ninguna página puede crear <webview> ni ventanas nuevas por su cuenta.
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // Sin este manejador Electron conectaría el primer dispositivo Bluetooth disponible.
    contents.on('select-bluetooth-device', (event, _devices, callback) => {
      event.preventDefault();
      callback('');
    });
  });
  // Solo sin empaquetar: retrasa la creación de la ventana para que Playwright termine de
  // conectarse al protocolo DevTools antes de que exista ninguna vista (pruebas E2E en
  // Windows, donde conectarse mientras se crea la ventana puede quedarse esperando).
  const startupDelay = app.isPackaged ? 0 : Math.min(Number(process.env.ICARUS_STARTUP_DELAY_MS) || 0, 10_000);
  app
    .whenReady()
    .then(() => new Promise((done) => setTimeout(done, startupDelay)))
    .then(start)
    .catch((error) => {
      console.error('No se pudo iniciar ICARUS:', error);
      app.exit(1);
    });
}

function isUiUrl(url: string): boolean {
  if (devServerUrl) return url.startsWith(devServerUrl);
  return url.startsWith(`${UI_ORIGIN}/`);
}

async function start(): Promise<void> {
  if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate(macMenuTemplate(app.name)));
  const dataDir = app.getPath('userData');
  const uiSession = session.fromPartition(UI_PARTITION);
  const webSession = session.fromPartition(WEB_PARTITION);
  webSession.setUserAgent(app.userAgentFallback);
  // La interfaz no necesita ningún permiso del sistema.
  uiSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  if (!devServerUrl) serveUi(uiSession, join(app.getAppPath(), 'dist'));

  const preferencesFile = createPreferencesFile(join(dataDir, 'preferences.json'));
  const storage = new UiStorage(join(dataDir, 'ui-storage.json'));

  const window = createMainWindow({
    uiSession,
    preloadPath: join(__dirname, '..', 'preload', 'ui.js'),
    statePath: join(dataDir, 'window-state.json'),
    devTools: !app.isPackaged || process.env.ICARUS_ENABLE_UI_DEVTOOLS === '1',
  });

  const emit = (event: NativeEvent) => {
    if (!window.isDestroyed()) window.webContents.send('icarus:event', event);
  };

  const history = new HistoryStore(join(dataDir, 'history.json'), () => emit({ type: 'history-changed' }));
  const favicons = new FaviconService(webSession, join(dataDir, 'favicons.json'));
  let tabs: TabManager;

  // Refresca (como mucho cada 250 ms) el contador de bloqueos de las pestañas afectadas.
  const countRefresh = new Set<number>();
  let countTimer: NodeJS.Timeout | null = null;
  const onBlocked = (webContentsId: number) => {
    countRefresh.add(webContentsId);
    if (countTimer) return;
    countTimer = setTimeout(() => {
      countTimer = null;
      for (const id of countRefresh) {
        const contents = webContents.fromId(id);
        if (contents && !contents.isDestroyed()) tabs.refreshState(contents);
      }
      countRefresh.clear();
    }, 250);
  };

  const shield = new ShieldService(
    join(dataDir, 'shield'),
    createListFetcher((url, init) => net.fetch(url, init)),
    (state) => emit({ type: 'shield', state }),
    onBlocked,
  );

  const permissions = new PermissionManager(
    (contents) => tabs?.tabIdFor(contents) ?? null,
    (request) => emit({ type: 'permission-request', request }),
    (id) => emit({ type: 'permission-cancelled', id }),
  );

  const auth = new AuthManager(
    (contents) => tabs?.tabIdFor(contents) ?? null,
    (request) => emit({ type: 'auth-request', request }),
    (id) => emit({ type: 'auth-cancelled', id }),
  );

  const downloads = new DownloadManager(
    join(dataDir, 'downloads.json'),
    () => preferencesFile.get(),
    (list, startedId) => {
      emit({ type: 'downloads', downloads: list });
      if (startedId) emit({ type: 'download-started', id: startedId });
    },
    () => (window.isDestroyed() ? null : window),
  );

  const zoom = new ZoomStore(join(dataDir, 'zoom.json'));

  tabs = new TabManager(window, webSession, {
    emitState: (state) => emit({ type: 'tab-state', state }),
    emitShortcut: (action) => emit({ type: 'shortcut', action }),
    openInNewTab: (url, background) => emit({ type: 'open-in-new-tab', url, background }),
    searchInNewTab: (text) => emit({ type: 'search-in-new-tab', text }),
    navigationBlocked: (tabId, url, protocol) => emit({ type: 'navigation-blocked', tabId, url: url.slice(0, 300), protocol }),
    fetchFavicon: (pageUrl, candidates) => favicons.fetchPageIcon(pageUrl, candidates),
    onCommit: (tabId, contents, url) => {
      history.add(url, contents.getTitle());
      permissions.cancelForTab(tabId);
    },
    onTitle: (url, title) => history.updateTitle(url, title),
    onMainFrameStart: (tabId, contents: WebContents) => {
      shield.resetPage(contents.id);
      auth.cancelForTab(tabId);
    },
    shieldCount: (contents) => shield.pageBlockedCount(contents.id),
    shieldAllowed: (url) => shield.isSiteAllowed(url),
    emitFind: (result) => emit({ type: 'find-result', result }),
    onClosed: (tabId, contents) => {
      shield.forgetPage(contents.id);
      permissions.cancelForTab(tabId);
      auth.cancelForTab(tabId);
    },
    zoomFor: (url) => zoom.get(url),
    saveZoom: (url, factor) => zoom.set(url, factor),
  });

  shield.attach(webSession, (contents, id) => tabs.pageUrlFor(contents, id));
  permissions.attach(webSession);
  auth.attach(app);
  downloads.attach(webSession);

  const clearData = async (options: ClearDataOptions) => {
    if (options.history) {
      history.clear(options.range);
      // Los iconos recordados dicen qué sitios se visitaron: se borran con el historial.
      favicons.clear();
    }
    if (options.downloads) downloads.clear();
    if (options.cache) await webSession.clearCache();
    if (options.cookies) {
      await webSession.clearStorageData();
      // Las credenciales HTTP que Chromium recuerda en memoria también son datos de sesión.
      await webSession.clearAuthCache();
      permissions.clearDecisions();
    }
  };

  const updates = createUpdateService(dataDir, emit);

  registerIpc({
    window,
    isUiUrl,
    bootstrap: () => ({
      snapshot: storage.snapshot(),
      appVersion: app.getVersion(),
      chromiumVersion: process.versions.chrome ?? '',
      engineName: `Chromium ${process.versions.chrome ?? ''}`.trim(),
      dataDirectory: dataDir,
    }),
    storage,
    tabs,
    history,
    downloads,
    shield,
    permissions,
    auth,
    favicons,
    getPreferences: () => preferencesFile.get(),
    setPreferences: (preferences: DesktopPreferences) => {
      preferencesFile.set(preferences);
      return preferencesFile.get();
    },
    clearData,
    updates,
    setTitleBarColors: (color, symbolColor) => {
      if (process.platform !== 'darwin' && !window.isDestroyed()) window.setTitleBarOverlay({ color, symbolColor });
    },
  });

  // Las ventanas que la interfaz intente abrir se convierten en pestañas.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) emit({ type: 'open-in-new-tab', url, background: false });
    return { action: 'deny' };
  });

  if (devServerUrl) await window.loadURL(devServerUrl);
  else await window.loadURL(UI_ENTRY);

  updates.start();

  // Actualiza en segundo plano las listas de Shield caducadas.
  if (process.env.ICARUS_SHIELD_AUTO_UPDATE !== '0') {
    setTimeout(() => void shield.updateLists(true), 4000);
  }

  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    const { clearOnExit } = preferencesFile.get().privacy;
    const flushAll = () => {
      storage.flush();
      history.flush();
      downloads.flush();
      shield.flush();
      preferencesFile.flush();
      zoom.flush();
      favicons.flush();
      // Con «Instalar al cerrar ICARUS», el instalador empieza cuando todo está guardado.
      updates.onQuit();
    };
    if (!clearOnExit.history && !clearOnExit.cookies && !clearOnExit.cache) {
      flushAll();
      return;
    }
    event.preventDefault();
    quitting = true;
    void clearData({ range: 'all', history: clearOnExit.history, cookies: clearOnExit.cookies, cache: clearOnExit.cache, downloads: false })
      .catch(() => undefined)
      .finally(() => {
        flushAll();
        app.quit();
      });
  });
}

/** Actualizador de la aplicación: modo según la plataforma y dónde está instalada. */
function createUpdateService(dataDir: string, emit: (event: NativeEvent) => void): UpdateService {
  const config = updateConfig(readBuildInfo(join(__dirname, '..', '..')));
  const plan = planInstall({
    platform: process.platform,
    arch: process.arch,
    execPath: process.execPath,
    runningUnderArm64Translation: app.runningUnderARM64Translation,
    appImage: process.env.APPIMAGE,
  });
  // La versión nueva lo escribe al arrancar: el proceso auxiliar de Linux lo espera antes de dar la actualización por buena.
  const confirmFile = join(dataDir, 'updates-confirmed');
  const installer: UpdateInstaller =
    process.platform === 'win32'
      ? {
          prepare: async (file) => {
            await verifyWindowsInstaller(file, process.execPath);
            return file;
          },
          launch: (prepared, relaunch, version) => launchWindowsInstaller(prepared, relaunch, version, join(dataDir, 'updates')),
          reveal: (file) => shell.showItemInFolder(file),
        }
      : process.platform === 'darwin'
        ? {
            prepare: (file, _asset, manifest) => stageMacUpdate(file, join(dataDir, 'updates', manifest.version, 'app'), manifest.version, plan.bundlePath!),
            launch: (prepared, relaunch) => launchMacSwap(join(dataDir, 'updates'), plan.bundlePath!, prepared, relaunch),
            // El .dmg verificado se abre para que el usuario arrastre la app a Aplicaciones.
            reveal: (file) => void shell.openPath(file),
          }
        : plan.appImagePath
          ? {
              prepare: async (file) => stageAppImage(file, plan.appImagePath!),
              launch: (prepared, relaunch) => launchAppImageSwap(join(dataDir, 'updates'), plan.appImagePath!, prepared, relaunch, confirmFile),
              reveal: (file) => shell.showItemInFolder(file),
              cleanup: () => removeAppImageBackup(plan.appImagePath!),
            }
          : { prepare: async (file) => file, launch: () => undefined, reveal: (file) => shell.showItemInFolder(file) };

  const service = new UpdateService({
    dataDir,
    currentVersion: app.getVersion(),
    plan,
    publicKey: config.publicKey,
    isPackaged: app.isPackaged || config.testFeed,
    fetch: electronFetch,
    source: config.source,
    installer,
    emit: (state) => emit({ type: 'update-state', state }),
    // La interfaz guarda la sesión antes de reiniciar (responde por IPC, como mucho 2 s).
    requestRestart: () => emit({ type: 'update-restart' }),
    quit: () => app.quit(),
    confirmFile,
    headers: { 'User-Agent': `ICARUS-Browser/${app.getVersion()} (${process.platform}; ${process.arch})` },
    firstCheckDelayMs: config.firstCheckDelayMs,
  });
  if (process.platform === 'darwin' && plan.bundlePath && service.supported) {
    void macNeedsKeychainApproval(plan.bundlePath).then((notice) => service.setKeychainNotice(notice));
  }
  return service;
}

app.on('window-all-closed', () => app.quit());

// Cierre ordenado si el sistema lo pide con una señal (apagado en Linux, `kill`):
// pasa por before-quit, así que los datos se guardan como al cerrar la ventana.
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => app.quit());
