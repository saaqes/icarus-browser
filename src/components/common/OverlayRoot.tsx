import { createContext, useContext } from 'react';

/** Contenedor de capas flotantes dentro de la raíz temática (hereda variables CSS). */
export const OverlayRootContext = createContext<HTMLElement | null>(null);

export function useOverlayRoot(): HTMLElement | null {
  return useContext(OverlayRootContext);
}
