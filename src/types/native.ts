/**
 * Contrato entre la interfaz de ICARUS (renderer) y el proceso principal de
 * Electron. El preload expone `window.icarusNative` con esta forma únicamente a
 * la interfaz propia del navegador; las páginas web visitadas nunca la reciben.
 *
 * Este archivo solo contiene tipos: lo compilan tanto Vite (interfaz) como
 * tsc (proceso principal y preload).
 */

export const NATIVE_API_VERSION = 1;

export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type NavigateResult =
  | { ok: true }
  | { ok: false; reason: 'invalid-url' | 'blocked-protocol' | 'invalid-tab' };

export type NavigationErrorKind = 'network' | 'certificate' | 'blocked' | 'crashed';

export interface NavigationErrorInfo {
  kind: NavigationErrorKind;
  code: number;
  description: string;
  url: string;
}

/** Estado real de la pestaña informado por Chromium. */
export interface WebTabState {
  tabId: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Icono del sitio como data URL (descargado por el proceso principal). */
  favicon: string | null;
  error: NavigationErrorInfo | null;
  /** Solicitudes bloqueadas por ICARUS Shield en la página actual. */
  blockedCount: number;
  /** El sitio actual está en la lista de excepciones de Shield. */
  shieldAllowed: boolean;
}

export const SHORTCUT_ACTIONS = [
  'new-tab',
  'close-tab',
  'reopen-closed-tab',
  'focus-address',
  'next-tab',
  'previous-tab',
  'back',
  'forward',
  'reload',
  'history',
  'downloads',
] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

export type PermissionKind = 'media' | 'geolocation' | 'notifications' | 'clipboard-read' | 'midi';

export interface PermissionRequestInfo {
  id: string;
  tabId: string | null;
  origin: string;
  permission: PermissionKind;
  mediaTypes: Array<'audio' | 'video'>;
}

export type DownloadState = 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted';

export interface DownloadItemInfo {
  id: string;
  filename: string;
  url: string;
  savePath: string | null;
  state: DownloadState;
  receivedBytes: number;
  totalBytes: number;
  startedAt: number;
  endedAt: number | null;
  /** El archivo existe y no es de un tipo ejecutable. */
  canOpen: boolean;
  /** El archivo es de un tipo que puede ejecutar código (.exe, .msi, .bat…). */
  dangerous: boolean;
}

export interface HistoryItem {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
}

export type ShieldListError = 'network' | 'http' | 'too-large' | 'not-a-list' | 'empty' | 'invalid-url';

export interface ShieldListInfo {
  id: string;
  name: string;
  /** null para la lista incluida en ICARUS. */
  url: string | null;
  enabled: boolean;
  builtIn: boolean;
  ruleCount: number;
  ignoredCount: number;
  invalidCount: number;
  lastUpdated: number | null;
  error: ShieldListError | null;
  updating: boolean;
}

export interface ShieldState {
  enabled: boolean;
  lists: ShieldListInfo[];
  customRules: string;
  customRuleCount: number;
  customInvalidCount: number;
  exceptions: string[];
  totalBlocked: number;
  activeRuleCount: number;
}

export type AddListResult = { ok: true; state: ShieldState } | { ok: false; error: ShieldListError | 'duplicate' };

export interface DesktopPreferences {
  downloads: {
    askWhereToSave: boolean;
    /** null usa la carpeta Descargas del sistema. */
    directory: string | null;
  };
  privacy: {
    clearOnExit: {
      history: boolean;
      cookies: boolean;
      cache: boolean;
    };
  };
}

export type ClearRange = 'hour' | 'day' | 'week' | 'all';

export interface ClearDataOptions {
  range: ClearRange;
  history: boolean;
  /** Cookies y datos de sitios (siempre se borran por completo). */
  cookies: boolean;
  cache: boolean;
  downloads: boolean;
}

export type NativeEvent =
  | { type: 'tab-state'; state: WebTabState }
  | { type: 'open-in-new-tab'; url: string; background: boolean }
  | { type: 'search-in-new-tab'; text: string }
  | { type: 'shortcut'; action: ShortcutAction }
  | { type: 'navigation-blocked'; tabId: string; url: string; protocol: string }
  | { type: 'permission-request'; request: PermissionRequestInfo }
  | { type: 'permission-cancelled'; id: string }
  | { type: 'downloads'; downloads: DownloadItemInfo[] }
  | { type: 'download-started'; id: string }
  | { type: 'history-changed' }
  | { type: 'shield'; state: ShieldState };

export interface IcarusNativeApi {
  apiVersion: number;
  platform: string;
  appVersion: string;
  engineName: string;
  chromiumVersion: string;
  /** Carpeta donde ICARUS guarda los datos del usuario. */
  dataDirectory: string;
  storage: {
    /** Copia de las claves `icarus.*` leída al arrancar. */
    snapshot: Record<string, string>;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
  tabs: {
    navigate(tabId: string, url: string, options: { newSegment: boolean }): Promise<NavigateResult>;
    goBack(tabId: string): void;
    goForward(tabId: string): void;
    reload(tabId: string): void;
    stop(tabId: string): void;
    close(tabId: string): void;
    /** Muestra la vista web de la pestaña (o ninguna con null). */
    show(tabId: string | null): void;
    setBounds(rect: ViewportRect): void;
    /** Captura la página visible para mostrarla bajo menús y diálogos. */
    snapshot(tabId: string): Promise<string | null>;
  };
  window: {
    setTitleBarColors(colors: { color: string; symbolColor: string }): void;
  };
  history: {
    list(): Promise<HistoryItem[]>;
    remove(id: string): Promise<void>;
  };
  downloads: {
    list(): Promise<DownloadItemInfo[]>;
    cancel(id: string): void;
    open(id: string): Promise<boolean>;
    showInFolder(id: string): void;
    clear(): void;
    chooseDirectory(): Promise<string | null>;
  };
  shield: {
    getState(): Promise<ShieldState>;
    setEnabled(enabled: boolean): Promise<ShieldState>;
    setListEnabled(id: string, enabled: boolean): Promise<ShieldState>;
    addList(name: string, url: string): Promise<AddListResult>;
    removeList(id: string): Promise<ShieldState>;
    updateLists(): Promise<ShieldState>;
    setCustomRules(text: string): Promise<ShieldState>;
    setSiteAllowed(hostname: string, allowed: boolean): Promise<ShieldState>;
  };
  privacy: {
    clearData(options: ClearDataOptions): Promise<void>;
  };
  permissions: {
    respond(id: string, granted: boolean): void;
  };
  preferences: {
    get(): Promise<DesktopPreferences>;
    set(preferences: DesktopPreferences): Promise<DesktopPreferences>;
  };
  favicons: {
    get(pageUrl: string): Promise<string | null>;
  };
  onEvent(listener: (event: NativeEvent) => void): () => void;
}
