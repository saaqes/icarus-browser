/** Paleta de acentos. Cada color tiene una variante para modo claro y otra para oscuro. */

import type { AccentId, ResolvedColorMode, ThemeId } from '../types/settings';

export interface AccentPair {
  light: string;
  dark: string;
}

export const ACCENT_COLORS: Record<Exclude<AccentId, 'default'>, AccentPair> = {
  violet: { light: '#7c3aed', dark: '#a78bfa' },
  indigo: { light: '#4f46e5', dark: '#8b8ff8' },
  blue: { light: '#1d64d8', dark: '#7fb0ff' },
  teal: { light: '#0f7a80', dark: '#5fcfcf' },
  green: { light: '#1f7a43', dark: '#6fd195' },
  amber: { light: '#b45309', dark: '#f3b552' },
  rose: { light: '#c0265a', dark: '#f590b5' },
  graphite: { light: '#3f4452', dark: '#c4c8d2' },
};

/** Acento propio de cada estilo cuando el usuario elige «Del estilo». */
export const THEME_ACCENTS: Record<ThemeId, AccentPair> = {
  'google-inspired': { light: '#1f63d1', dark: '#86aef5' },
  'edge-inspired': { light: '#0b63c4', dark: '#6cb4f0' },
  icarus: { light: '#6d28d9', dark: '#a78bfa' },
};

export function resolveAccent(themeId: ThemeId, accent: AccentId, mode: ResolvedColorMode): string {
  const pair = accent === 'default' ? THEME_ACCENTS[themeId] : ACCENT_COLORS[accent];
  return pair[mode];
}
