/**
 * Utilidades para sanear datos desconocidos leídos del almacenamiento o de un
 * archivo importado. Cada función devuelve un valor válido y anota en `issues`
 * la ruta del campo que se corrigió.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readEnum<T extends string | number>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  path: string,
  issues: string[],
): T {
  if ((allowed as readonly unknown[]).includes(value)) return value as T;
  if (value !== undefined) issues.push(path);
  else issues.push(`${path}:missing`);
  return fallback;
}

export function readBoolean(value: unknown, fallback: boolean, path: string, issues: string[]): boolean {
  if (typeof value === 'boolean') return value;
  issues.push(value === undefined ? `${path}:missing` : path);
  return fallback;
}

export function readString(
  value: unknown,
  fallback: string,
  path: string,
  issues: string[],
  maxLength = 10_000,
): string {
  if (typeof value === 'string' && value.length <= maxLength) return value;
  issues.push(value === undefined ? `${path}:missing` : path);
  return fallback;
}

export function readRecord(value: unknown, path: string, issues: string[]): Record<string, unknown> {
  if (isRecord(value)) return value;
  issues.push(value === undefined ? `${path}:missing` : path);
  return {};
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export function readIsoDate(value: unknown, fallback: string, path: string, issues: string[]): string {
  if (typeof value === 'string' && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))) return value;
  issues.push(path);
  return fallback;
}

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;
