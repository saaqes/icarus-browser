/** Preferencias propias de la aplicación de escritorio (descargas y privacidad). */

import type { DesktopPreferences } from '../../src/types/native';
import { JsonFile } from './jsonFile';
import { isRecord } from './validate';

export function defaultPreferences(): DesktopPreferences {
  return {
    downloads: { askWhereToSave: false, directory: null },
    privacy: { clearOnExit: { history: false, cookies: false, cache: false } },
  };
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function sanitizePreferences(raw: unknown): DesktopPreferences {
  const defaults = defaultPreferences();
  const root = isRecord(raw) ? raw : {};
  const downloads = isRecord(root.downloads) ? root.downloads : {};
  const privacy = isRecord(root.privacy) ? root.privacy : {};
  const clear = isRecord(privacy.clearOnExit) ? privacy.clearOnExit : {};
  const directory = downloads.directory;
  return {
    downloads: {
      askWhereToSave: bool(downloads.askWhereToSave, defaults.downloads.askWhereToSave),
      directory: typeof directory === 'string' && directory.length > 0 && directory.length < 1024 ? directory : null,
    },
    privacy: {
      clearOnExit: {
        history: bool(clear.history, false),
        cookies: bool(clear.cookies, false),
        cache: bool(clear.cache, false),
      },
    },
  };
}

export function createPreferencesFile(path: string) {
  return new JsonFile<DesktopPreferences>(path, { version: 1, defaults: defaultPreferences, sanitize: sanitizePreferences });
}
