// @vitest-environment node
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sanitizeBranding, shortcutIcon, shortcutsToUpdate, STYLE_NAMES, windowsShortcutPaths, type ShortcutInfo } from './branding';

const EXE = join('/usuarios/ana/AppData/Local/Programs/icarus-browser', 'ICARUS Browser.exe');
const ICONS = join('/usuarios/ana/AppData/Local/Programs/icarus-browser', 'resources', 'icons');

describe('icono y nombre de la aplicación según el estilo', () => {
  it('nombres propios de ICARUS para cada estilo', () => {
    expect(STYLE_NAMES).toEqual({ icarus: 'ICARUS Browser', 'google-inspired': 'ICARUS Esencial', 'edge-inspired': 'ICARUS Panorama' });
    expect(Object.values(STYLE_NAMES).join(' ')).not.toMatch(/chrome|edge|google|microsoft/i);
  });

  it('el estilo guardado se valida', () => {
    expect(sanitizeBranding({ style: 'edge-inspired' })).toEqual({ style: 'edge-inspired' });
    expect(sanitizeBranding({ style: 'chrome' })).toEqual({ style: 'icarus' });
    expect(sanitizeBranding(null)).toEqual({ style: 'icarus' });
  });

  it('cada estilo usa su .ico; ICARUS vuelve al icono del ejecutable', () => {
    expect(shortcutIcon('edge-inspired', ICONS, EXE)).toEqual({ icon: join(ICONS, 'panorama.ico'), iconIndex: 0 });
    expect(shortcutIcon('google-inspired', ICONS, EXE)).toEqual({ icon: join(ICONS, 'esencial.ico'), iconIndex: 0 });
    expect(shortcutIcon('icarus', ICONS, EXE)).toEqual({ icon: EXE, iconIndex: 0 });
  });

  it('solo cambia los accesos directos de este ICARUS que aún no tienen el icono', () => {
    const [startMenu, desktop, pinned] = windowsShortcutPaths('/AppData/Roaming', '/Escritorio');
    expect(startMenu).toBe(join('/AppData/Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'ICARUS Browser.lnk'));
    const links: Record<string, ShortcutInfo | null> = {
      // El instalador no pone icono: se usa el del ejecutable.
      [startMenu!]: { target: EXE, icon: '' },
      // Ya tiene el de Panorama (otra mayúscula: Windows no distingue).
      [desktop!]: { target: EXE, icon: join(ICONS, 'PANORAMA.ico'), iconIndex: 0 },
      // No está anclado.
      [pinned!]: null,
      // Otro programa con el mismo nombre de acceso directo.
      '/otro.lnk': { target: '/Programas/otro/otro.exe', icon: '' },
    };
    const read = (path: string) => links[path] ?? null;
    const panorama = shortcutIcon('edge-inspired', ICONS, EXE);
    expect(shortcutsToUpdate([startMenu!, desktop!, pinned!, '/otro.lnk'], read, EXE, panorama)).toEqual([startMenu]);
    // Volver a ICARUS: el del escritorio recupera el icono del ejecutable; el del menú ya lo tiene.
    expect(shortcutsToUpdate([startMenu!, desktop!, pinned!, '/otro.lnk'], read, EXE, shortcutIcon('icarus', ICONS, EXE))).toEqual([desktop]);
  });
});
