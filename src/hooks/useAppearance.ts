/** Resuelve la apariencia efectiva: estilo, modo (incluido «Automático»), acento y fondo. */

import { useMemo } from 'react';
import { resolveAccent } from '../themes/accents';
import { BACKGROUND_PRESETS } from '../themes/backgrounds';
import { toneForColor } from '../themes/color';
import type { ResolvedColorMode, ThemeConfig, ThemeId } from '../types/settings';
import { useBackgroundImage, useSettings } from './useStores';
import { useSystemColorScheme } from './useSystemColorScheme';

export type ResolvedBackground =
  | { kind: 'theme' }
  | { kind: 'color'; color: string; tone: 'light' | 'dark' }
  | { kind: 'image'; url: string };

export interface ResolvedAppearance {
  themeId: ThemeId;
  config: ThemeConfig;
  mode: ResolvedColorMode;
  systemMode: ResolvedColorMode;
  systemSupported: boolean;
  accent: string;
  accentContrast: string;
  background: ResolvedBackground;
  reduceMotion: boolean;
}

export function useAppearance(): ResolvedAppearance {
  const [settings] = useSettings();
  const [uploaded] = useBackgroundImage();
  const system = useSystemColorScheme();
  const { theme: themeId, themes, reduceMotion } = settings.appearance;
  const config = themes[themeId];

  return useMemo(() => {
    const mode: ResolvedColorMode = config.colorMode === 'system' ? system.mode : config.colorMode;
    let background: ResolvedBackground = { kind: 'theme' };
    const setting = config.background;
    if (setting.kind === 'color') background = { kind: 'color', color: setting.color, tone: toneForColor(setting.color) };
    else if (setting.kind === 'preset') background = { kind: 'image', url: BACKGROUND_PRESETS[setting.presetId] };
    else if (setting.kind === 'upload' && uploaded) background = { kind: 'image', url: uploaded.dataUrl };
    return {
      themeId,
      config,
      mode,
      systemMode: system.mode,
      systemSupported: system.supported,
      accent: resolveAccent(themeId, config.accent, mode),
      accentContrast: mode === 'dark' ? '#15121d' : '#ffffff',
      background,
      reduceMotion,
    };
  }, [config, reduceMotion, system.mode, system.supported, themeId, uploaded]);
}
