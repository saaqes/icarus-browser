/**
 * Modelo de pestañas.
 *
 * Cada pestaña guarda su historial de páginas de ICARUS (páginas internas y
 * tramos de navegación web). En la aplicación de escritorio cada pestaña tiene
 * una vista de Chromium real cuyo historial interno gestiona el motor; en la
 * versión web las páginas se entregan al navegador del sistema.
 */

export const SETTINGS_SECTIONS = ['general', 'appearance', 'navigation', 'privacy', 'shield', 'downloads', 'advanced', 'updates', 'about'] as const;
/** Secciones que solo existen en la aplicación de escritorio. */
export const DESKTOP_ONLY_SECTIONS: readonly SettingsSection[] = ['privacy', 'shield', 'downloads', 'updates'];
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export type PageEntry =
  | { kind: 'newtab' }
  | { kind: 'blank' }
  | { kind: 'settings'; section: SettingsSection }
  | { kind: 'history' }
  | { kind: 'bookmarks' }
  | { kind: 'downloads' }
  /**
   * Página web. `url` y `title` son los reales que informa el motor.
   * `openedExternally` solo se usa con el motor externo (versión web): indica
   * si ya se entregó al navegador del sistema.
   */
  | { kind: 'web'; url: string; title?: string; openedExternally: boolean };

export interface HistoryEntry {
  id: string;
  page: PageEntry;
  createdAt: number;
}

export interface Tab {
  id: string;
  entries: HistoryEntry[];
  index: number;
  loading: boolean;
  /** Se incrementa al recargar para volver a montar el contenido interno. */
  reloadToken: number;
}

export interface SessionState {
  tabs: Tab[];
  activeTabId: string;
}
