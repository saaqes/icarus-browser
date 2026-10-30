/**
 * Preferencias de ICARUS: valores predeterminados, saneamiento y operaciones puras.
 *
 * Regla importante: cambiar de estilo solo modifica `appearance.theme`. Cada estilo
 * conserva su propia configuración y el resto de preferencias no se toca.
 */

import { createDefaultThemeConfig } from '../../themes/themeDefaults';
import {
  ACCENT_IDS,
  BACKGROUND_PRESET_IDS,
  COLOR_MODES,
  DENSITIES,
  EXTERNAL_OPENING_MODES,
  LANGUAGE_CODES,
  NEW_TAB_PAGES,
  PROFILE_COLORS,
  PROFILE_NAME_MAX,
  SEARCH_POSITIONS,
  SEARCH_PROVIDER_IDS,
  SHORTCUT_COLUMNS,
  SHORTCUT_OPEN_TARGETS,
  SHORTCUT_STYLES,
  STARTUP_BEHAVIORS,
  THEME_IDS,
  WIDGET_IDS,
  WIDGET_PLACEMENTS,
  type AppearanceSettings,
  type BackgroundSetting,
  type GeneralSettings,
  type HomeLayout,
  type HomePageSetting,
  type ProfileSettings,
  type NavigationSettings,
  type Settings,
  type ThemeConfig,
  type ThemeId,
  type WidgetId,
} from '../../types/settings';
import type { DocumentSchema } from '../persistence/document';
import { STORAGE_KEYS } from '../persistence/keys';
import { HEX_COLOR, isRecord, readBoolean, readEnum, readRecord } from '../persistence/validation';
import { normalizeUserUrl } from '../url-resolution/urlUtils';

export function createDefaultWidgets(): Record<WidgetId, boolean> {
  return { clock: true, calendar: true, notes: true, tasks: true, sources: false };
}

export function createDefaultSettings(): Settings {
  return {
    general: {
      searchProvider: 'google',
      language: 'es',
      startup: 'new-tab',
      homePage: { kind: 'new-tab' },
      showHomeButton: true,
    },
    appearance: {
      theme: 'icarus',
      themes: {
        'google-inspired': createDefaultThemeConfig('google-inspired'),
        'edge-inspired': createDefaultThemeConfig('edge-inspired'),
        icarus: createDefaultThemeConfig('icarus'),
      },
      widgets: createDefaultWidgets(),
      reduceMotion: false,
    },
    navigation: {
      newTabPage: 'home',
      // Las compilaciones para entornos que bloquean ventanas emergentes usan «confirm».
      externalOpening: import.meta.env.VITE_ICARUS_EXTERNAL_OPENING === 'confirm' ? 'confirm' : 'automatic',
      shortcutOpenTarget: 'current-tab',
      loadFavicons: true,
      showFullUrls: false,
    },
    profile: { name: '', photo: null, color: PROFILE_COLORS[0] },
  };
}

/* ---------------------------------- Perfil ---------------------------------- */

/** Tamaño máximo de la foto guardada (ya reducida a 128×128 suele ocupar menos de 20 KB). */
export const PROFILE_PHOTO_MAX_LENGTH = 200_000;

/** ¿Es una foto de perfil válida? Solo imágenes rasterizadas en base64, sin SVG ni direcciones remotas. */
export function isValidProfilePhoto(value: unknown): value is string {
  return typeof value === 'string' && value.length <= PROFILE_PHOTO_MAX_LENGTH && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/** Inicial del perfil (o null si no tiene nombre: se muestra la silueta). */
export function profileInitial(profile: ProfileSettings): string | null {
  const first = [...profile.name.trim()][0];
  return first ? first.toLocaleUpperCase('es') : null;
}

function sanitizeProfile(raw: unknown, fallback: ProfileSettings, issues: string[]): ProfileSettings {
  const value = readRecord(raw, 'profile', issues);
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, PROFILE_NAME_MAX) : fallback.name;
  if (value.name !== undefined && typeof value.name !== 'string') issues.push('profile.name');
  let photo: string | null = null;
  if (value.photo !== undefined && value.photo !== null) {
    if (isValidProfilePhoto(value.photo)) photo = value.photo;
    else issues.push('profile.photo');
  }
  return { name, photo, color: readEnum(value.color, PROFILE_COLORS, fallback.color, 'profile.color', issues) };
}

/* -------------------------------- Saneamiento -------------------------------- */

