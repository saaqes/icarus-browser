/**
 * Controlador del navegador: pestañas, historial y navegación.
 *
 * Toda navegación pasa por aquí: se interpreta la entrada (URL, búsqueda, alias,
 * página interna), se registra en el historial de la pestaña y, si es una página
 * web, se entrega al motor de navegación (hoy, el navegador externo).
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
import type { Settings } from '../../types/settings';
import type { HistoryEntry, PageEntry, SessionState, SettingsSection, Tab } from '../../types/tabs';
import { useToast } from '../common/Toast';

export interface OpenOptions {
  newTab?: boolean;
}

export interface BrowserController {
  session: SessionState;
  activeTab: Tab;
  currentEntry: HistoryEntry;
  describe: (page: PageEntry) => PagePresentation;
  navigateInput: (text: string, options?: OpenOptions) => boolean;
  openUrl: (url: string, options?: OpenOptions) => void;
  openPage: (page: PageEntry, options?: OpenOptions) => void;
  /** Marca la página actual como entregada al navegador externo (tras pulsar su enlace). */
  markCurrentOpened: () => void;
  newTab: () => void;
  closeTab: (tabId: string) => void;
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
}

const BrowserContext = createContext<BrowserController | null>(null);

export function useBrowser(): BrowserController {
  const controller = useContext(BrowserContext);
  if (!controller) throw new Error('useBrowser debe usarse dentro de <BrowserProvider>');
  return controller;
}

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
  const m = useMessages();
  const notify = useToast();
  const [settings] = useSettings();
  const [rules] = useAliasRules();
  const [session, dispatch] = useReducer(sessionReducer, services, initialSession);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const addressBarFocus = useRef<(() => void) | null>(null);

  // Referencias estables para las acciones (evita recrearlas en cada render).
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

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
        titles: { newTab: m.pages.newTab, blank: m.pages.blank, settings: m.pages.settings },
      }),
    [rules, settings.advanced.showAliases, m],
  );

  const openExternally = useCallback(
    (tabId: string, entryId: string, url: string) => {
      dispatch({ type: 'tab/loading', tabId, loading: true });
      // El motor abre la ventana de forma síncrona dentro del gesto del usuario.
      void services.engine.navigate({ tabId, url }).then((outcome) => {
        dispatch({ type: 'tab/loading', tabId, loading: false });
        if (outcome.status === 'opened-externally' || outcome.status === 'rendered') {
          dispatch({ type: 'tab/mark-opened', tabId, entryId });
        } else {
          notify('error', outcome.status === 'rejected' ? m.navigationNotices.rejected : m.navigationNotices.openFailed);
        }
      });
    },
    [m, notify, services.engine],
  );

  const openPage = useCallback(
    (page: PageEntry, options: OpenOptions = {}) => {
      const current = sessionRef.current;
      const now = services.now().getTime();
      const entry = createHistoryEntry(page, services.createId(), now);
      let tabId = getActiveTab(current).id;
      if (options.newTab) {
        if (current.tabs.length >= MAX_TABS) {
          notify('info', m.tabs.limit);
          return;
        }
        tabId = services.createId();
        dispatch({ type: 'tab/create', tab: createTab(tabId, entry), position: 'after-active' });
      } else {
        dispatch({ type: 'tab/navigate', tabId, entry });
      }
      if (page.kind === 'external' && settingsRef.current.navigation.externalOpening === 'automatic') {
        openExternally(tabId, entry.id, page.url);
      }
    },
    [m, notify, openExternally, services],
  );

  const openUrl = useCallback(
    (url: string, options?: OpenOptions) => openPage({ kind: 'external', url, openedExternally: false }, options),
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
      const now = services.now().getTime();
      const replacement = createTab(services.createId(), createHistoryEntry(newTabPageFor(settingsRef.current), services.createId(), now));
      dispatch({ type: 'tab/close', tabId, replacement });
    },
    [services],
  );

  const activateTab = useCallback((tabId: string) => dispatch({ type: 'tab/activate', tabId }), []);
  const goBack = useCallback(() => dispatch({ type: 'tab/back', tabId: getActiveTab(sessionRef.current).id }), []);
  const goForward = useCallback(() => dispatch({ type: 'tab/forward', tabId: getActiveTab(sessionRef.current).id }), []);
  const stop = useCallback(() => dispatch({ type: 'tab/loading', tabId: getActiveTab(sessionRef.current).id, loading: false }), []);

  const reload = useCallback(() => {
    const tab = getActiveTab(sessionRef.current);
    const entry = getCurrentEntry(tab);
    // Con apertura automática, recargar vuelve a entregar la página al navegador externo.
    // Con «pedir confirmación» solo se vuelve a mostrar la página interna.
    if (entry.page.kind === 'external' && settingsRef.current.navigation.externalOpening === 'automatic') {
      openExternally(tab.id, entry.id, entry.page.url);
    } else {
      dispatch({ type: 'tab/reload', tabId: tab.id });
    }
  }, [openExternally]);

  const goHome = useCallback(() => {
    const home = settingsRef.current.general.homePage;
    if (home.kind === 'url') openUrl(home.url);
    else openPage({ kind: 'newtab' });
  }, [openPage, openUrl]);

  const openSettings = useCallback(
    (section: SettingsSection = 'general') => {
      const current = sessionRef.current;
      const active = getActiveTab(current);
      const activeKind = getCurrentEntry(active).page.kind;
      if (activeKind === 'newtab' || activeKind === 'blank' || activeKind === 'settings') {
        if (activeKind === 'settings') dispatch({ type: 'tab/replace', tabId: active.id, page: { kind: 'settings', section } });
        else openPage({ kind: 'settings', section });
        return;
      }
      const existing = current.tabs.find((tab) => getCurrentEntry(tab).page.kind === 'settings');
      if (existing) {
        dispatch({ type: 'tab/activate', tabId: existing.id });
        dispatch({ type: 'tab/replace', tabId: existing.id, page: { kind: 'settings', section } });
      } else {
        openPage({ kind: 'settings', section }, { newTab: true });
      }
    },
    [openPage],
  );

  const setSettingsSection = useCallback((section: SettingsSection) => {
    dispatch({ type: 'tab/replace', tabId: getActiveTab(sessionRef.current).id, page: { kind: 'settings', section } });
  }, []);

  const registerAddressBar = useCallback((focus: (() => void) | null) => {
    addressBarFocus.current = focus;
  }, []);

  // Atajos de teclado. En la versión web el navegador anfitrión puede reservar algunos.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if ((mod && key === 'l') || (event.altKey && key === 'd') || event.key === 'F6') {
        event.preventDefault();
        addressBarFocus.current?.();
      } else if (mod && !event.shiftKey && key === 't') {
        event.preventDefault();
        newTab();
      } else if (mod && key === 'w') {
        event.preventDefault();
        closeTab(getActiveTab(sessionRef.current).id);
      } else if (event.ctrlKey && (event.key === 'Tab' || event.key === 'PageDown' || event.key === 'PageUp')) {
        event.preventDefault();
        const backwards = event.key === 'PageUp' || (event.key === 'Tab' && event.shiftKey);
        dispatch({ type: 'tab/activate-relative', offset: backwards ? -1 : 1 });
      } else if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        goBack();
      } else if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault();
        goForward();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeTab, goBack, goForward, newTab]);

  const value = useMemo<BrowserController>(
    () => ({
      session,
      activeTab,
      currentEntry,
      describe,
      navigateInput,
      openUrl,
      openPage,
      markCurrentOpened,
      newTab,
      closeTab,
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
    }),
    [
      session,
      activeTab,
      currentEntry,
      describe,
      navigateInput,
      openUrl,
      openPage,
      markCurrentOpened,
      newTab,
      closeTab,
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
    ],
  );

  return <BrowserContext.Provider value={value}>{children}</BrowserContext.Provider>;
}
