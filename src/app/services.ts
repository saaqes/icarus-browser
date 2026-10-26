/**
 * Composición de servicios de la aplicación. Las pruebas pueden inyectar un
 * almacenamiento en memoria, un motor de navegación simulado o un reloj fijo.
 */

import { customAddressesSchema } from '../services/custom-addresses/store';
import { backgroundImageSchema, type StoredBackgroundImage } from '../services/background/backgroundImage';
import { bookmarksSchema } from '../services/bookmarks/bookmarks';
import type { BrowserEngine } from '../services/navigation/engine';
import { createExternalBrowserEngine } from '../services/navigation/externalEngine';
import { createNativeEngine } from '../services/navigation/nativeEngine';
import { createNativeStorage } from '../services/persistence/nativeStorage';
import { createBrowserStorage, type KeyValueStorage } from '../services/persistence/storage';
import { createPersistentStore, type PersistentStore, type SaveErrorEvent } from '../services/persistence/store';
import { settingsSchema } from '../services/settings/settings';
import { shortcutsSchema } from '../services/shortcuts/shortcuts';
import { sessionSchema, type StoredSession } from '../services/tabs/session';
import { widgetDataSchema } from '../services/widgets/widgets';
import type { BookmarksData } from '../types/bookmarks';
import type { CustomAddress } from '../types/customAddress';
import type { IcarusNativeApi } from '../types/native';
import type { Settings } from '../types/settings';
import type { Shortcut } from '../types/shortcuts';
import type { WidgetData } from '../types/widgets';

export interface AppServices {
  storage: KeyValueStorage;
  settings: PersistentStore<Settings>;
  shortcuts: PersistentStore<Shortcut[]>;
  customAddresses: PersistentStore<CustomAddress[]>;
  widgets: PersistentStore<WidgetData>;
  backgroundImage: PersistentStore<StoredBackgroundImage>;
  bookmarks: PersistentStore<BookmarksData>;
  /** Solo se guarda si el usuario eligió restaurar la sesión al iniciar. */
  session: PersistentStore<StoredSession>;
  engine: BrowserEngine;
  /** Puente con la aplicación de escritorio (null en la versión web). */
  native: IcarusNativeApi | null;
  onSaveError(listener: (event: SaveErrorEvent) => void): () => void;
  now(): Date;
  createId(): string;
}

export interface AppServicesOptions {
  storage?: KeyValueStorage;
  engine?: BrowserEngine;
  /** Puente nativo; si se omite se usa `window.icarusNative` cuando existe. */
  native?: IcarusNativeApi | null;
  now?: () => Date;
}

/** API expuesta por el preload de la aplicación de escritorio, si existe. */
export function getNativeApi(): IcarusNativeApi | null {
  const api = (globalThis as { icarusNative?: IcarusNativeApi }).icarusNative;
  return api && api.apiVersion === 1 ? api : null;
}

function defaultCreateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createAppServices(options: AppServicesOptions = {}): AppServices {
  const native = options.native !== undefined ? options.native : getNativeApi();
  const storage =
    options.storage ?? (native ? createNativeStorage(native, { legacy: createBrowserStorage() }) : createBrowserStorage());
  const listeners = new Set<(event: SaveErrorEvent) => void>();
  const onSaveError = (event: SaveErrorEvent) => listeners.forEach((listener) => listener(event));

  const settings = createPersistentStore(storage, settingsSchema, { onSaveError });
  const session = createPersistentStore(storage, sessionSchema, {
    onSaveError,
    persist: () => settings.getSnapshot().general.startup === 'restore-session',
  });

  return {
    storage,
    settings,
    session,
    shortcuts: createPersistentStore(storage, shortcutsSchema, { onSaveError }),
    customAddresses: createPersistentStore(storage, customAddressesSchema, { onSaveError }),
    widgets: createPersistentStore(storage, widgetDataSchema, { onSaveError }),
    backgroundImage: createPersistentStore(storage, backgroundImageSchema, { onSaveError }),
    bookmarks: createPersistentStore(storage, bookmarksSchema, { onSaveError }),
    engine: options.engine ?? (native ? createNativeEngine(native) : createExternalBrowserEngine()),
    native,
    onSaveError(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    now: options.now ?? (() => new Date()),
    createId: defaultCreateId,
  };
}
