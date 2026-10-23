/** Imágenes de fondo originales incluidas con ICARUS (SVG ligeros). */

import type { BackgroundPresetId } from '../../types/settings';
import aurora from './aurora.svg';
import dunes from './dunes.svg';
import horizon from './horizon.svg';
import nebula from './nebula.svg';

export const BACKGROUND_PRESETS: Record<BackgroundPresetId, string> = {
  horizon,
  aurora,
  nebula,
  dunes,
};
