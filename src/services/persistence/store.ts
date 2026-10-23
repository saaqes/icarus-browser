/**
 * Store observable con persistencia automática, pensado para `useSyncExternalStore`.
 * La lógica de negocio vive en funciones puras (services/*); el store solo guarda,
 * notifica y persiste.
 */

import { loadDocument, saveDocument, type DocumentSchema, type LoadResult, type SaveResult } from './document';
import type { KeyValueStorage, StorageErrorReason } from './storage';

export type Listener = () => void;

export interface SaveErrorEvent {
  key: string;
  reason: StorageErrorReason;
}

export interface PersistentStore<T> {
  readonly key: string;
  readonly initialLoad: LoadResult<T>;
  getSnapshot(): T;
  subscribe(listener: Listener): () => void;
  /** Actualiza el valor y lo guarda. Si el guardado falla, el cambio se mantiene en memoria. */
  set(next: T | ((previous: T) => T)): SaveResult;
  /** Vuelve a leer desde el almacenamiento (p. ej. tras un evento `storage` de otra ventana). */
  reload(): LoadResult<T>;
  /** Restablece los valores predeterminados del esquema. */
  reset(): SaveResult;
}

export interface PersistentStoreOptions {
  /** Si es false, el store no escribe en el almacenamiento (p. ej. sesión sin restauración). */
  persist?: () => boolean;
  onSaveError?: (event: SaveErrorEvent) => void;
}

export function createPersistentStore<T>(
  storage: KeyValueStorage,
  schema: DocumentSchema<T>,
  options: PersistentStoreOptions = {},
): PersistentStore<T> {
  const initialLoad = loadDocument(storage, schema);
  let state = initialLoad.value;
  const listeners = new Set<Listener>();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const persist = (value: T): SaveResult => {
    if (options.persist && !options.persist()) return { ok: true };
    const result = saveDocument(storage, schema, value);
    if (!result.ok) options.onSaveError?.({ key: schema.key, reason: result.reason });
    return result;
  };

  return {
    key: schema.key,
    initialLoad,
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      const value = typeof next === 'function' ? (next as (previous: T) => T)(state) : next;
      if (Object.is(value, state)) return { ok: true };
      state = value;
      notify();
      return persist(value);
    },
    reload() {
      const result = loadDocument(storage, schema);
      state = result.value;
      notify();
      return result;
    },
    reset() {
      state = schema.defaults();
      notify();
      return persist(state);
    },
  };
}
