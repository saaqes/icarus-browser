/**
 * Operaciones sobre la lista de direcciones personalizadas, carga desde el
 * almacenamiento (con migración de las antiguas reglas de alias `.icarus`) e
 * importación/exportación.
 */

import type { CustomAddress, CustomAddressInput } from '../../types/customAddress';
import type { DocumentSchema } from '../persistence/document';
import { STORAGE_KEYS } from '../persistence/keys';
import { isRecord, readIsoDate } from '../persistence/validation';
import { parseWebUrl } from '../url-resolution/urlUtils';
import { formatLocation, parseLocation } from './locations';
import { findConflicts, validateCustomAddressInput, type CustomAddressConflicts, type CustomAddressErrors } from './validation';

export const MAX_CUSTOM_ADDRESSES = 200;

const EPOCH = '2026-01-01T00:00:00.000Z';

export function emptyCustomAddressInput(): CustomAddressInput {
  return { target: '', address: '', enabled: true };
}

export function toCustomAddressInput(entry: CustomAddress): CustomAddressInput {
  return { target: entry.target, address: entry.address, enabled: entry.enabled };
}

export type MutationResult =
  | { ok: true; entries: CustomAddress[]; entry: CustomAddress }
  | { ok: false; errors: CustomAddressErrors; conflicts: CustomAddressConflicts; limit?: boolean };

export function createCustomAddress(
  entries: CustomAddress[],
  input: CustomAddressInput,
  context: { id: string; now: Date },
): MutationResult {
  if (entries.length >= MAX_CUSTOM_ADDRESSES) return { ok: false, errors: {}, conflicts: {}, limit: true };
  const result = validateCustomAddressInput(input, entries);
  if (!result.ok) return result;
  const timestamp = context.now.toISOString();
  const entry: CustomAddress = { ...result.value, id: context.id, createdAt: timestamp, updatedAt: timestamp };
  return { ok: true, entries: [...entries, entry], entry };
}

export function updateCustomAddress(entries: CustomAddress[], id: string, input: CustomAddressInput, now: Date): MutationResult {
  const existing = entries.find((entry) => entry.id === id);
  if (!existing) return { ok: false, errors: {}, conflicts: {} };
  const result = validateCustomAddressInput(input, entries, id);
  if (!result.ok) return result;
  const entry: CustomAddress = { ...existing, ...result.value, updatedAt: now.toISOString() };
  return { ok: true, entries: entries.map((item) => (item.id === id ? entry : item)), entry };
}

export function deleteCustomAddress(entries: CustomAddress[], id: string): CustomAddress[] {
  return entries.filter((entry) => entry.id !== id);
}

export type ToggleResult = { ok: true; entries: CustomAddress[] } | { ok: false; conflictWith: CustomAddress };

/** Activa o desactiva una entrada. No se activa si choca con otra activa. */
export function setCustomAddressEnabled(entries: CustomAddress[], id: string, enabled: boolean, now: Date): ToggleResult {
  const entry = entries.find((item) => item.id === id);
  if (!entry) return { ok: true, entries };
  if (enabled) {
    const target = parseLocation(entry.target);
    const address = parseLocation(entry.address);
    if (target && address) {
      const { conflicts } = findConflicts({ target, address }, entries, id);
      const other = conflicts.target ?? conflicts.address;
      if (other) return { ok: false, conflictWith: other };
    }
  }
  return {
    ok: true,
    entries: entries.map((item) => (item.id === id ? { ...item, enabled, updatedAt: now.toISOString() } : item)),
  };
}

/* ------------------------------ Carga y migración ------------------------------ */

/** Reglas de ejemplo que traían las versiones anteriores; si nadie las tocó, no se migran. */
const LEGACY_DEFAULTS: Record<string, { alias: string; pattern: string }> = {
  'default-search': { alias: 'buscar.icarus', pattern: 'https://www.google.com/' },
  'default-wiki': { alias: 'wiki.icarus', pattern: 'es.wikipedia.org' },
};

type LegacyResult = { kind: 'entry'; input: CustomAddressInput } | { kind: 'skip' } | { kind: 'invalid' };

