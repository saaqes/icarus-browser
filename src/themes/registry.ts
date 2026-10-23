/**
 * Registro de estilos. Para añadir uno: crear su carpeta con `HomeLayout` y CSS,
 * añadir su id a THEME_IDS (types/settings.ts), su configuración inicial en
 * themeDefaults.ts, su acento en accents.ts y registrarlo aquí.
 */

import type { ThemeId } from '../types/settings';
import { PanoramaHome } from './edge-inspired/PanoramaHome';
import { EssentialHome } from './google-inspired/EssentialHome';
import { IcarusHome } from './icarus/IcarusHome';
import type { ThemeDefinition } from './types';
import './google-inspired/theme.css';
import './edge-inspired/theme.css';
import './icarus/theme.css';

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  'google-inspired': { id: 'google-inspired', HomeLayout: EssentialHome },
  'edge-inspired': { id: 'edge-inspired', HomeLayout: PanoramaHome },
  icarus: { id: 'icarus', HomeLayout: IcarusHome },
};
