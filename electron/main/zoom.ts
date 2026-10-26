/**
 * Zoom de las páginas, como en Chrome y Edge: niveles fijos (25 %–500 %), por
 * sitio (host con puerto) y guardado en zoom.json para que se conserve al cerrar.
 *
 * Chromium ya aplica el zoom por origen a todas las pestañas del mismo sitio
 * durante la sesión; este almacén lo vuelve a aplicar al navegar tras reiniciar.
 */

import { isRecord } from './validate';
import { JsonFile } from './jsonFile';

/** Niveles de Chrome y Edge (factor). */
export const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5] as const;
export type ZoomAction = 'in' | 'out' | 'reset';
export const ZOOM_ACTIONS: readonly ZoomAction[] = ['in', 'out', 'reset'];

/** Siguiente nivel desde el factor actual (que puede no ser uno de la lista, p. ej. tras un gesto). */
export function nextZoom(current: number, action: ZoomAction): number {
  if (action === 'reset') return 1;
  const epsilon = 0.001;
  if (action === 'in') return ZOOM_LEVELS.find((level) => level > current + epsilon) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!;
  return [...ZOOM_LEVELS].reverse().find((level) => level < current - epsilon) ?? ZOOM_LEVELS[0]!;
}

/** Sitio al que pertenece el zoom: host con puerto de una página http(s). */
export function zoomSite(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.host.toLowerCase() : null;
  } catch {
    return null;
  }
}

type ZoomData = Record<string, number>;

const MAX_SITES = 2000;

export function sanitizeZoom(raw: unknown): ZoomData {
  const result: ZoomData = {};
  if (!isRecord(raw)) return result;
  for (const [site, value] of Object.entries(raw).slice(0, MAX_SITES)) {
    if (typeof value === 'number' && (ZOOM_LEVELS as readonly number[]).includes(value) && value !== 1 && site.length <= 260) result[site] = value;
  }
  return result;
}

export class ZoomStore {
  private readonly file: JsonFile<ZoomData>;

  constructor(path: string) {
    this.file = new JsonFile(path, { version: 1, defaults: () => ({}), sanitize: sanitizeZoom, delayMs: 300 });
  }

  /** Factor guardado para la página (1 si no hay ninguno). */
  get(url: string): number {
    const site = zoomSite(url);
    return (site && this.file.get()[site]) || 1;
  }

  /** Guarda el factor del sitio; el 100 % no se guarda. */
  set(url: string, factor: number): void {
    const site = zoomSite(url);
    if (!site) return;
    const data = { ...this.file.get() };
    if (factor === 1) delete data[site];
    else data[site] = factor;
    this.file.set(data);
  }

  flush(): void {
    this.file.flush();
  }
}
