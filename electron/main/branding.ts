/**
 * Icono y nombre de la aplicación según el estilo elegido. Son diseños propios de ICARUS
 * (el mismo logotipo con los colores de cada estilo, en build/icons): nunca los logotipos
 * ni los nombres de otros navegadores.
 *
 * - Ventana (Windows y Linux) y Dock (macOS): cambian al momento.
 * - Windows: además, los accesos directos que creó el instalador (menú Inicio, escritorio
 *   y el anclado en la barra de tareas), solo si abren este mismo ejecutable. Su nombre no
 *   cambia: el instalador y el desinstalador los buscan por «ICARUS Browser».
 * - El nombre visible lo pone la interfaz como título de la ventana; en macOS también el
 *   panel «Acerca de». El nombre del menú de macOS es el del paquete y no puede cambiarse.
 *
 * Este módulo no importa Electron: main.ts le pasa lo que necesita.
 */

import { join, resolve } from 'node:path';
import type { ThemeId } from '../../src/types/settings';

export const STYLE_ICON_FILES: Record<ThemeId, string> = { icarus: 'icarus', 'google-inspired': 'esencial', 'edge-inspired': 'panorama' };
export const STYLE_NAMES: Record<ThemeId, string> = { icarus: 'ICARUS Browser', 'google-inspired': 'ICARUS Esencial', 'edge-inspired': 'ICARUS Panorama' };
/** Los estilos (el tipo Record obliga a que estén todos). */
export const BRAND_STYLES = Object.keys(STYLE_ICON_FILES) as ThemeId[];
/** Nombre con el que el instalador crea los accesos directos (electron-builder.yml → shortcutName). */
export const SHORTCUT_FILE = 'ICARUS Browser.lnk';

export function sanitizeBranding(raw: unknown): { style: ThemeId } {
  const style = raw && typeof raw === 'object' ? (raw as { style?: unknown }).style : undefined;
  return { style: BRAND_STYLES.includes(style as ThemeId) ? (style as ThemeId) : 'icarus' };
}

/** Accesos directos por usuario que crea el instalador de Windows. */
export function windowsShortcutPaths(appData: string, desktop: string): string[] {
  return [
    join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', SHORTCUT_FILE),
    join(desktop, SHORTCUT_FILE),
    join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar', SHORTCUT_FILE),
  ];
}

export interface ShortcutInfo {
  target: string;
  icon?: string;
  iconIndex?: number;
}

export interface ShortcutIcon {
  icon: string;
  iconIndex: number;
}

const samePath = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();

/**
 * Icono que debe tener cada acceso directo: el del estilo o, para ICARUS, el del propio
 * ejecutable (el que puso el instalador).
 */
export function shortcutIcon(style: ThemeId, iconsDir: string, execPath: string): ShortcutIcon {
  return style === 'icarus' ? { icon: execPath, iconIndex: 0 } : { icon: join(iconsDir, `${STYLE_ICON_FILES[style]}.ico`), iconIndex: 0 };
}

/**
 * Accesos directos que hay que cambiar: los que existen, abren este ejecutable y aún no
 * tienen el icono deseado. Los de otros programas (u otra copia de ICARUS) no se tocan.
 */
export function shortcutsToUpdate(paths: string[], read: (path: string) => ShortcutInfo | null, execPath: string, wanted: ShortcutIcon): string[] {
  return paths.filter((path) => {
    const link = read(path);
    if (!link || !link.target || !samePath(link.target, execPath)) return false;
    const icon = link.icon || link.target;
    return !samePath(icon, wanted.icon) || (link.iconIndex ?? 0) !== wanted.iconIndex;
  });
}