function sanitizeBackground(raw: unknown, fallback: BackgroundSetting, path: string, issues: string[]): BackgroundSetting {
  if (!isRecord(raw)) {
    issues.push(path);
    return fallback;
  }
  switch (raw.kind) {
    case 'theme':
      return { kind: 'theme' };
    case 'upload':
      return { kind: 'upload' };
    case 'color':
      if (typeof raw.color === 'string' && HEX_COLOR.test(raw.color)) return { kind: 'color', color: raw.color.toLowerCase() };
      break;
    case 'preset':
      if ((BACKGROUND_PRESET_IDS as readonly unknown[]).includes(raw.presetId)) {
        return { kind: 'preset', presetId: raw.presetId as (typeof BACKGROUND_PRESET_IDS)[number] };
      }
      break;
  }
  issues.push(path);
  return fallback;
}

function sanitizeLayout(raw: unknown, fallback: HomeLayout, path: string, issues: string[]): HomeLayout {
  const value = readRecord(raw, path, issues);
  return {
    searchPosition: readEnum(value.searchPosition, SEARCH_POSITIONS, fallback.searchPosition, `${path}.searchPosition`, issues),
    shortcutStyle: readEnum(value.shortcutStyle, SHORTCUT_STYLES, fallback.shortcutStyle, `${path}.shortcutStyle`, issues),
    shortcutColumns: readEnum(value.shortcutColumns, SHORTCUT_COLUMNS, fallback.shortcutColumns, `${path}.shortcutColumns`, issues),
    density: readEnum(value.density, DENSITIES, fallback.density, `${path}.density`, issues),
    widgetPlacement: readEnum(value.widgetPlacement, WIDGET_PLACEMENTS, fallback.widgetPlacement, `${path}.widgetPlacement`, issues),
    showShortcuts: readBoolean(value.showShortcuts, fallback.showShortcuts, `${path}.showShortcuts`, issues),
    showWidgets: readBoolean(value.showWidgets, fallback.showWidgets, `${path}.showWidgets`, issues),
  };
}

function sanitizeThemeConfig(raw: unknown, themeId: ThemeId, path: string, issues: string[]): ThemeConfig {
  const fallback = createDefaultThemeConfig(themeId);
  const value = readRecord(raw, path, issues);
  return {
    colorMode: readEnum(value.colorMode, COLOR_MODES, fallback.colorMode, `${path}.colorMode`, issues),
    accent: readEnum(value.accent, ACCENT_IDS, fallback.accent, `${path}.accent`, issues),
    background: sanitizeBackground(value.background, fallback.background, `${path}.background`, issues),
    layout: sanitizeLayout(value.layout, fallback.layout, `${path}.layout`, issues),
  };
}

function sanitizeHomePage(raw: unknown, issues: string[]): HomePageSetting {
  if (isRecord(raw) && raw.kind === 'new-tab') return { kind: 'new-tab' };
  if (isRecord(raw) && raw.kind === 'url' && typeof raw.url === 'string') {
    const result = normalizeUserUrl(raw.url);
    if (result.ok) return { kind: 'url', url: result.url };
  }
  issues.push('general.homePage');
  return { kind: 'new-tab' };
}

