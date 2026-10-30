import { describe, expect, it } from 'vitest';
import {
  createDefaultSettings,
  resetBackground,
  resetThemeConfig,
  sanitizeSettings,
  setTheme,
  updateGeneral,
  updateLayout,
  updateProfile,
  updateThemeConfig,
} from '../../services/settings/settings';
import { createBackup, parseBackup } from '../../services/backup/backup';
import { createDefaultShortcuts } from '../../services/shortcuts/shortcuts';
import type { CustomAddress } from '../../types/customAddress';

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

const customAddress: CustomAddress = {
  id: 'deriv',
  target: 'https://bot.deriv.me/',
  address: 'https://miweb.com/',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('copia de seguridad', () => {
  it('exporta e importa toda la configuración', () => {
    const settings = updateGeneral(createDefaultSettings(), { searchProvider: 'duckduckgo' });
    const text = createBackup(
      { settings, shortcuts: createDefaultShortcuts(), customAddresses: [customAddress], widgets: { notes: 'hola', tasks: [] } },
      '0.1.0',
    );
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.settings.general.searchProvider).toBe('duckduckgo');
    expect(parsed.data.widgets.notes).toBe('hola');
    expect(parsed.data.customAddresses).toEqual([customAddress]);
  });

  it('convierte las reglas de alias de copias antiguas', () => {
    const legacy = {
      format: 'icarus-backup',
      version: 1,
      data: {
        aliasRules: [
          { id: 'mia', name: 'Mía', matchType: 'host', pattern: 'bot.deriv.me', displayName: 'Bot', alias: 'bot.icarus', targetUrl: 'https://bot.deriv.me/', enabled: true },
        ],
      },
    };
    const parsed = parseBackup(JSON.stringify(legacy));
    expect(parsed.ok && parsed.data.customAddresses).toMatchObject([{ id: 'mia', target: 'https://bot.deriv.me/', address: 'https://bot.icarus/', enabled: true }]);
  });

  it('rechaza archivos ajenos o de versiones futuras', () => {
    expect(parseBackup('x')).toEqual({ ok: false, error: 'invalid-json' });
    expect(parseBackup('{"format":"icarus-backup","version":99,"data":{}}')).toEqual({ ok: false, error: 'newer-version' });
    expect(parseBackup('{"format":"otro","data":{}}')).toEqual({ ok: false, error: 'invalid-format' });
  });
});

describe('perfil', () => {
  const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  it('por defecto no tiene nombre ni foto', () => {
    expect(createDefaultSettings().profile).toEqual({ name: '', photo: null, color: '#0b63c4' });
  });

  it('solo acepta fotos rasterizadas incrustadas, nunca SVG ni direcciones remotas', () => {
    const base = createDefaultSettings();
    expect(updateProfile(base, { photo }).profile.photo).toBe(photo);
    expect(updateProfile(base, { photo: 'data:image/svg+xml;base64,PHN2Zz4=' }).profile.photo).toBeNull();
    expect(updateProfile(base, { photo: 'https://ejemplo.com/foto.png' }).profile.photo).toBeNull();
    expect(updateProfile(base, { name: 'x'.repeat(80) }).profile.name).toHaveLength(40);
  });

  it('corrige datos guardados no válidos y completa en silencio el perfil que falta', () => {
    const issues: string[] = [];
    const raw = { ...createDefaultSettings(), profile: { name: '  Ana  ', photo: 'javascript:alert(1)', color: 'rojo' } };
    expect(sanitizeSettings(raw, issues).profile).toEqual({ name: 'Ana', photo: null, color: '#0b63c4' });
    expect(issues).toEqual(expect.arrayContaining(['profile.photo', 'profile.color']));

    const missing: string[] = [];
    const { profile: _profile, ...older } = createDefaultSettings();
    expect(sanitizeSettings(older, missing).profile).toEqual(createDefaultSettings().profile);
    expect(missing.every((issue) => issue.endsWith(':missing'))).toBe(true);
  });
});
