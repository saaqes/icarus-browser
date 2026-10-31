/** Nombre de la aplicación (ICARUS Browser, ICARUS Esencial o ICARUS Panorama), según el icono elegido. */

import { useMessages } from '../i18n';
import { useAppearance } from './useAppearance';

export function useAppName(): string {
  const m = useMessages();
  return m.app.styleNames[useAppearance().appIcon];
}
