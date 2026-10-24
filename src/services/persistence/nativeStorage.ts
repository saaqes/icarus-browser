/**
 * Almacenamiento de la aplicación de escritorio: las claves `icarus.*` se
 * guardan en la carpeta de datos de ICARUS (ui-storage.json) a través del
 * proceso principal. Se lee una copia al arrancar y cada cambio se envía al
 * proceso principal, que lo escribe en disco de forma atómica.
 */

import type { IcarusNativeApi } from '../../types/native';
import { STORAGE_PREFIX } from './keys';
import { StorageWriteError, type KeyValueStorage } from './storage';

const MAX_VALUE_LENGTH = 8 * 1024 * 1024;
const VALID_KEY = /^icarus\.[\w.-]{1,93}$/;

export interface NativeStorageOptions {
  /**
   * Almacenamiento anterior (LocalStorage de la interfaz). Si el almacén nativo
   * está vacío, sus claves de ICARUS se copian una vez: es la migración desde
   * versiones que guardaban en LocalStorage.
   */
  legacy?: KeyValueStorage | null;
}

export function createNativeStorage(native: IcarusNativeApi, options: NativeStorageOptions = {}): KeyValueStorage {
  const values = new Map(Object.entries(native.storage.snapshot).filter(([key]) => key.startsWith(STORAGE_PREFIX)));

  const legacy = options.legacy;
  if (legacy && values.size === 0) {
    for (const key of legacy.keys()) {
      const value = legacy.getItem(key);
      if (!VALID_KEY.test(key) || value === null || value.length > MAX_VALUE_LENGTH) continue;
      values.set(key, value);
      native.storage.setItem(key, value);
    }
  }

  return {
    kind: 'native',
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (!VALID_KEY.test(key)) throw new StorageWriteError('unknown');
      if (value.length > MAX_VALUE_LENGTH) throw new StorageWriteError('quota');
      values.set(key, value);
      native.storage.setItem(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
      native.storage.removeItem(key);
    },
    keys: () => [...values.keys()],
  };
}
