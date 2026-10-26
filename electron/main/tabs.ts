/**
 * Pestañas reales: cada pestaña de ICARUS tiene una WebContentsView con su
 * propio proceso de renderizado aislado (sandbox, sin Node, aislamiento de
 * contexto). Todas comparten la sesión «persist:icarus-web» (cookies y
 * almacenamiento comunes, como las pestañas de un mismo perfil de Chrome).
 *
 * La interfaz informa del rectángulo del área de contenido y de qué pestaña
 * debe verse; este módulo coloca las vistas y comunica su estado real.
 */

import { WebContentsView, type BrowserWindow, type Input, type Session, type WebContents } from 'electron';
import type { FindResult, NavigateResult, NavigationErrorInfo, ShortcutAction, ViewportRect, WebTabState } from '../../src/types/native';
import { showPageContextMenu } from './contextMenu';
import { isAllowedPageNavigation, parseNavigableUrl, protocolOf } from './urlPolicy';
import { nextZoom, zoomSite, type ZoomAction } from './zoom';

const SNAPSHOT_TIMEOUT_MS = 3_000;

interface TabRecord {
  id: string;
  view: WebContentsView;
  state: WebTabState;
  /** Al empezar un tramo nuevo de navegación se borra el historial previo de la vista. */
  clearHistoryOnCommit: boolean;
}

export interface TabManagerHooks {
  emitState: (state: WebTabState) => void;
  emitShortcut: (action: ShortcutAction) => void;
  openInNewTab: (url: string, background: boolean) => void;
  searchInNewTab: (text: string) => void;
  navigationBlocked: (tabId: string, url: string, protocol: string) => void;
  fetchFavicon: (iconUrl: string) => Promise<string | null>;
  onCommit: (tabId: string, contents: WebContents, url: string) => void;
  onTitle: (url: string, title: string) => void;
  onMainFrameStart: (tabId: string, contents: WebContents) => void;
  shieldCount: (contents: WebContents) => number;
  shieldAllowed: (url: string) => boolean;
  onClosed: (tabId: string, contents: WebContents) => void;
  emitFind: (result: FindResult) => void;
  /** Zoom guardado para el sitio de la URL (1 = 100 %). */
  zoomFor: (url: string) => number;
  saveZoom: (url: string, factor: number) => void;
}

function emptyState(tabId: string): WebTabState {
  return {
    tabId,
    url: '',
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    favicon: null,
    error: null,
    blockedCount: 0,
    shieldAllowed: false,
    zoom: 100,
  };
}

/** Atajos que una página no debe poder capturar. */
export function shortcutForInput(input: Input): ShortcutAction | 'reload-hard' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'devtools' | null {
  if (input.type !== 'keyDown') return null;
  const mod = input.control || input.meta;
  const key = input.key.toLowerCase();
  if (mod && input.shift && key === 't') return 'reopen-closed-tab';
  if (mod && !input.shift && key === 't') return 'new-tab';
  if (mod && key === 'w') return 'close-tab';
  if ((mod && key === 'l') || (input.alt && key === 'd') || input.key === 'F6') return 'focus-address';
  if (input.control && (input.key === 'Tab' || input.key === 'PageDown' || input.key === 'PageUp')) {
    return input.key === 'PageUp' || (input.key === 'Tab' && input.shift) ? 'previous-tab' : 'next-tab';
  }
  if (input.alt && input.key === 'ArrowLeft') return 'back';
  if (input.alt && input.key === 'ArrowRight') return 'forward';
  if ((mod && input.shift && key === 'r') || (input.shift && input.key === 'F5')) return 'reload-hard';
  if ((mod && key === 'r') || input.key === 'F5') return 'reload';
  if (mod && key === 'h') return 'history';
  if (mod && key === 'j') return 'downloads';
  if (mod && !input.shift && key === 'f') return 'find';
  if (mod && !input.shift && key === 'd') return 'bookmark';
  if (mod && input.shift && key === 'o') return 'bookmarks';
  if (mod && (key === '+' || key === '=')) return 'zoom-in';
  if (mod && key === '-') return 'zoom-out';
  if (mod && key === '0') return 'zoom-reset';
  if (input.key === 'F12' || (mod && input.shift && key === 'i')) return 'devtools';
  return null;
}

function classifyError(code: number, description: string, url: string): NavigationErrorInfo {
  // Los códigos -200 a -299 de Chromium son errores de certificado.
  const kind = code <= -200 && code > -300 ? 'certificate' : code === -20 ? 'blocked' : 'network';
  return { kind, code, description, url };
}