/**
 * Convierte una regla de alias de versiones anteriores (`matchType`, `pattern`,
 * `alias`…) en una dirección personalizada: el patrón pasa a ser el destino y el
 * alias, la dirección (con el protocolo del destino). Se conserva el estado activo.
 */
export function convertLegacyRule(raw: Record<string, unknown>): LegacyResult {
  const { matchType, pattern, alias, targetUrl, id } = raw;
  if (typeof pattern !== 'string' || typeof alias !== 'string') return { kind: 'invalid' };
  const legacyDefault = typeof id === 'string' ? LEGACY_DEFAULTS[id] : undefined;
  if (legacyDefault && legacyDefault.alias === alias && legacyDefault.pattern === pattern) return { kind: 'skip' };

  let target: string | null = null;
  if (matchType === 'host') {
    const host = pattern.trim().toLowerCase().replace(/^\*\./, '');
    const destination = typeof targetUrl === 'string' ? parseWebUrl(targetUrl) : null;
    const protocol = destination && destination.hostname === host ? destination.protocol : 'https:';
    target = `${protocol}//${host}/`;
  } else if (matchType === 'exact' || matchType === 'prefix') {
    const url = parseWebUrl(pattern);
    if (url) target = `${url.protocol}//${url.host}${url.pathname}`;
  }
  const targetLocation = target ? parseLocation(target) : null;
  const name = alias.trim().toLowerCase().replace(/^(?:https?|icarus):\/\//, '').replace(/\/+$/, '');
  if (!targetLocation || !name) return { kind: 'invalid' };
  return { kind: 'entry', input: { target: formatLocation(targetLocation), address: `${targetLocation.protocol}//${name}`, enabled: raw.enabled === true } };
}

type ReadResult = { kind: 'entry'; entry: CustomAddress } | { kind: 'skip' } | { kind: 'invalid' };

/** Lee una entrada desconocida (almacenamiento, copia o archivo), nueva o antigua. */
function readEntry(raw: unknown, fallbackDate: string): ReadResult {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id.trim()) return { kind: 'invalid' };
  let input: CustomAddressInput;
  if ('alias' in raw || 'matchType' in raw) {
    const legacy = convertLegacyRule(raw);
    if (legacy.kind !== 'entry') return legacy;
    input = legacy.input;
  } else if (typeof raw.target === 'string' && typeof raw.address === 'string') {
    input = { target: raw.target, address: raw.address, enabled: raw.enabled === true };
  } else {
    return { kind: 'invalid' };
  }
  // Sin comprobar conflictos: se resuelven después, con la lista completa.
  const result = validateCustomAddressInput({ ...input, enabled: false });
  if (!result.ok) return { kind: 'invalid' };
  const ignored: string[] = [];
  return {
    kind: 'entry',
    entry: {
      ...result.value,
      enabled: input.enabled,
      id: raw.id.trim().slice(0, 100),
      createdAt: readIsoDate(raw.createdAt, fallbackDate, 'createdAt', ignored),
      updatedAt: readIsoDate(raw.updatedAt, fallbackDate, 'updatedAt', ignored),
    },
  };
}

/**
 * Añade una entrada a la lista. Si choca con otra activa, se guarda desactivada:
 * nunca se sobrescribe ni se descarta en silencio otra configuración.
 */
function appendResolvingConflicts(entries: CustomAddress[], entry: CustomAddress): { entries: CustomAddress[]; disabled: boolean } {
  if (entry.enabled) {
    const target = parseLocation(entry.target);
    const address = parseLocation(entry.address);
    const { conflicts } = target && address ? findConflicts({ target, address }, entries, entry.id) : { conflicts: {} };
    if (Object.keys(conflicts).length > 0) return { entries: [...entries, { ...entry, enabled: false }], disabled: true };
  }
  return { entries: [...entries, entry], disabled: false };
}

