/**
 * Configuración inicial de cada estilo (datos puros, sin React).
 * Cada estilo arranca con su propio modo de color, fondo y distribución.
 */

import type { ThemeConfig, ThemeId } from '../types/settings';

const DEFAULT_THEME_CONFIGS: Record<ThemeId, ThemeConfig> = {
  'google-inspired': {
    colorMode: 'light',
    accent: 'default',
    background: { kind: 'theme' },
    layout: {
      searchPosition: 'center',
      shortcutStyle: 'circle',
      shortcutColumns: 5,
      density: 'comfortable',
      widgetPlacement: 'below',
      showShortcuts: true,
      showWidgets: false,
    },
  },
  'edge-inspired': {
    colorMode: 'system',
    accent: 'default',
    background: { kind: 'preset', presetId: 'horizon' },
    layout: {
      searchPosition: 'top',
      shortcutStyle: 'tile',
      shortcutColumns: 8,
      density: 'comfortable',
      widgetPlacement: 'below',
      showShortcuts: true,
      showWidgets: true,
    },
  },
  icarus: {
    colorMode: 'dark',
    accent: 'default',
    background: { kind: 'theme' },
    layout: {
      searchPosition: 'center',
      shortcutStyle: 'dock',
      shortcutColumns: 6,
      density: 'comfortable',
      widgetPlacement: 'side',
      showShortcuts: true,
      showWidgets: true,
    },
  },
};

export function createDefaultThemeConfig(themeId: ThemeId): ThemeConfig {
  return structuredClone(DEFAULT_THEME_CONFIGS[themeId]);
}