export class TabManager {
  private readonly tabs = new Map<string, TabRecord>();
  private bounds: ViewportRect = { x: 0, y: 0, width: 0, height: 0 };
  private visibleId: string | null = null;
  private fullscreenId: string | null = null;
  private readonly pendingEmits = new Set<string>();

  constructor(
    private readonly window: BrowserWindow,
    private readonly webSession: Session,
    private readonly hooks: TabManagerHooks,
  ) {
    window.on('resize', () => this.layout());
    window.on('leave-full-screen', () => {
      if (!this.fullscreenId) return;
      this.fullscreenId = null;
      this.layout();
    });
  }

  navigate(tabId: string, rawUrl: string, newSegment: boolean): NavigateResult {
    const url = parseNavigableUrl(rawUrl);
    if (!url) return { ok: false, reason: /^[a-z][a-z0-9+.-]*:/i.test(rawUrl) && !/^https?:/i.test(rawUrl) ? 'blocked-protocol' : 'invalid-url' };
    const tab = this.ensure(tabId);
    tab.clearHistoryOnCommit = newSegment && tab.view.webContents.navigationHistory.length() > 0;
    tab.state = { ...tab.state, error: null, url: url.href, loading: true };
    this.emit(tab);
    void tab.view.webContents.loadURL(url.href).catch(() => {
      // Los fallos de carga llegan también por «did-fail-load», que ya actualiza el estado.
    });
    this.layout();
    return { ok: true };
  }

  goBack(tabId: string): void {
    const history = this.tabs.get(tabId)?.view.webContents.navigationHistory;
    if (history?.canGoBack()) history.goBack();
  }

  goForward(tabId: string): void {
    const history = this.tabs.get(tabId)?.view.webContents.navigationHistory;
    if (history?.canGoForward()) history.goForward();
  }

