/**
 * Validación de los argumentos que llegan por IPC desde la interfaz. Cualquier
 * valor inesperado lanza un error y la operación no se realiza.
 */

export class IpcValidationError extends Error {
  constructor(message: string) {
    super(`IPC no válido: ${message}`);
    this.name = 'IpcValidationError';
  }
}

export function assertString(value: unknown, name: string, maxLength = 2048): string {
  if (typeof value !== 'string' || value.length > maxLength) throw new IpcValidationError(name);
  return value;
}

export function assertBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new IpcValidationError(name);
  return value;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function assertId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcValidationError(name);
  return value;
}

export function assertOneOf<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw new IpcValidationError(name);
  return value as T;
}

export function assertRect(value: unknown): { x: number; y: number; width: number; height: number } {
  if (!value || typeof value !== 'object') throw new IpcValidationError('rect');
  const rect = value as Record<string, unknown>;
  const read = (key: string) => {
    const n = rect[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100_000) throw new IpcValidationError(`rect.${key}`);
    return Math.round(n);
  };
  return { x: read('x'), y: read('y'), width: read('width'), height: read('height') };
}

const COLOR = /^#[0-9a-f]{6}$/i;

export function assertColor(value: unknown, name: string): string {
  if (typeof value !== 'string' || !COLOR.test(value)) throw new IpcValidationError(name);
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
