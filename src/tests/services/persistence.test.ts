import { describe, expect, it, vi } from 'vitest';
import { backupKey, loadDocument, saveDocument, type DocumentSchema } from '../../services/persistence/document';
import { createMemoryStorage, StorageWriteError, wrapWebStorage, type KeyValueStorage } from '../../services/persistence/storage';
import { createPersistentStore } from '../../services/persistence/store';
import { readBoolean, readRecord } from '../../services/persistence/validation';
import { createDefaultSettings, sanitizeSettings, settingsSchema } from '../../services/settings/settings';
import { STORAGE_KEYS } from '../../services/persistence/keys';

interface Demo {
  enabled: boolean;
  label: string;
}

const demoSchema: DocumentSchema<Demo> = {
  key: 'test.demo',
  version: 2,
  defaults: () => ({ enabled: false, label: 'predeterminado' }),
  sanitize: (raw, issues) => {
    const value = readRecord(raw, 'demo', issues);
    return {
      enabled: readBoolean(value.enabled, false, 'enabled', issues),
      label: typeof value.label === 'string' ? value.label : (issues.push('label'), 'predeterminado'),
    };
  },
  // v0 → v1: `active` pasa a llamarse `enabled`. v1 → v2: `name` pasa a `label`.
  migrations: {
    0: (data) => ({ enabled: (data as { active?: boolean }).active, name: (data as { name?: string }).name }),
    1: (data) => ({ enabled: (data as Demo).enabled, label: (data as { name?: string }).name }),
  },
};

describe('loadDocument / saveDocument', () => {
  it('usa valores predeterminados si no hay datos', () => {
    expect(loadDocument(createMemoryStorage(), demoSchema)).toEqual({
      value: { enabled: false, label: 'predeterminado' },
      status: 'empty',
      issues: [],
    });
  });

  it('guarda y recupera con sobre de versión', () => {
    const storage = createMemoryStorage();
    expect(saveDocument(storage, demoSchema, { enabled: true, label: 'hola' })).toEqual({ ok: true });
    const stored = JSON.parse(storage.getItem('test.demo')!);
    expect(stored).toMatchObject({ version: 2, data: { enabled: true, label: 'hola' } });
    expect(loadDocument(storage, demoSchema)).toMatchObject({ value: { enabled: true, label: 'hola' }, status: 'ok' });
  });

  it('migra datos antiguos sin sobre (versión 0)', () => {
    const storage = createMemoryStorage({ 'test.demo': JSON.stringify({ active: true, name: 'viejo' }) });
    expect(loadDocument(storage, demoSchema)).toMatchObject({ value: { enabled: true, label: 'viejo' }, status: 'migrated' });
  });

  it('recupera un JSON dañado guardando una copia', () => {
    const storage = createMemoryStorage({ 'test.demo': '{roto' });
    const result = loadDocument(storage, demoSchema);
    expect(result.status).toBe('corrupt');
    expect(result.value).toEqual(demoSchema.defaults());
    expect(storage.getItem(backupKey('test.demo'))).toBe('{roto');
  });

  it('repara campos inválidos sin perder los válidos', () => {
    const storage = createMemoryStorage({ 'test.demo': JSON.stringify({ version: 2, data: { enabled: 'sí', label: 'vale' } }) });
    expect(loadDocument(storage, demoSchema)).toMatchObject({ value: { enabled: false, label: 'vale' }, status: 'repaired' });
  });

  it('informa de errores de cuota en lugar de lanzar', () => {
    const failing: KeyValueStorage = {
      ...createMemoryStorage(),
      setItem: () => {
        throw new StorageWriteError('quota');
      },
    };
    expect(saveDocument(failing, demoSchema, demoSchema.defaults())).toEqual({ ok: false, reason: 'quota' });
  });

  it('traduce QuotaExceededError del navegador', () => {
    const fake = {
      length: 0,
      key: () => null,
      getItem: () => null,
      removeItem: () => {},
      clear: () => {},
      setItem: () => {
        throw new DOMException('lleno', 'QuotaExceededError');
      },
    } as Storage;
    expect(() => wrapWebStorage(fake).setItem('a', 'b')).toThrowError(StorageWriteError);
    try {
      wrapWebStorage(fake).setItem('a', 'b');
    } catch (error) {
      expect((error as StorageWriteError).reason).toBe('quota');
    }
  });
});

describe('createPersistentStore', () => {
  it('notifica, persiste y avisa de errores de guardado', () => {
    const storage = createMemoryStorage();
    const onSaveError = vi.fn();
    const store = createPersistentStore(storage, demoSchema, { onSaveError });
    const listener = vi.fn();
    store.subscribe(listener);
    store.set((prev) => ({ ...prev, enabled: true }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(loadDocument(storage, demoSchema).value.enabled).toBe(true);

    storage.setItem = () => {
      throw new StorageWriteError('quota');
    };
    const result = store.set({ enabled: false, label: 'x' });
    expect(result).toEqual({ ok: false, reason: 'quota' });
    expect(onSaveError).toHaveBeenCalledWith({ key: 'test.demo', reason: 'quota' });
    // El cambio se mantiene en memoria durante la sesión.
    expect(store.getSnapshot().label).toBe('x');
  });

  it('puede desactivar la persistencia', () => {
    const storage = createMemoryStorage();
    const store = createPersistentStore(storage, demoSchema, { persist: () => false });
    store.set({ enabled: true, label: 'temporal' });
    expect(storage.getItem('test.demo')).toBeNull();
  });
});

describe('esquema de preferencias', () => {
  it('sanea preferencias inválidas campo a campo', () => {
    const issues: string[] = [];
    const defaults = createDefaultSettings();
    const raw = {
      general: { searchProvider: 'yahoo', startup: 'restore-session', homePage: { kind: 'url', url: 'javascript:alert(1)' } },
      appearance: {
        theme: 'edge-inspired',
        themes: { icarus: { colorMode: 'neon', background: { kind: 'color', color: '#ABCDEF' } } },
        widgets: { notes: false },
      },
      navigation: 'basura',
    };
    const result = sanitizeSettings(raw, issues);
    expect(result.general.searchProvider).toBe('google');
    expect(result.general.startup).toBe('restore-session');
    expect(result.general.homePage).toEqual({ kind: 'new-tab' });
    expect(result.appearance.theme).toBe('edge-inspired');
    expect(result.appearance.themes.icarus.colorMode).toBe(defaults.appearance.themes.icarus.colorMode);
    expect(result.appearance.themes.icarus.background).toEqual({ kind: 'color', color: '#abcdef' });
    expect(result.appearance.widgets.notes).toBe(false);
    expect(result.navigation).toEqual(defaults.navigation);
    expect(issues).toEqual(expect.arrayContaining(['general.searchProvider', 'general.homePage', 'navigation']));
  });

  it('completa en silencio los campos nuevos que faltan', () => {
    const storage = createMemoryStorage();
    const partial = createDefaultSettings() as unknown as Record<string, Record<string, unknown>>;
    delete partial.advanced;
    storage.setItem(STORAGE_KEYS.settings, JSON.stringify({ version: 1, data: partial }));
    const result = loadDocument(storage, settingsSchema);
    expect(result.status).toBe('ok');
    expect(result.value.advanced.showAliases).toBe(true);
  });
});
