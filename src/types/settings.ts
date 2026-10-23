/**
 * Esquema tipado de las preferencias de ICARUS.
 *
 * Las listas `as const` se usan tanto para los tipos como para validar los
 * datos leídos del almacenamiento (ver services/settings/sanitize.ts).
 */

export const THEME_IDS = ['google-inspired', 'edge-inspired', 'icarus'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const COLOR_MODES = ['light', 'dark', 'system'] as const;
export type ColorMode = (typeof COLOR_MODES)[number];
export type ResolvedColorMode = Exclude<ColorMode, 'system'>;

export const ACCENT_IDS = ['default', 'violet', 'indigo', 'blue', 'teal', 'green', 'amber', 'rose', 'graphite'] as const;
export type AccentId = (typeof ACCENT_IDS)[number];

export const BACKGROUND_PRESET_IDS = ['horizon', 'aurora', 'nebula', 'dunes'] as const;
export type BackgroundPresetId = (typeof BACKGROUND_PRESET_IDS)[number];

/**
 * Fondo de la página de inicio.
 * - `theme`: fondo propio del estilo (sin imagen).
 * - `color`: color sólido (#rrggbb).
 * - `preset`: imagen incluida con ICARUS.
 * - `upload`: imagen elegida por el usuario (guardada aparte, ver services/background).
 */
export type BackgroundSetting =
  | { kind: 'theme' }
  | { kind: 'color'; color: string }
  | { kind: 'preset'; presetId: BackgroundPresetId }
  | { kind: 'upload' };

export const SEARCH_POSITIONS = ['center', 'top'] as const;
export type SearchPosition = (typeof SEARCH_POSITIONS)[number];

export const SHORTCUT_STYLES = ['circle', 'tile', 'dock'] as const;
export type ShortcutStyle = (typeof SHORTCUT_STYLES)[number];

export const SHORTCUT_COLUMNS = [4, 5, 6, 8] as const;
export type ShortcutColumns = (typeof SHORTCUT_COLUMNS)[number];

export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

export const WIDGET_PLACEMENTS = ['below', 'side'] as const;
export type WidgetPlacement = (typeof WIDGET_PLACEMENTS)[number];

/** Distribución de la página de inicio. Cada estilo guarda la suya. */
export interface HomeLayout {
  searchPosition: SearchPosition;
  shortcutStyle: ShortcutStyle;
  shortcutColumns: ShortcutColumns;
  density: Density;
  widgetPlacement: WidgetPlacement;
  showShortcuts: boolean;
  showWidgets: boolean;
}

/** Configuración de apariencia propia de un estilo. Cambiar de estilo no la borra. */
export interface ThemeConfig {
  colorMode: ColorMode;
  accent: AccentId;
  background: BackgroundSetting;
  layout: HomeLayout;
}

export const WIDGET_IDS = ['clock', 'calendar', 'notes', 'tasks', 'sources'] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

export const SEARCH_PROVIDER_IDS = ['google', 'bing', 'duckduckgo'] as const;
export type SearchProviderId = (typeof SEARCH_PROVIDER_IDS)[number];

export const LANGUAGE_CODES = ['es'] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];

export const STARTUP_BEHAVIORS = ['new-tab', 'restore-session'] as const;
export type StartupBehavior = (typeof STARTUP_BEHAVIORS)[number];

export type HomePageSetting = { kind: 'new-tab' } | { kind: 'url'; url: string };

export const NEW_TAB_PAGES = ['home', 'blank'] as const;
export type NewTabPage = (typeof NEW_TAB_PAGES)[number];

export const EXTERNAL_OPENING_MODES = ['automatic', 'confirm'] as const;
export type ExternalOpeningMode = (typeof EXTERNAL_OPENING_MODES)[number];

export const SHORTCUT_OPEN_TARGETS = ['current-tab', 'new-tab'] as const;
export type ShortcutOpenTarget = (typeof SHORTCUT_OPEN_TARGETS)[number];

export interface GeneralSettings {
  searchProvider: SearchProviderId;
  language: LanguageCode;
  startup: StartupBehavior;
  homePage: HomePageSetting;
  showHomeButton: boolean;
}

export interface AppearanceSettings {
  theme: ThemeId;
  themes: Record<ThemeId, ThemeConfig>;
  widgets: Record<WidgetId, boolean>;
  reduceMotion: boolean;
}

export interface NavigationSettings {
  newTabPage: NewTabPage;
  externalOpening: ExternalOpeningMode;
  shortcutOpenTarget: ShortcutOpenTarget;
  loadFavicons: boolean;
}

export interface AdvancedSettings {
  /** Aplica las reglas de alias en la barra de direcciones, pestañas y páginas internas. */
  showAliases: boolean;
}

export interface Settings {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  navigation: NavigationSettings;
  advanced: AdvancedSettings;
}
