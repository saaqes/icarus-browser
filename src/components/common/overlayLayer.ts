/**
 * Registro de capas flotantes abiertas (menús, diálogos, sugerencias…).
 *
 * En la aplicación de escritorio las páginas web son vistas nativas que se
 * dibujan por encima de la interfaz. Mientras haya una capa abierta, la vista se
 * sustituye por una captura de la página para que la capa quede visible.
 */

import { useEffect, useSyncExternalStore } from 'react';

let openLayers = 0;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function acquire(): () => void {
  openLayers += 1;
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openLayers -= 1;
    notify();
  };
}

/** Marca una capa flotante como abierta mientras `active` sea verdadero. */
export function useOverlayLayer(active: boolean): void {
  useEffect(() => (active ? acquire() : undefined), [active]);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useOverlayActive(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => openLayers > 0,
    () => false,
  );
}