export function sanitizeSettings(raw: unknown, issues: string[]): Settings {
  const defaults = createDefaultSettings();
  const root = readRecord(raw, 'settings', issues);

  const generalRaw = readRecord(root.general, 'general', issues);
  const general: GeneralSettings = {
    searchProvider: readEnum(generalRaw.searchProvider, SEARCH_PROVIDER_IDS, defaults.general.searchProvider, 'general.searchProvider', issues),
    language: readEnum(generalRaw.language, LANGUAGE_CODES, defaults.general.language, 'general.language', issues),
    startup: readEnum(generalRaw.startup, STARTUP_BEHAVIORS, defaults.general.startup, 'general.startup', issues),
    homePage: sanitizeHomePage(generalRaw.homePage, issues),
    showHomeButton: readBoolean(generalRaw.showHomeButton, defaults.general.showHomeButton, 'general.showHomeButton', issues),
  };

  const appearanceRaw = readRecord(root.appearance, 'appearance', issues);
  const themesRaw = readRecord(appearanceRaw.themes, 'appearance.themes', issues);
  const widgetsRaw = readRecord(appearanceRaw.widgets, 'appearance.widgets', issues);
  const appearance: AppearanceSettings = {
    theme: readEnum(appearanceRaw.theme, THEME_IDS, defaults.appearance.theme, 'appearance.theme', issues),
    themes: Object.fromEntries(
      THEME_IDS.map((id) => [id, sanitizeThemeConfig(themesRaw[id], id, `appearance.themes.${id}`, issues)]),
    ) as Record<ThemeId, ThemeConfig>,
    widgets: Object.fromEntries(
      WIDGET_IDS.map((id) => [id, readBoolean(widgetsRaw[id], defaults.appearance.widgets[id], `appearance.widgets.${id}`, issues)]),
    ) as Record<WidgetId, boolean>,
    reduceMotion: readBoolean(appearanceRaw.reduceMotion, defaults.appearance.reduceMotion, 'appearance.reduceMotion', issues),
  };

  const navigationRaw = readRecord(root.navigation, 'navigation', issues);
  const navigation: NavigationSettings = {
    newTabPage: readEnum(navigationRaw.newTabPage, NEW_TAB_PAGES, defaults.navigation.newTabPage, 'navigation.newTabPage', issues),
    externalOpening: readEnum(navigationRaw.externalOpening, EXTERNAL_OPENING_MODES, defaults.navigation.externalOpening, 'navigation.externalOpening', issues),
    shortcutOpenTarget: readEnum(navigationRaw.shortcutOpenTarget, SHORTCUT_OPEN_TARGETS, defaults.navigation.shortcutOpenTarget, 'navigation.shortcutOpenTarget', issues),
    loadFavicons: readBoolean(navigationRaw.loadFavicons, defaults.navigation.loadFavicons, 'navigation.loadFavicons', issues),
    showFullUrls: readBoolean(navigationRaw.showFullUrls, defaults.navigation.showFullUrls, 'navigation.showFullUrls', issues),
  };

  return { general, appearance, navigation, profile: sanitizeProfile(root.profile, defaults.profile, issues) };
}

export const settingsSchema: DocumentSchema<Settings> = {
  key: STORAGE_KEYS.settings,
  version: 1,
  defaults: createDefaultSettings,
  sanitize: sanitizeSettings,
};

/* ------------------------------- Operaciones -------------------------------- */

export function setTheme(settings: Settings, theme: ThemeId): Settings {
  if (settings.appearance.theme === theme) return settings;
  return { ...settings, appearance: { ...settings.appearance, theme } };
}

export function updateThemeConfig(settings: Settings, themeId: ThemeId, patch: Partial<ThemeConfig>): Settings {
  const current = settings.appearance.themes[themeId];
  return {
    ...settings,
    appearance: {
      ...settings.appearance,
      themes: { ...settings.appearance.themes, [themeId]: { ...current, ...patch } },
    },
  };
}

export function updateLayout(settings: Settings, themeId: ThemeId, patch: Partial<HomeLayout>): Settings {
  const current = settings.appearance.themes[themeId];
  return updateThemeConfig(settings, themeId, { layout: { ...current.layout, ...patch } });
}

/** Restaura solo la configuración del estilo indicado. */
export function resetThemeConfig(settings: Settings, themeId: ThemeId): Settings {
  return updateThemeConfig(settings, themeId, createDefaultThemeConfig(themeId));
}

export function resetBackground(settings: Settings, themeId: ThemeId): Settings {
  return updateThemeConfig(settings, themeId, { background: createDefaultThemeConfig(themeId).background });
}

export function setWidgetEnabled(settings: Settings, widgetId: WidgetId, enabled: boolean): Settings {
  return {
    ...settings,
    appearance: { ...settings.appearance, widgets: { ...settings.appearance.widgets, [widgetId]: enabled } },
  };
}

export function updateGeneral(settings: Settings, patch: Partial<GeneralSettings>): Settings {
  return { ...settings, general: { ...settings.general, ...patch } };
}

export function updateAppearance(settings: Settings, patch: Partial<Pick<AppearanceSettings, 'reduceMotion'>>): Settings {
  return { ...settings, appearance: { ...settings.appearance, ...patch } };
}

export function updateNavigation(settings: Settings, patch: Partial<NavigationSettings>): Settings {
  return { ...settings, navigation: { ...settings.navigation, ...patch } };
}

export function updateProfile(settings: Settings, patch: Partial<ProfileSettings>): Settings {
  const next = { ...settings.profile, ...patch };
  return {
    ...settings,
    profile: { ...next, name: next.name.slice(0, PROFILE_NAME_MAX), photo: isValidProfilePhoto(next.photo) ? next.photo : null },
  };
}

