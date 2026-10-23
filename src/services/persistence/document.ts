/**
 * Documentos persistentes versionados.
 *
 * Cada documento se guarda como `{ version, savedAt, data }`. Al leer:
 * 1. Si no existe → valores predeterminados.
 * 2. Si el JSON está dañado → se guarda una copia en `<clave>.backup` y se usan
 *    valores predeterminados.
 * 3. Si la versión es anterior → se aplican las migraciones en orden.
 * 4. Siempre se sanea campo a campo: un campo inválido se sustituye por su valor
 *    predeterminado sin perder el resto de las preferencias.
 */

import { StorageWriteError, type KeyValueStorage, type StorageErrorReason } from './storage';

export interface DocumentSchema<T> {
  key: string;
  version: number;
  defaults: () => T;
  /** Devuelve un valor válido a partir de datos desconocidos. Anota en `issues` lo corregido. */
  sanitize: (raw: unknown, issues: string[]) => T;
  /** `migrations[n]` transforma datos de la versión n a la n + 1. */
  migrations?: Record<number, (data: unknown) => unknown>;
}

export type LoadStatus = 'empty' | 'ok' | 'migrated' | 'repaired' | 'corrupt' | 'newer-version';

export interface LoadResult<T> {
  value: T;
  status: LoadStatus;
  issues: string[];
}

export type SaveResult = { ok: true } | { ok: false; reason: StorageErrorReason };

interface Envelope {
  version: number;
  savedAt?: string;
  data: unknown;
}

function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Envelope).version === 'number' &&
    Number.isInteger((value as Envelope).version) &&
    'data' in value
  );
}

export function backupKey(key: string): string {
  return `${key}.backup`;
}

export function loadDocument<T>(storage: KeyValueStorage, schema: DocumentSchema<T>): LoadResult<T> {
  const raw = storage.getItem(schema.key);
  if (raw === null) return { value: schema.defaults(), status: 'empty', issues: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    try {
      storage.setItem(backupKey(schema.key), raw);
    } catch {
      // Sin espacio para la copia: se continúa con los valores predeterminados.
    }
    return { value: schema.defaults(), status: 'corrupt', issues: ['json'] };
  }

  // Datos sin sobre de versión: se consideran versión 0.
  let version = isEnvelope(parsed) ? parsed.version : 0;
  let data = isEnvelope(parsed) ? parsed.data : parsed;
  let migrated = false;

  if (version > schema.version) {
    const issues: string[] = [];
    const value = schema.sanitize(data, issues);
    return { value, status: 'newer-version', issues };
  }

  while (version < schema.version) {
    const migrate = schema.migrations?.[version];
    if (migrate) {
      try {
        data = migrate(data);
      } catch {
        // Una migración fallida no debe bloquear el arranque: se sanea lo que haya.
      }
      migrated = true;
    }
    version += 1;
  }

  const issues: string[] = [];
  const value = schema.sanitize(data, issues);
  // Los campos ausentes (`:missing`) se completan en silencio: es lo esperado al
  // añadir preferencias nuevas en versiones posteriores.
  const repaired = issues.some((issue) => !issue.endsWith(':missing'));
  const status: LoadStatus = repaired ? 'repaired' : migrated ? 'migrated' : 'ok';
  return { value, status, issues };
}

export function serializeDocument<T>(schema: DocumentSchema<T>, value: T, now: Date = new Date()): string {
  const envelope: Envelope = { version: schema.version, savedAt: now.toISOString(), data: value };
  return JSON.stringify(envelope);
}

export function saveDocument<T>(storage: KeyValueStorage, schema: DocumentSchema<T>, value: T): SaveResult {
  try {
    storage.setItem(schema.key, serializeDocument(schema, value));
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof StorageWriteError ? error.reason : 'unknown' };
  }
}
