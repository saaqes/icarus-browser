/**
 * Almacén clave-valor de la interfaz (claves `icarus.*`) guardado en la carpeta
 * de datos de ICARUS. Sustituye a LocalStorage en la aplicación de escritorio;
 * la interfaz mantiene sus esquemas, migraciones y saneamiento.
 */

import { JsonFile } from './jsonFile';
import { isRecord } from './validate';

export const MAX_KEY_LENGTH = 100;
export const MAX_VALUE_LENGTH = 8 * 1024 * 1024;
const MAX_TOTAL_LENGTH = 24 * 1024 * 1024;

export function isValidStorageKey(key: unknown): key is string {
  return typeof key === 'string' && key.startsWith('icarus.') && key.length <= MAX_KEY_LENGTH && /^[\w.-]+$/.test(key);
}

function sanitize(raw: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!isRecord(raw)) return result;
  for (const [key, value] of Object.entries(raw)) {
    if (isValidStorageKey(key) && typeof value === 'string' && value.length <= MAX_VALUE_LENGTH) result[key] = value;
  }
  return result;
}

export class UiStorage {
  private readonly file: JsonFile<Record<string, string>>;

  constructor(path: string) {
    this.file = new JsonFile(path, { version: 1, defaults: () => ({}), sanitize, delayMs: 300 });
  }

  snapshot(): Record<string, string> {
    return { ...this.file.get() };
  }

  set(key: string, value: string): boolean {
    if (!isValidStorageKey(key) || value.length > MAX_VALUE_LENGTH) return false;
    const next = { ...this.file.get(), [key]: value };
    const total = Object.values(next).reduce((sum, item) => sum + item.length, 0);
    if (total > MAX_TOTAL_LENGTH) return false;
    this.file.set(next);
    return true;
  }

  remove(key: string): void {
    if (!isValidStorageKey(key)) return;
    const next = { ...this.file.get() };
    delete next[key];
    this.file.set(next);
  }

  flush(): void {
    this.file.flush();
  }
}