export function sanitizeCustomAddresses(raw: unknown, issues: string[]): CustomAddress[] {
  if (!Array.isArray(raw)) {
    issues.push('customAddresses');
    return [];
  }
  const seen = new Set<string>();
  let entries: CustomAddress[] = [];
  raw.slice(0, MAX_CUSTOM_ADDRESSES).forEach((item, index) => {
    const read = readEntry(item, EPOCH);
    if (read.kind === 'skip') return;
    if (read.kind === 'invalid' || seen.has(read.entry.id)) {
      issues.push(`customAddresses[${index}]`);
      return;
    }
    seen.add(read.entry.id);
    const next = appendResolvingConflicts(entries, read.entry);
    if (next.disabled) issues.push(`customAddresses[${index}]:conflict`);
    entries = next.entries;
  });
  return entries;
}

export const customAddressesSchema: DocumentSchema<CustomAddress[]> = {
  key: STORAGE_KEYS.customAddresses,
  // v1: reglas de alias `.icarus`. v2: direcciones personalizadas (se convierten al leer).
  version: 2,
  defaults: () => [],
  sanitize: sanitizeCustomAddresses,
};

/* ---------------------------- Importar / exportar ---------------------------- */

export const CUSTOM_ADDRESS_EXPORT_FORMAT = 'icarus-custom-addresses';
const LEGACY_EXPORT_FORMAT = 'icarus-alias-rules';

export function exportCustomAddresses(entries: CustomAddress[], now: Date = new Date()): string {
  return JSON.stringify({ format: CUSTOM_ADDRESS_EXPORT_FORMAT, version: 2, exportedAt: now.toISOString(), entries }, null, 2);
}

export type ImportParse = { ok: true; items: unknown[] } | { ok: false; error: 'invalid-json' | 'invalid-format' };

/** Acepta archivos exportados por esta versión y por las anteriores (reglas de alias). */
export function parseCustomAddressFile(text: string): ImportParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid-json' };
  }
  if (Array.isArray(parsed)) return { ok: true, items: parsed };
  if (isRecord(parsed) && parsed.format === CUSTOM_ADDRESS_EXPORT_FORMAT && Array.isArray(parsed.entries)) {
    return { ok: true, items: parsed.entries };
  }
  if (isRecord(parsed) && parsed.format === LEGACY_EXPORT_FORMAT && Array.isArray(parsed.rules)) {
    return { ok: true, items: parsed.rules };
  }
  return { ok: false, error: 'invalid-format' };
}

export interface ImportSummary {
  entries: CustomAddress[];
  added: number;
  updated: number;
  skipped: number;
  /** Entradas importadas desactivadas porque chocaban con otra activa. */
  disabled: number;
}

/**
 * Combina las entradas importadas con las existentes: misma id → se reemplaza;
 * id nueva → se añade. Las no válidas se omiten y las que chocan con otra activa
 * se importan desactivadas.
 */
export function mergeImportedCustomAddresses(
  existing: CustomAddress[],
  items: unknown[],
  context: { now: Date },
): ImportSummary {
  const timestamp = context.now.toISOString();
  let entries = [...existing];
  const summary = { added: 0, updated: 0, skipped: 0, disabled: 0 };

  for (const item of items) {
    const read = readEntry(item, timestamp);
    if (read.kind !== 'entry') {
      summary.skipped += 1;
      continue;
    }
    const index = entries.findIndex((candidate) => candidate.id === read.entry.id);
    const others = index >= 0 ? entries.filter((_, position) => position !== index) : entries;
    if (index < 0 && entries.length >= MAX_CUSTOM_ADDRESSES) {
      summary.skipped += 1;
      continue;
    }
    const entry = index >= 0 ? { ...read.entry, createdAt: entries[index]!.createdAt, updatedAt: timestamp } : read.entry;
    const next = appendResolvingConflicts(others, entry);
    if (next.disabled) summary.disabled += 1;
    if (index >= 0) {
      entries = entries.map((candidate, position) => (position === index ? next.entries[next.entries.length - 1]! : candidate));
      summary.updated += 1;
    } else {
      entries = next.entries;
      summary.added += 1;
    }
  }
  return { entries, ...summary };
}

/** Busca por destino o dirección (sin protocolo). */
export function filterCustomAddresses(entries: CustomAddress[], query: string): CustomAddress[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) => [entry.target, entry.address].some((field) => field.toLowerCase().includes(needle)));
}
