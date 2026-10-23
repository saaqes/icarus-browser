import { describe, expect, it } from 'vitest';
import {
  createDefaultSettings,
  resetBackground,
  resetThemeConfig,
  setTheme,
  updateGeneral,
  updateLayout,
  updateThemeConfig,
} from '../../services/settings/settings';
import { createBackup, parseBackup } from '../../services/backup/backup';
import { createDefaultShortcuts } from '../../services/shortcuts/shortcuts';
import { createDefaultAliasRules } from '../../services/alias-rules';

describe('operaciones de preferencias', () => {
  it('cambiar de estilo solo modifica el estilo activo', () => {
    let settings = createDefaultSettings();
    settings = updateGeneral(settings, { searchProvider: 'bing' });
    settings = updateThemeConfig(settings, 'icarus', { accent: 'teal' });
    const switched = setTheme(settings, 'google-inspired');
    expect(switched.appearance.theme).toBe('google-inspired');
    expect(switched.general).toBe(settings.general);
    expect(switched.navigation).toBe(settings.navigation);
    expect(switched.appearance.themes).toBe(settings.appearance.themes);
    expect(setTheme(switched, 'icarus').appearance.themes.icarus.accent).toBe('teal');
  });

  it('cada estilo tiene configuración inicial propia', () => {
    const { themes } = createDefaultSettings().appearance;
    expect(themes['google-inspired'].colorMode).toBe('light');
    expect(themes.icarus.colorMode).toBe('dark');
    expect(themes['edge-inspired'].background).toEqual({ kind: 'preset', presetId: 'horizon' });
    expect(themes['google-inspired'].layout.shortcutStyle).not.toBe(themes.icarus.layout.shortcutStyle);
  });

  it('restaura la distribución y el fondo solo del estilo indicado', () => {
    let settings = createDefaultSettings();
    settings = updateLayout(settings, 'edge-inspired', { showWidgets: false, shortcutColumns: 4 });
    settings = updateLayout(settings, 'icarus', { density: 'compact' });
    settings = updateThemeConfig(settings, 'edge-inspired', { background: { kind: 'color', color: '#112233' } });

    const bgReset = resetBackground(settings, 'edge-inspired');
    expect(bgReset.appearance.themes['edge-inspired'].background).toEqual({ kind: 'preset', presetId: 'horizon' });
    expect(bgReset.appearance.themes['edge-inspired'].layout.shortcutColumns).toBe(4);

    const reset = resetThemeConfig(settings, 'edge-inspired');
    expect(reset.appearance.themes['edge-inspired']).toEqual(createDefaultSettings().appearance.themes['edge-inspired']);
    expect(reset.appearance.themes.icarus.layout.density).toBe('compact');
  });
});

describe('copia de seguridad', () => {
  it('exporta e importa toda la configuración', () => {
    const settings = updateGeneral(createDefaultSettings(), { searchProvider: 'duckduckgo' });
    const text = createBackup(
      { settings, shortcuts: createDefaultShortcuts(), aliasRules: createDefaultAliasRules(), widgets: { notes: 'hola', tasks: [] } },
      '0.1.0',
    );
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.settings.general.searchProvider).toBe('duckduckgo');
    expect(parsed.data.widgets.notes).toBe('hola');
    expect(parsed.data.aliasRules).toHaveLength(2);
  });

  it('rechaza archivos ajenos o de versiones futuras', () => {
    expect(parseBackup('x')).toEqual({ ok: false, error: 'invalid-json' });
    expect(parseBackup('{"format":"icarus-backup","version":99,"data":{}}')).toEqual({ ok: false, error: 'newer-version' });
    expect(parseBackup('{"format":"otro","data":{}}')).toEqual({ ok: false, error: 'invalid-format' });
  });
});
