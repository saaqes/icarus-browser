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
export type ZoomAction = 'in' | 'out' | 'reset';

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
  /** Zoom real de la página en porcentaje (100 = sin zoom). */
  zoom: number;
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
  'find',
  'bookmark',
  'bookmarks',
] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

/** Resultado de buscar en la página (findInPage de Chromium). */
export interface FindResult {
  tabId: string;
  /** Posición de la coincidencia resaltada (empieza en 1; 0 si no hay). */
  activeMatch: number;
  matches: number;
  final: boolean;
}

export type PermissionKind = 'media' | 'geolocation' | 'notifications' | 'clipboard-read' | 'midi';

export interface PermissionRequestInfo {
  id: string;
  tabId: string | null;
  origin: string;
  permission: PermissionKind;
  mediaTypes: Array<'audio' | 'video'>;
}

/** Solicitud de autenticación HTTP (Basic, Digest, NTLM…) de una página o de un proxy. */
export interface AuthRequestInfo {
  id: string;
  tabId: string;
  /** Origen real que pide las credenciales (o host:puerto del proxy). */
  origin: string;
  /** Texto que envía el sitio (realm). Lo controla el sitio: se muestra como tal. */
  realm: string;
  scheme: string;
  isProxy: boolean;
  /** Las credenciales viajarán cifradas (HTTPS). */
  secure: boolean;
}

export interface AuthCredentials {
  username: string;
  password: string;
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

/* ------------------------------- Actualizaciones ------------------------------- */

export type UpdateChannel = 'stable' | 'preview';

/**
 * Cómo se aplica una actualización en esta instalación:
 * - automatic: ICARUS la descarga, la verifica, la instala y se reinicia (instalador
 *   NSIS en Windows; sustitución de la app en macOS cuando su carpeta es escribible).
 * - manual-dmg / manual-portable: se descarga y verifica, pero el usuario la coloca
 *   (macOS sin permisos sobre la app, versión portátil de Windows).
 * - manual-release: solo se avisa y se abre la página de la versión (Linux).
 * - unsupported: compilación de desarrollo o sin clave para verificar actualizaciones.
 */
export type UpdateInstallMode = 'automatic' | 'manual-dmg' | 'manual-portable' | 'manual-release' | 'unsupported';

export type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'error';

export type UpdateErrorCode =
  | 'network'
  | 'rate-limited'
  | 'not-found'
  | 'signature'
  | 'invalid-manifest'
  | 'no-asset'
  | 'hash-mismatch'
  | 'size-mismatch'
  | 'interrupted'
  | 'disk-space'
  | 'write'
  | 'verification-failed'
  | 'install-failed';

export interface UpdateInfo {
  version: string;
  releasedAt: string;
  notes: string;
  /** Paquete que se descargará (null si en esta plataforma solo se avisa). */
  file: string | null;
  size: number | null;
  releasePage: string;
}

export interface UpdateState {
  currentVersion: string;
  channel: UpdateChannel;
  mode: UpdateInstallMode;
  /** Por qué no hay actualizaciones integradas (modo unsupported). */
  unsupportedReason: 'development' | 'no-key' | null;
  status: UpdateStatus;
  lastCheckedAt: string | null;
  available: UpdateInfo | null;
  progress: { received: number; total: number } | null;
  error: { code: UpdateErrorCode; detail: string | null } | null;
  /** Versión que el usuario pidió recordar más tarde (no se vuelve a avisar de ella). */
  postponedVersion: string | null;
  /** La instalación se hará al cerrar ICARUS. */
  installOnQuit: boolean;
  /** Ruta del paquete descargado cuando hay que colocarlo a mano. */
  manualFile: string | null;
  /** Actualización aplicada en este arranque (para confirmarla al usuario). */
  justUpdated: { from: string; to: string } | null;
  /** Versión cuya instalación falló (no se reintenta sola). */
  failedVersion: string | null;
  /**
   * macOS sin Developer ID: tras actualizar, el sistema pedirá permiso para que ICARUS
   * use su clave del llavero (la que cifra las cookies).
   */
  keychainNotice: boolean;
}

export type NativeEvent =
  | { type: 'tab-state'; state: WebTabState }
  | { type: 'open-in-new-tab'; url: string; background: boolean }
  | { type: 'search-in-new-tab'; text: string }
  | { type: 'shortcut'; action: ShortcutAction }
  | { type: 'navigation-blocked'; tabId: string; url: string; protocol: string }
  | { type: 'permission-request'; request: PermissionRequestInfo }
  | { type: 'permission-cancelled'; id: string }
  | { type: 'auth-request'; request: AuthRequestInfo }
  | { type: 'auth-cancelled'; id: string }
  | { type: 'find-result'; result: FindResult }
  | { type: 'downloads'; downloads: DownloadItemInfo[] }
  | { type: 'download-started'; id: string }
  | { type: 'history-changed' }
  | { type: 'shield'; state: ShieldState }
  | { type: 'update-state'; state: UpdateState }
  /** ICARUS va a reiniciarse para actualizarse: la interfaz guarda la sesión y lo confirma. */
  | { type: 'update-restart' };

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
    /**
     * Busca texto en la página; los resultados llegan como eventos `find-result`.
     * `next` continúa la búsqueda del mismo texto (siguiente o anterior coincidencia).
     */
    find(tabId: string, text: string, options: { forward: boolean; next: boolean }): void;
    stopFind(tabId: string): void;
    /** Zoom real de la página, por sitio y guardado; devuelve el porcentaje resultante. */
    zoom(tabId: string, action: ZoomAction): Promise<number>;
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
  auth: {
    /** Envía las credenciales, o null para cancelar. ICARUS no las guarda. */
    respond(id: string, credentials: AuthCredentials | null): void;
  };
  preferences: {
    get(): Promise<DesktopPreferences>;
    set(preferences: DesktopPreferences): Promise<DesktopPreferences>;
  };
  favicons: {
    get(pageUrl: string): Promise<string | null>;
  };
  updates: {
    getState(): Promise<UpdateState>;
    /** Busca ahora (también si el usuario había pospuesto la versión). */
    check(): Promise<UpdateState>;
    /** Descarga y verifica; con `install` instala y reinicia al terminar. */
    download(options: { install: boolean }): void;
    cancel(): void;
    install(when: 'now' | 'on-quit'): void;
    postpone(): void;
    setChannel(channel: UpdateChannel): void;
    /** Oculta la confirmación «ICARUS se ha actualizado». */
    acknowledge(): void;
    /** Vuelve a mostrar el paquete descargado (modos manuales). */
    reveal(): void;
    /** Respuesta a `update-restart`: la sesión ya está guardada. */
    readyToRestart(): void;
  };
  onEvent(listener: (event: NativeEvent) => void): () => void;
}
