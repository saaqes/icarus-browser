/**
 * Contrato entre la interfaz de ICARUS y un motor de navegación.
 *
 * Fase actual: `ExternalBrowserEngine` entrega cada URL al navegador del sistema.
 * Fases futuras: un motor integrado (CEF/Chromium en Windows, WebView en Android,
 * WKWebView en iOS) implementará este mismo contrato, añadiendo `capabilities`
 * y los métodos opcionales. La interfaz consulta `capabilities` para decidir si
 * delega el historial y la recarga en el motor o los gestiona ella misma.
 * Ver docs/ENGINE_INTEGRATION.md.
 */

export interface EngineCapabilities {
  /** El motor dibuja las páginas dentro de la ventana de ICARUS. */
  embeddedRendering: boolean;
  /** Cada pestaña tiene cookies, almacenamiento y proceso propios. */
  isolatedTabSessions: boolean;
  /** El motor gestiona atrás/adelante/recargar de forma nativa. */
  nativeHistory: boolean;
  /** El motor informa de título, URL, icono y estado de carga reales. */
  pageEvents: boolean;
}

export interface EngineInfo {
  id: string;
  name: string;
  kind: 'external' | 'embedded';
  capabilities: EngineCapabilities;
}

export interface NavigationRequest {
  tabId: string;
  url: string;
  /**
   * Empieza un tramo nuevo de navegación (desde una página interna): el motor
   * descarta el historial anterior de la vista de esa pestaña.
   */
  newSegment?: boolean;
}

export type NavigationOutcome =
  | { status: 'opened-externally'; url: string }
  | { status: 'rendered'; url: string }
  | { status: 'rejected'; reason: 'unsafe-url' | 'blocked-protocol' | 'invalid-tab' }
  | { status: 'failed'; reason: 'open-error' };

/** Eventos que emitirá un motor integrado (no los emite el motor externo). */
export type EngineEvent =
  | { type: 'url-changed'; tabId: string; url: string }
  | { type: 'title-changed'; tabId: string; title: string }
  | { type: 'favicon-changed'; tabId: string; faviconUrl: string | null }
  | { type: 'loading-changed'; tabId: string; loading: boolean };

export interface BrowserEngine {
  readonly info: EngineInfo;
  /**
   * Navega o entrega la URL. Debe iniciar la apertura de forma síncrona dentro de
   * la llamada (los navegadores solo permiten ventanas nuevas durante un gesto
   * del usuario) y devolver el resultado como promesa.
   */
  navigate(request: NavigationRequest): Promise<NavigationOutcome>;
  /* Métodos para motores integrados. */
  /** Libera la vista y el proceso de la pestaña. */
  detachTab?(tabId: string): void;
  goBack?(tabId: string): void;
  goForward?(tabId: string): void;
  reload?(tabId: string): void;
  stop?(tabId: string): void;
  subscribe?(listener: (event: EngineEvent) => void): () => void;
}
