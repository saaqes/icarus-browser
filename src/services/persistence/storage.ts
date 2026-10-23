/**
 * Adaptadores de almacenamiento clave-valor.
 *
 * Durante la fase web se usa LocalStorage. Si no está disponible (modo privado,
 * cookies bloqueadas, cuota agotada al probar) se usa memoria y la aplicación lo
 * indica en Configuración → Avanzado. Un futuro host nativo (CEF, Android, iOS)
 * puede implementar esta misma interfaz sobre su almacenamiento local.
 */

export type StorageKind = 'local' | 'memory';

export interface KeyValueStorage {
  readonly kind: StorageKind;
  getItem(key: string): string | null;
  /** Lanza `StorageWriteError` si no se puede escribir. */
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

export type StorageErrorReason = 'quota' | 'unavailable' | 'unknown';

export class StorageWriteError extends Error {
  readonly reason: StorageErrorReason;

  constructor(reason: StorageErrorReason, cause?: unknown) {
    super(`No se pudo escribir en el almacenamiento (${reason})`);
    this.name = 'StorageWriteError';
    this.reason = reason;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

function isQuotaError(error: unknown): boolean {
  if (!(error instanceof DOMException) && !(error instanceof Error)) return false;
  const name = (error as { name?: string }).name ?? '';
  const code = (error as { code?: number }).code;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

export function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const map = new Map(Object.entries(initial));
  return {
    kind: 'memory',
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    keys: () => [...map.keys()],
  };
}

/** Envuelve un `Storage` del DOM convirtiendo sus excepciones en errores tipados. */
export function wrapWebStorage(storage: Storage): KeyValueStorage {
  return {
    kind: 'local',
    getItem: (key) => {
      try {
        return storage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        storage.setItem(key, value);
      } catch (error) {
        throw new StorageWriteError(isQuotaError(error) ? 'quota' : 'unknown', error);
      }
    },
    removeItem: (key) => {
      try {
        storage.removeItem(key);
      } catch {
        // Ignorado: borrar es una operación de mejor esfuerzo.
      }
    },
    keys: () => {
      try {
        const result: string[] = [];
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          if (key !== null) result.push(key);
        }
        return result;
      } catch {
        return [];
      }
    },
  };
}

const PROBE_KEY = 'icarus.__probe__';

/** Devuelve LocalStorage si funciona; si no, almacenamiento en memoria. */
export function createBrowserStorage(): KeyValueStorage {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return createMemoryStorage();
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
    return wrapWebStorage(storage);
  } catch {
    return createMemoryStorage();
  }
}

/** Tamaño aproximado (en bytes UTF-16) de las claves con el prefijo indicado. */
export function estimateUsage(storage: KeyValueStorage, prefix: string): number {
  return storage
    .keys()
    .filter((key) => key.startsWith(prefix))
    .reduce((total, key) => total + (key.length + (storage.getItem(key)?.length ?? 0)) * 2, 0);
}
