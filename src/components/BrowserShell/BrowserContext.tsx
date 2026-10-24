/**
 * Controlador del navegador: pestañas, historial y navegación.
 *
 * Toda navegación pasa por aquí: se interpreta la entrada (URL, búsqueda, alias,
 * página interna) y se registra en el historial de la pestaña.
 *
 * - Motor integrado (escritorio): cada pestaña tiene una vista de Chromium. Una
 *   entrada «web» del historial representa un tramo de navegación cuyo
 *   historial interno (atrás/adelante entre páginas web) gestiona el motor.
 *   URL, título, icono, carga y errores llegan como eventos reales.
 * - Motor externo (versión web): la página se entrega al navegador del sistema
 *   y la pestaña muestra una página interna que lo indica.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useServices } from '../../app/ServicesContext';
import type { AppServices } from '../../app/services';
import { useAliasRules, useSettings } from '../../hooks/useStores';
import { useMessages } from '../../i18n';
import { STORAGE_KEYS } from '../../services/persistence/keys';
import { buildSearchUrl } from '../../services/search/providers';
import { describePage, type PagePresentation } from '../../services/tabs/pages';
import {
  createHistoryEntry,
  createSession,
  createTab,
  getActiveTab,
  getCurrentEntry,
  MAX_TABS,
  sessionReducer,
} from '../../services/tabs/tabs';
import { resolveInput } from '../../services/url-resolution/resolveInput';
import type { NativeEvent, PermissionRequestInfo, ShortcutAction, WebTabState } from '../../types/native';
import type { Settings } from '../../types/settings';
import type { HistoryEntry, PageEntry, SessionState, SettingsSection, Tab } from '../../types/tabs';
import { useToast } from '../common/Toast';

export interface OpenOptions {
  newTab?: boolean;
  /** Con `newTab`, abre la pestaña sin activarla (clic central, «abrir en segundo plano»). */
  background?: boolean;
}

export interface BrowserController {
  session: SessionState;
  activeTab: Tab;
  currentEntry: HistoryEntry;
  /** Hay un motor que muestra las páginas dentro de ICARUS. */
  embedded: boolean;
  /** Estado real de las vistas web por pestaña (solo motor integrado). */
  webState: Record<string, WebTabState>;
  /** Pestaña cuya vista web debe mostrarse ahora (null si la pestaña muestra una página interna). */
  liveWebTabId: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  describe: (page: PageEntry) => PagePresentation;
  navigateInput: (text: string, options?: OpenOptions) => boolean;
  openUrl: (url: string, options?: OpenOptions) => void;
  openPage: (page: PageEntry, options?: OpenOptions) => void;
  markCurrentOpened: () => void;
  newTab: () => void;
  closeTab: (tabId: string) => void;
  reopenClosedTab: () => void;
  activateTab: (tabId: string) => void;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  stop: () => void;
  goHome: () => void;
  openSettings: (section?: SettingsSection) => void;
  setSettingsSection: (section: SettingsSection) => void;
  customizeOpen: boolean;
  setCustomizeOpen: (open: boolean) => void;
  registerAddressBar: (focus: (() => void) | null) => void;
  focusAddressBar: () => void;
  permissionRequests: PermissionRequestInfo[];
  respondPermission: (id: string, granted: boolean) => void;
}

const BrowserContext = createContext<BrowserController | null>(null);

export function useBrowser(): BrowserController {
  const controller = useContext(BrowserContext);
  if (!controller) throw new Error('useBrowser debe usarse dentro de <BrowserProvider>');
  return controller;
}

const MAX_CLOSED_TABS = 25;

function newTabPageFor(settings: Settings): PageEntry {
  return settings.navigation.newTabPage === 'blank' ? { kind: 'blank' } : { kind: 'newtab' };
}

function initialSession(services: AppServices): SessionState {
  const settings = services.settings.getSnapshot();
  if (settings.general.startup === 'restore-session') {
    const stored = services.session.getSnapshot();
    if (stored) return stored;
  }
  const now = services.now().getTime();
  return createSession(createTab(services.createId(), createHistoryEntry(newTabPageFor(settings), services.createId(), now)));
}

