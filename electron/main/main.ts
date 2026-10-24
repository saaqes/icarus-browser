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
import { app, net, session, webContents, type WebContents } from 'electron';
import type { ClearDataOptions, DesktopPreferences, NativeEvent } from '../../src/types/native';
import { DownloadManager } from './downloads';
import { FaviconService } from './favicons';
import { HistoryStore } from './history';
import { registerIpc } from './ipc';
import { PermissionManager } from './permissions';
import { createPreferencesFile } from './preferences';
import { createListFetcher, ShieldService } from './shieldService';
import { TabManager } from './tabs';
import { registerUiScheme, serveUi, UI_ENTRY, UI_ORIGIN } from './uiProtocol';
import { UiStorage } from './uiStorage';
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
  const favicons = new FaviconService(webSession);
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

  const downloads = new DownloadManager(
    join(dataDir, 'downloads.json'),
    () => preferencesFile.get(),
    (list, startedId) => {
      emit({ type: 'downloads', downloads: list });
      if (startedId) emit({ type: 'download-started', id: startedId });
    },
    () => (window.isDestroyed() ? null : window),
  );

  tabs = new TabManager(window, webSession, {
    emitState: (state) => emit({ type: 'tab-state', state }),
    emitShortcut: (action) => emit({ type: 'shortcut', action }),
    openInNewTab: (url, background) => emit({ type: 'open-in-new-tab', url, background }),
    searchInNewTab: (text) => emit({ type: 'search-in-new-tab', text }),
    navigationBlocked: (tabId, url, protocol) => emit({ type: 'navigation-blocked', tabId, url: url.slice(0, 300), protocol }),
    fetchFavicon: (iconUrl) => favicons.fetchIcon(iconUrl),
    onCommit: (tabId, contents, url) => {
      history.add(url, contents.getTitle());
      permissions.cancelForTab(tabId);
    },
    onTitle: (url, title) => history.updateTitle(url, title),
    onMainFrameStart: (_tabId, contents: WebContents) => shield.resetPage(contents.id),
    shieldCount: (contents) => shield.pageBlockedCount(contents.id),
    shieldAllowed: (url) => shield.isSiteAllowed(url),
    onClosed: (tabId, contents) => {
      shield.forgetPage(contents.id);
      permissions.cancelForTab(tabId);
    },
  });

  shield.attach(webSession, (contents, id) => tabs.pageUrlFor(contents, id));
  permissions.attach(webSession);
  downloads.attach(webSession);

  const clearData = async (options: ClearDataOptions) => {
    if (options.history) history.clear(options.range);
    if (options.downloads) downloads.clear();
    if (options.cache) await webSession.clearCache();
    if (options.cookies) {
      await webSession.clearStorageData();
      permissions.clearDecisions();
    }
  };

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
    favicons,
    getPreferences: () => preferencesFile.get(),
    setPreferences: (preferences: DesktopPreferences) => {
      preferencesFile.set(preferences);
      return preferencesFile.get();
    },
    clearData,
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

app.on('window-all-closed', () => app.quit());
