import { useSyncExternalStore } from 'react';
import type { ResolvedColorMode } from '../types/settings';

const QUERY = '(prefers-color-scheme: dark)';

function getMediaQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
}

function subscribe(callback: () => void): () => void {
  const media = getMediaQuery();
  if (!media) return () => {};
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', callback);
    return () => media.removeEventListener('change', callback);
  }
  media.addListener(callback);
  return () => media.removeListener(callback);
}

/** Modo de color del sistema operativo, o null si el entorno no lo informa. */
export function useSystemColorScheme(): { mode: ResolvedColorMode; supported: boolean } {
  const dark = useSyncExternalStore(
    subscribe,
    () => getMediaQuery()?.matches ?? null,
    () => null,
  );
  return { mode: dark ? 'dark' : 'light', supported: dark !== null && getMediaQuery() !== null };
}