export function BrowserProvider({ children }: { children: ReactNode }) {
  const services = useServices();
  const { engine, native } = services;
  const embedded = engine.info.capabilities.embeddedRendering;
  const m = useMessages();
  const notify = useToast();
  const [settings] = useSettings();
  const [rules] = useAliasRules();
  const [session, dispatch] = useReducer(sessionReducer, services, initialSession);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [webState, setWebState] = useState<Record<string, WebTabState>>({});
  const [permissionRequests, setPermissionRequests] = useState<PermissionRequestInfo[]>([]);
  const addressBarFocus = useRef<(() => void) | null>(null);
  /** Entrada web que muestra ahora la vista de cada pestaña (tramo «vivo»). */
  const liveEntry = useRef(new Map<string, string>());
  const closedTabs = useRef<PageEntry[]>([]);

  // Referencias estables para las acciones (evita recrearlas en cada render).
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const rulesRef = useRef(rules);
  rulesRef.current = rules;
  const webStateRef = useRef(webState);
  webStateRef.current = webState;

  const activeTab = getActiveTab(session);
  const currentEntry = getCurrentEntry(activeTab);

  // Persistencia de la sesión solo si el usuario eligió restaurarla al iniciar.
  const restore = settings.general.startup === 'restore-session';
  useEffect(() => {
    if (restore) services.session.set(session);
  }, [restore, services, session]);
  useEffect(() => {
    if (!restore) services.storage.removeItem(STORAGE_KEYS.session);
  }, [restore, services]);

  const describe = useCallback(
    (page: PageEntry) =>
      describePage(page, {
        rules,
        showAliases: settings.advanced.showAliases,
        titles: {
          newTab: m.pages.newTab,
          blank: m.pages.blank,
          settings: m.pages.settings,
          history: m.pages.history,
          downloads: m.pages.downloads,
        },
      }),
    [rules, settings.advanced.showAliases, m],
  );

  /* ------------------------------ Motor externo ------------------------------ */

  const openExternally = useCallback(
    (tabId: string, entryId: string, url: string) => {
      dispatch({ type: 'tab/loading', tabId, loading: true });
      // El motor abre la ventana de forma síncrona dentro del gesto del usuario.
      void engine.navigate({ tabId, url }).then((outcome) => {
        dispatch({ type: 'tab/loading', tabId, loading: false });
        if (outcome.status === 'opened-externally') {
          dispatch({ type: 'tab/mark-opened', tabId, entryId });
        } else {
          notify('error', outcome.status === 'rejected' ? m.navigationNotices.rejected : m.navigationNotices.openFailed);
        }
      });
    },
    [engine, m, notify],
  );

  /* ----------------------------- Motor integrado ----------------------------- */

  /** Carga la URL de una entrada web en la vista de la pestaña. */
  const loadWebEntry = useCallback(
    (tabId: string, entry: HistoryEntry, newSegment: boolean) => {
      if (entry.page.kind !== 'web') return;
      liveEntry.current.set(tabId, entry.id);
      void engine.navigate({ tabId, url: entry.page.url, newSegment }).then((outcome) => {
        if (outcome.status === 'rejected') notify('error', m.navigationNotices.rejected);
      });
    },
    [engine, m, notify],
  );

  /* ------------------------------- Navegación -------------------------------- */

  const openPage = useCallback(
    (page: PageEntry, options: OpenOptions = {}) => {
      const current = sessionRef.current;
      const now = services.now().getTime();
      const entry = createHistoryEntry(page, services.createId(), now);
      const active = getActiveTab(current);

      if (options.newTab) {
        if (current.tabs.length >= MAX_TABS) {
          notify('info', m.tabs.limit);
          return;
        }
        const tabId = services.createId();
        dispatch({ type: 'tab/create', tab: createTab(tabId, entry), position: 'after-active' });
        if (options.background) dispatch({ type: 'tab/activate', tabId: active.id });
        if (page.kind === 'web') {
          if (embedded) loadWebEntry(tabId, entry, false);
          else if (settingsRef.current.navigation.externalOpening === 'automatic') openExternally(tabId, entry.id, page.url);
        }
        return;
      }

      const currentEntryOfActive = getCurrentEntry(active);
      if (embedded && page.kind === 'web' && currentEntryOfActive.page.kind === 'web' && liveEntry.current.get(active.id) === currentEntryOfActive.id) {
        // Navegación dentro del tramo web actual: el historial lo gestiona el motor.
        dispatch({ type: 'tab/update-web', tabId: active.id, entryId: currentEntryOfActive.id, url: page.url, title: '' });
        loadWebEntry(active.id, { ...currentEntryOfActive, page }, false);
        return;
      }

      dispatch({ type: 'tab/navigate', tabId: active.id, entry });
      if (page.kind !== 'web') return;
      if (embedded) loadWebEntry(active.id, entry, true);
      else if (settingsRef.current.navigation.externalOpening === 'automatic') openExternally(active.id, entry.id, page.url);
    },
    [embedded, loadWebEntry, m, notify, openExternally, services],
  );

  const openUrl = useCallback(
    (url: string, options?: OpenOptions) => openPage({ kind: 'web', url, openedExternally: false }, options),
    [openPage],
  );

  const navigateInput = useCallback(
    (text: string, options?: OpenOptions): boolean => {
      const resolution = resolveInput(text, {
        providerId: settingsRef.current.general.searchProvider,
        rules: rulesRef.current,
      });
      switch (resolution.kind) {
        case 'empty':
          return false;
        case 'blocked':
          notify(
            'error',
            resolution.dangerous
              ? m.navigationNotices.blocked(resolution.protocol)
              : m.navigationNotices.unsupported(resolution.protocol),
          );
          return false;
        case 'alias-unresolved':
          notify(
            'info',
            resolution.reason === 'disabled'
              ? m.navigationNotices.aliasDisabled(resolution.alias)
              : m.navigationNotices.aliasUnknown(resolution.alias),
          );
          return false;
        case 'internal-unknown':
          notify('error', m.navigationNotices.internalUnknown);
          return false;
        case 'internal':
          openPage(resolution.page, options);
          return true;
        case 'url':
        case 'search':
        case 'alias':
          openUrl(resolution.url, options);
          return true;
      }
    },
    [m, notify, openPage, openUrl],
  );

  const markCurrentOpened = useCallback(() => {
    const tab = getActiveTab(sessionRef.current);
    dispatch({ type: 'tab/mark-opened', tabId: tab.id, entryId: getCurrentEntry(tab).id });
  }, []);

  const focusAddressBar = useCallback(() => {
    // Se espera al siguiente fotograma para que la pestaña nueva ya esté montada.
    requestAnimationFrame(() => addressBarFocus.current?.());
  }, []);

  const newTab = useCallback(() => {
    const current = sessionRef.current;
    if (current.tabs.length >= MAX_TABS) {
      notify('info', m.tabs.limit);
      return;
    }
    const now = services.now().getTime();
    const tab = createTab(services.createId(), createHistoryEntry(newTabPageFor(settingsRef.current), services.createId(), now));
    dispatch({ type: 'tab/create', tab, position: 'end' });
    focusAddressBar();
  }, [focusAddressBar, m, notify, services]);

  const closeTab = useCallback(
    (tabId: string) => {
      const tab = sessionRef.current.tabs.find((item) => item.id === tabId);
      if (tab) {
        const entry = getCurrentEntry(tab);
        const live = webStateRef.current[tabId];
        const page: PageEntry =
          entry.page.kind === 'web' && live?.url ? { ...entry.page, url: live.url, title: live.title } : entry.page;
        closedTabs.current = [page, ...closedTabs.current].slice(0, MAX_CLOSED_TABS);
      }
      liveEntry.current.delete(tabId);
      engine.detachTab?.(tabId);
      setWebState((states) => {
        if (!(tabId in states)) return states;
        const next = { ...states };
        delete next[tabId];
        return next;
      });
      setPermissionRequests((requests) => requests.filter((request) => request.tabId !== tabId));
      const now = services.now().getTime();
      const replacement = createTab(services.createId(), createHistoryEntry(newTabPageFor(settingsRef.current), services.createId(), now));
      dispatch({ type: 'tab/close', tabId, replacement });
    },
    [engine, services],
  );

  const reopenClosedTab = useCallback(() => {
    const [page, ...rest] = closedTabs.current;
    if (!page) return;
    closedTabs.current = rest;
    openPage(page.kind === 'web' ? { ...page, openedExternally: false } : page, { newTab: true });
  }, [openPage]);

  const activateTab = useCallback((tabId: string) => dispatch({ type: 'tab/activate', tabId }), []);

  const goBack = useCallback(() => {
    const tab = getActiveTab(sessionRef.current);
    const entry = getCurrentEntry(tab);
    const live = webStateRef.current[tab.id];
    if (embedded && entry.page.kind === 'web' && liveEntry.current.get(tab.id) === entry.id && live?.canGoBack) {
      engine.goBack?.(tab.id);
      return;
    }
    dispatch({ type: 'tab/back', tabId: tab.id });
  }, [embedded, engine]);

  const goForward = useCallback(() => {
    const tab = getActiveTab(sessionRef.current);
    const entry = getCurrentEntry(tab);
    const live = webStateRef.current[tab.id];
    if (embedded && entry.page.kind === 'web' && liveEntry.current.get(tab.id) === entry.id && live?.canGoForward) {
      engine.goForward?.(tab.id);
      return;
    }
    dispatch({ type: 'tab/forward', tabId: tab.id });
  }, [embedded, engine]);

  const stop = useCallback(() => {
    const tab = getActiveTab(sessionRef.current);
    if (embedded) engine.stop?.(tab.id);
    dispatch({ type: 'tab/loading', tabId: tab.id, loading: false });
  }, [embedded, engine]);

  const reload = useCallback(() => {
    const tab = getActiveTab(sessionRef.current);
    const entry = getCurrentEntry(tab);
    if (entry.page.kind === 'web' && embedded) {
      if (liveEntry.current.get(tab.id) === entry.id && webStateRef.current[tab.id]) engine.reload?.(tab.id);
      else loadWebEntry(tab.id, entry, true);
      return;
    }
    // Con apertura automática, recargar vuelve a entregar la página al navegador externo.
    // Con «pedir confirmación» solo se vuelve a mostrar la página interna.
    if (entry.page.kind === 'web' && settingsRef.current.navigation.externalOpening === 'automatic') {
      openExternally(tab.id, entry.id, entry.page.url);
    } else {
      dispatch({ type: 'tab/reload', tabId: tab.id });
    }
  }, [embedded, engine, loadWebEntry, openExternally]);

  const goHome = useCallback(() => {
    const home = settingsRef.current.general.homePage;
    if (home.kind === 'url') openUrl(home.url);
    else openPage({ kind: 'newtab' });
  }, [openPage, openUrl]);

  /** Abre una página interna reutilizando una pestaña que ya la muestre. */
  const openInternal = useCallback(
    (page: PageEntry, matches: (entry: PageEntry) => boolean) => {
      const current = sessionRef.current;
      const active = getActiveTab(current);
      const activeKind = getCurrentEntry(active).page.kind;
      if (matches(getCurrentEntry(active).page)) {
        dispatch({ type: 'tab/replace', tabId: active.id, page });
        return;
      }
      if (activeKind === 'newtab' || activeKind === 'blank') {
        openPage(page);
        return;
      }
      const existing = current.tabs.find((tab) => matches(getCurrentEntry(tab).page));
      if (existing) {
        dispatch({ type: 'tab/activate', tabId: existing.id });
        dispatch({ type: 'tab/replace', tabId: existing.id, page });
      } else {
        openPage(page, { newTab: true });
      }
    },
    [openPage],
  );

  const openSettings = useCallback(
    (section: SettingsSection = 'general') => openInternal({ kind: 'settings', section }, (page) => page.kind === 'settings'),
    [openInternal],
  );

  const setSettingsSection = useCallback((section: SettingsSection) => {
    dispatch({ type: 'tab/replace', tabId: getActiveTab(sessionRef.current).id, page: { kind: 'settings', section } });
  }, []);

  const registerAddressBar = useCallback((focus: (() => void) | null) => {
    addressBarFocus.current = focus;
  }, []);

  const respondPermission = useCallback(
    (id: string, granted: boolean) => {
      native?.permissions.respond(id, granted);
      setPermissionRequests((requests) => requests.filter((request) => request.id !== id));
    },
    [native],
  );

  /* -------------------------- Atajos y eventos nativos ------------------------- */

  const runShortcut = useCallback(
    (action: ShortcutAction) => {
      switch (action) {
        case 'new-tab':
          return newTab();
        case 'close-tab':
          return closeTab(getActiveTab(sessionRef.current).id);
        case 'reopen-closed-tab':
          return reopenClosedTab();
        case 'focus-address':
          return addressBarFocus.current?.();
        case 'next-tab':
          return dispatch({ type: 'tab/activate-relative', offset: 1 });
        case 'previous-tab':
          return dispatch({ type: 'tab/activate-relative', offset: -1 });
        case 'back':
          return goBack();
        case 'forward':
          return goForward();
        case 'reload':
          return reload();
        case 'history':
          return openInternal({ kind: 'history' }, (page) => page.kind === 'history');
        case 'downloads':
          return openInternal({ kind: 'downloads' }, (page) => page.kind === 'downloads');
      }
    },
    [closeTab, goBack, goForward, newTab, openInternal, reload, reopenClosedTab],
  );

  useEffect(() => {
    if (!native) return undefined;
    const handle = (event: NativeEvent) => {
      switch (event.type) {
        case 'tab-state': {
          const { state } = event;
          setWebState((states) => ({ ...states, [state.tabId]: state }));
          dispatch({ type: 'tab/loading', tabId: state.tabId, loading: state.loading });
          const entryId = liveEntry.current.get(state.tabId);
          if (entryId && state.url) dispatch({ type: 'tab/update-web', tabId: state.tabId, entryId, url: state.url, title: state.title });
          return;
        }
        case 'open-in-new-tab':
          return openUrl(event.url, { newTab: true, background: event.background });
        case 'search-in-new-tab':
          return openUrl(buildSearchUrl(settingsRef.current.general.searchProvider, event.text), { newTab: true });
        case 'shortcut':
          return runShortcut(event.action);
        case 'navigation-blocked':
          return notify('info', m.navigationNotices.unsupported(event.protocol || event.url));
        case 'permission-request':
          return setPermissionRequests((requests) => [...requests, event.request]);
        case 'permission-cancelled':
          return setPermissionRequests((requests) => requests.filter((request) => request.id !== event.id));
        default:
          return undefined;
      }
    };
    return native.onEvent(handle);
  }, [m, native, notify, openUrl, runShortcut]);

  // Al volver a una entrada web que no es la que muestra la vista (o al
  // restaurar la sesión), se carga su dirección en un tramo nuevo.
  useEffect(() => {
    if (!embedded || currentEntry.page.kind !== 'web') return;
    if (liveEntry.current.get(activeTab.id) === currentEntry.id) return;
    loadWebEntry(activeTab.id, currentEntry, true);
  }, [activeTab.id, currentEntry, embedded, loadWebEntry]);

  // Atajos de teclado de la interfaz. En la aplicación de escritorio, cuando la
  // página web tiene el foco, el proceso principal los envía como eventos.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      let action: ShortcutAction | null = null;
      if ((mod && key === 'l') || (event.altKey && key === 'd') || event.key === 'F6') action = 'focus-address';
      else if (mod && event.shiftKey && key === 't') action = 'reopen-closed-tab';
      else if (mod && !event.shiftKey && key === 't') action = 'new-tab';
      else if (mod && key === 'w') action = 'close-tab';
      else if (event.ctrlKey && (event.key === 'Tab' || event.key === 'PageDown' || event.key === 'PageUp')) {
        action = event.key === 'PageUp' || (event.key === 'Tab' && event.shiftKey) ? 'previous-tab' : 'next-tab';
      } else if (event.altKey && event.key === 'ArrowLeft') action = 'back';
      else if (event.altKey && event.key === 'ArrowRight') action = 'forward';
      else if (embedded && mod && key === 'h') action = 'history';
      else if (embedded && mod && key === 'j') action = 'downloads';
      else if (embedded && ((mod && key === 'r') || event.key === 'F5')) action = 'reload';
      if (!action) return;
      event.preventDefault();
      runShortcut(action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [embedded, runShortcut]);

  const live = webState[activeTab.id];
  const isLiveWeb = embedded && currentEntry.page.kind === 'web' && liveEntry.current.get(activeTab.id) === currentEntry.id;
  const liveWebTabId = isLiveWeb ? activeTab.id : null;
  const canGoBack = (isLiveWeb && Boolean(live?.canGoBack)) || activeTab.index > 0;
  const canGoForward = (isLiveWeb && Boolean(live?.canGoForward)) || activeTab.index < activeTab.entries.length - 1;

  const value = useMemo<BrowserController>(
    () => ({
      session,
      activeTab,
      currentEntry,
      embedded,
      webState,
      liveWebTabId,
      canGoBack,
      canGoForward,
      describe,
      navigateInput,
      openUrl,
      openPage,
      markCurrentOpened,
      newTab,
      closeTab,
      reopenClosedTab,
      activateTab,
      goBack,
      goForward,
      reload,
      stop,
      goHome,
      openSettings,
      setSettingsSection,
      customizeOpen,
      setCustomizeOpen,
      registerAddressBar,
      focusAddressBar,
      permissionRequests,
      respondPermission,
    }),
    [
      session,
      activeTab,
      currentEntry,
      embedded,
      webState,
      liveWebTabId,
      canGoBack,
      canGoForward,
      describe,
      navigateInput,
      openUrl,
      openPage,
      markCurrentOpened,
      newTab,
      closeTab,
      reopenClosedTab,
      activateTab,
      goBack,
      goForward,
      reload,
      stop,
      goHome,
      openSettings,
      setSettingsSection,
      customizeOpen,
      registerAddressBar,
      focusAddressBar,
      permissionRequests,
      respondPermission,
    ],
  );

  return <BrowserContext.Provider value={value}>{children}</BrowserContext.Provider>;
}
