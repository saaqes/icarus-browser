/**
 * Modelo de pestañas del prototipo.
 *
 * Cada pestaña guarda su propio historial de páginas de ICARUS. Mientras no exista
 * un motor integrado, las páginas web se abren en el navegador del sistema y la
 * pestaña muestra una página interna que lo indica. Cuando se integre un motor,
 * cada `Tab.id` se asociará a una instancia de navegación (ver services/navigation).
 */

export const SETTINGS_SECTIONS = ['general', 'appearance', 'navigation', 'advanced', 'about'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export type PageEntry =
  | { kind: 'newtab' }
  | { kind: 'blank' }
  | { kind: 'settings'; section: SettingsSection }
  /**
   * Página web. `openedExternally` indica si ya se entregó al navegador del sistema
   * (false cuando la apertura requiere confirmación o falló).
   */
  | { kind: 'external'; url: string; openedExternally: boolean };

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