  reload(tabId: string, ignoreCache = false): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    tab.state = { ...tab.state, error: null };
    if (ignoreCache) tab.view.webContents.reloadIgnoringCache();
    else tab.view.webContents.reload();
  }

  stop(tabId: string): void {
    this.tabs.get(tabId)?.view.webContents.stop();
  }

  /**
   * Cambia el zoom real de la página (el de Chromium, no el de la interfaz) y lo
   * guarda para su sitio. Chromium lo aplica a todas las pestañas del mismo sitio,
   * así que se actualiza el estado de todas. Devuelve el porcentaje resultante.
   */
  zoom(tabId: string, action: ZoomAction): number {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.view.webContents.isDestroyed()) return 100;
    const contents = tab.view.webContents;
    const factor = nextZoom(contents.getZoomFactor(), action);
    contents.setZoomFactor(factor);
    const url = contents.getURL() || tab.state.url;
    this.hooks.saveZoom(url, factor);
    const site = zoomSite(url);
    for (const other of this.tabs.values()) {
      if (other === tab || (site && zoomSite(other.view.webContents.isDestroyed() ? '' : other.view.webContents.getURL()) === site)) this.emit(other);
    }
    return Math.round(factor * 100);
  }

  /** Cierra la pestaña y libera su proceso de renderizado. */
  close(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    this.tabs.delete(tabId);
    if (this.visibleId === tabId) this.visibleId = null;
    if (this.fullscreenId === tabId) this.exitFullscreen();
    const contents = tab.view.webContents;
    this.hooks.onClosed(tabId, contents);
    this.window.contentView.removeChildView(tab.view);
    if (!contents.isDestroyed()) contents.close();
  }

  show(tabId: string | null): void {
    this.visibleId = tabId && this.tabs.has(tabId) ? tabId : null;
    this.layout();
  }

  setBounds(rect: ViewportRect): void {
    this.bounds = rect;
    this.layout();
  }

  async snapshot(tabId: string): Promise<string | null> {
    const tab = this.tabs.get(tabId);
    if (!tab || this.visibleId !== tabId || tab.view.webContents.isDestroyed()) return null;
    try {
      // Una página que aún no ha pintado nada (p. ej. esperando credenciales) puede no
      // devolver nunca la captura: se abandona a los 3 s. La interfaz no espera tanto (oculta
      // la vista a los 500 ms) y muestra la captura cuando llega, también en equipos lentos.
      const image = await Promise.race([
        tab.view.webContents.capturePage(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), SNAPSHOT_TIMEOUT_MS)),
      ]);
      if (!image || image.isEmpty()) return null;
      return `data:image/jpeg;base64,${image.toJPEG(82).toString('base64')}`;
    } catch {
      return null;
    }
  }

  /** Busca texto en la página de la pestaña (Ctrl+F). */
  find(tabId: string, text: string, options: { forward: boolean; next: boolean }): void {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.view.webContents.isDestroyed()) return;
    if (!text) {
      this.stopFind(tabId);
      return;
    }
    // En Electron, `findNext: true` empieza una sesión de búsqueda nueva y `false` continúa
    // la actual. Una continuación sin sesión abierta no recibe ningún found-in-page.
    tab.view.webContents.findInPage(text, { forward: options.forward, findNext: !options.next, matchCase: false });
  }

  stopFind(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (tab && !tab.view.webContents.isDestroyed()) tab.view.webContents.stopFindInPage('clearSelection');
  }

  tabIdFor(contents: WebContents): string | null {
    for (const tab of this.tabs.values()) if (tab.view.webContents === contents) return tab.id;
    return null;
  }

  /** URL del documento principal de la pestaña que hace una solicitud (para Shield). */
  pageUrlFor(contents: WebContents | null, webContentsId: number): string | null {
    for (const tab of this.tabs.values()) {
      const wc = tab.view.webContents;
      if (wc === contents || wc.id === webContentsId) return wc.isDestroyed() ? null : wc.getURL() || tab.state.url;
    }
    return null;
  }

  refreshState(contents: WebContents): void {
    const id = this.tabIdFor(contents);
    const tab = id ? this.tabs.get(id) : null;
    if (tab) this.emit(tab);
  }

  refreshAll(): void {
    for (const tab of this.tabs.values()) this.emit(tab);
  }

  closeAll(): void {
    for (const id of [...this.tabs.keys()]) this.close(id);
  }

  private ensure(tabId: string): TabRecord {
    const existing = this.tabs.get(tabId);
    if (existing) return existing;
    const view = new WebContentsView({
      webPreferences: {
        session: this.webSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        navigateOnDragDrop: false,
        safeDialogs: true,
        spellcheck: true,
      },
    });
    view.setBackgroundColor('#ffffff');
    view.setVisible(false);
    this.window.contentView.addChildView(view);
    const tab: TabRecord = { id: tabId, view, state: emptyState(tabId), clearHistoryOnCommit: false };
    this.tabs.set(tabId, tab);
    this.wire(tab);
    return tab;
  }

  private wire(tab: TabRecord): void {
    const contents = tab.view.webContents;

    contents.setWindowOpenHandler(({ url, disposition }) => {
      // Las ventanas emergentes nunca se crean: los enlaces http(s) se abren en pestañas de ICARUS.
      if (parseNavigableUrl(url)) this.hooks.openInNewTab(url, disposition === 'background-tab');
      else if (url && url !== 'about:blank') this.hooks.navigationBlocked(tab.id, url, protocolOf(url));
      return { action: 'deny' };
    });

    const guard = (event: { preventDefault: () => void }, url: string) => {
      if (isAllowedPageNavigation(url)) return;
      event.preventDefault();
      this.hooks.navigationBlocked(tab.id, url, protocolOf(url));
    };
    contents.on('will-navigate', (event, url) => guard(event, url));
    contents.on('will-redirect', (event, url) => guard(event, url));

    contents.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      this.hooks.onMainFrameStart(tab.id, contents);
      tab.state = { ...tab.state, error: null, blockedCount: 0 };
      this.emit(tab);
    });
    contents.on('did-start-loading', () => {
      tab.state = { ...tab.state, loading: true };
      this.emit(tab);
    });
    contents.on('did-stop-loading', () => {
      tab.state = { ...tab.state, loading: false };
      this.emit(tab);
    });
    contents.on('did-navigate', (_event, url) => {
      if (tab.clearHistoryOnCommit) {
        tab.clearHistoryOnCommit = false;
        contents.navigationHistory.clear();
      }
      // El zoom guardado del sitio (también tras reiniciar ICARUS).
      const zoom = this.hooks.zoomFor(url);
      if (Math.abs(contents.getZoomFactor() - zoom) > 0.001) contents.setZoomFactor(zoom);
      tab.state = { ...tab.state, url, title: contents.getTitle(), favicon: null, error: null };
      this.hooks.onCommit(tab.id, contents, url);
      this.emit(tab);
    });
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      tab.state = { ...tab.state, url };
      this.hooks.onCommit(tab.id, contents, url);
      this.emit(tab);
    });
    contents.on('page-title-updated', (_event, title) => {
      tab.state = { ...tab.state, title };
      this.hooks.onTitle(contents.getURL(), title);
      this.emit(tab);
    });
    contents.on('page-favicon-updated', (_event, favicons) => {
      const icon = favicons.find((url) => parseNavigableUrl(url));
      if (!icon) return;
      const pageUrl = contents.getURL();
      void this.hooks.fetchFavicon(icon).then((dataUrl) => {
        if (!this.tabs.has(tab.id) || contents.isDestroyed() || contents.getURL() !== pageUrl) return;
        tab.state = { ...tab.state, favicon: dataUrl };
        this.emit(tab);
      });
    });
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      // -3 (ERR_ABORTED) ocurre al detener la carga o al navegar a otra página.
      if (!isMainFrame || code === -3) return;
      tab.state = { ...tab.state, loading: false, error: classifyError(code, description, url) };
      this.emit(tab);
      this.layout();
    });
    contents.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return;
      tab.state = {
        ...tab.state,
        loading: false,
        error: { kind: 'crashed', code: details.exitCode, description: details.reason, url: tab.state.url },
      };
      this.emit(tab);
      this.layout();
    });
    contents.on('enter-html-full-screen', () => {
      this.fullscreenId = tab.id;
      this.window.setFullScreen(true);
      this.layout();
    });
    contents.on('leave-html-full-screen', () => this.exitFullscreen());
    contents.on('before-input-event', (event, input) => {
      const action = shortcutForInput(input);
      if (!action) return;
      event.preventDefault();
      switch (action) {
        case 'reload-hard':
          this.reload(tab.id, true);
          return;
        case 'zoom-in':
          this.zoom(tab.id, 'in');
          return;
        case 'zoom-out':
          this.zoom(tab.id, 'out');
          return;
        case 'zoom-reset':
          this.zoom(tab.id, 'reset');
          return;
        case 'devtools':
          contents.toggleDevTools();
          return;
        case 'focus-address':
        case 'find':
          // El foco pasa a la interfaz para escribir en la barra de direcciones o de búsqueda.
          this.window.webContents.focus();
          this.hooks.emitShortcut(action);
          return;
        default:
          this.hooks.emitShortcut(action);
      }
    });
    // Ctrl + rueda del ratón o gesto de pellizco en el panel táctil.
    contents.on('zoom-changed', (_event, direction) => {
      this.zoom(tab.id, direction === 'in' ? 'in' : 'out');
    });
    contents.on('found-in-page', (_event, result) => {
      this.hooks.emitFind({ tabId: tab.id, activeMatch: result.activeMatchOrdinal, matches: result.matches, final: result.finalUpdate });
    });
    contents.on('context-menu', (_event, params) => {
      showPageContextMenu(this.window, contents, params, {
        openInNewTab: (url) => this.hooks.openInNewTab(url, true),
        searchInNewTab: (text) => this.hooks.searchInNewTab(text),
      });
    });
  }

  private exitFullscreen(): void {
    this.fullscreenId = null;
    if (this.window.isFullScreen()) this.window.setFullScreen(false);
    this.layout();
  }

  private layout(): void {
    const [width = 0, height = 0] = this.window.getContentSize();
    for (const tab of this.tabs.values()) {
      const fullscreen = this.fullscreenId === tab.id;
      const visible = fullscreen || (tab.id === this.visibleId && !tab.state.error);
      tab.view.setVisible(visible);
      if (!visible) continue;
      tab.view.setBounds(fullscreen ? { x: 0, y: 0, width, height } : this.bounds);
      // La vista visible queda por encima de las demás.
      this.window.contentView.addChildView(tab.view);
    }
  }

  private emit(tab: TabRecord): void {
    if (this.pendingEmits.has(tab.id)) return;
    this.pendingEmits.add(tab.id);
    queueMicrotask(() => {
      this.pendingEmits.delete(tab.id);
      if (!this.tabs.has(tab.id)) return;
      const contents = tab.view.webContents;
      if (contents.isDestroyed()) return;
      tab.state = {
        ...tab.state,
        canGoBack: contents.navigationHistory.canGoBack(),
        canGoForward: contents.navigationHistory.canGoForward(),
        blockedCount: this.hooks.shieldCount(contents),
        shieldAllowed: tab.state.url ? this.hooks.shieldAllowed(tab.state.url) : false,
        zoom: Math.round(contents.getZoomFactor() * 100),
      };
      this.hooks.emitState(tab.state);
    });
  }
}
