/** Nombre de la aplicación con el estilo actual (ICARUS Browser, ICARUS Esencial o ICARUS Panorama). */

import { useMessages } from '../i18n';
import { useAppearance } from './useAppearance';

export function useAppName(): string {
  const m = useMessages();
  return m.app.styleNames[useAppearance().themeId];
}
