/**
 * Operaciones puras sobre la lista de reglas de alias, valores predeterminados,
 * saneamiento al cargar e importación/exportación.
 */

import { ALIAS_MATCH_TYPES, type AliasRule, type AliasRuleInput } from '../../types/alias';
import type { DocumentSchema } from '../persistence/document';
import { STORAGE_KEYS } from '../persistence/keys';
import { isRecord, readIsoDate } from '../persistence/validation';
import { findActiveAliasOwner, validateAliasRuleInput, type AliasFieldErrors } from './validation';

export const MAX_ALIAS_RULES = 200;

const EPOCH = '2026-01-01T00:00:00.000Z';

/** Reglas de ejemplo. La primera reproduce el caso `buscar.icarus` → Google. */
export function createDefaultAliasRules(now: Date = new Date(EPOCH)): AliasRule[] {
  const timestamp = now.toISOString();
  return [
    {
      id: 'default-search',
      name: 'Página de búsqueda',
      matchType: 'exact',
      pattern: 'https://www.google.com/',
      displayName: 'Buscar',
      alias: 'buscar.icarus',
      targetUrl: 'https://www.google.com/',
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'default-wiki',
      name: 'Enciclopedia',
      matchType: 'host',
      pattern: 'es.wikipedia.org',
      displayName: 'Wikipedia',
      alias: 'wiki.icarus',
      targetUrl: 'https://es.wikipedia.org/',
      enabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
}

export function emptyAliasRuleInput(): AliasRuleInput {
  return { name: '', matchType: 'exact', pattern: '', displayName: '', alias: '', targetUrl: '', enabled: true };
}

export function toRuleInput(rule: AliasRule): AliasRuleInput {
  const { name, matchType, pattern, displayName, alias, targetUrl, enabled } = rule;
  return { name, matchType, pattern, displayName, alias, targetUrl, enabled };
}

export type RuleMutationResult =
  | { ok: true; rules: AliasRule[]; rule: AliasRule }
  | { ok: false; errors: AliasFieldErrors; limit?: boolean };

export function createAliasRule(
  rules: AliasRule[],
  input: AliasRuleInput,
  context: { id: string; now: Date },
): RuleMutationResult {
  if (rules.length >= MAX_ALIAS_RULES) return { ok: false, errors: {}, limit: true };
  const result = validateAliasRuleInput(input, rules);
  if (!result.ok) return result;
  const timestamp = context.now.toISOString();
  const rule: AliasRule = { ...result.value, id: context.id, createdAt: timestamp, updatedAt: timestamp };
  return { ok: true, rules: [...rules, rule], rule };
}

export function updateAliasRule(
  rules: AliasRule[],
  id: string,
  input: AliasRuleInput,
  now: Date,
): RuleMutationResult {
  const existing = rules.find((rule) => rule.id === id);
  if (!existing) return { ok: false, errors: {} };
  const result = validateAliasRuleInput(input, rules, id);
  if (!result.ok) return result;
  const rule: AliasRule = { ...existing, ...result.value, updatedAt: now.toISOString() };
  return { ok: true, rules: rules.map((item) => (item.id === id ? rule : item)), rule };
}

export function deleteAliasRule(rules: AliasRule[], id: string): AliasRule[] {
  return rules.filter((rule) => rule.id !== id);
}

export type ToggleResult = { ok: true; rules: AliasRule[] } | { ok: false; conflictWith: AliasRule };

/** Activa o desactiva una regla. No permite activar dos reglas con el mismo alias. */
export function setAliasRuleEnabled(rules: AliasRule[], id: string, enabled: boolean, now: Date): ToggleResult {
  const rule = rules.find((item) => item.id === id);
  if (!rule) return { ok: true, rules };
  if (enabled) {
    const owner = findActiveAliasOwner(rule.alias, rules, id);
    if (owner) return { ok: false, conflictWith: owner };
  }
  return {
    ok: true,
    rules: rules.map((item) => (item.id === id ? { ...item, enabled, updatedAt: now.toISOString() } : item)),
  };
}

export function filterAliasRules(rules: AliasRule[], query: string): AliasRule[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rules;
  return rules.filter((rule) =>
    [rule.name, rule.alias, rule.pattern, rule.displayName, rule.targetUrl].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}

/** Lee una regla desconocida (almacenamiento o archivo). Devuelve null si no es válida. */
function readRule(raw: unknown, fallbackDate: string): AliasRule | null {
  if (!isRecord(raw)) return null;
  const strings = ['id', 'name', 'pattern', 'displayName', 'alias', 'targetUrl'] as const;
  if (strings.some((key) => typeof raw[key] !== 'string')) return null;
  if (!(ALIAS_MATCH_TYPES as readonly unknown[]).includes(raw.matchType)) return null;
  const input: AliasRuleInput = {
    name: raw.name as string,
    matchType: raw.matchType as AliasRule['matchType'],
    pattern: raw.pattern as string,
    displayName: raw.displayName as string,
    alias: raw.alias as string,
    targetUrl: raw.targetUrl as string,
    enabled: raw.enabled === true,
  };
  const result = validateAliasRuleInput(input);
  if (!result.ok || !(raw.id as string).trim()) return null;
  const ignored: string[] = [];
  return {
    ...result.value,
    id: (raw.id as string).trim().slice(0, 100),
    createdAt: readIsoDate(raw.createdAt, fallbackDate, 'createdAt', ignored),
    updatedAt: readIsoDate(raw.updatedAt, fallbackDate, 'updatedAt', ignored),
  };
}

export function sanitizeAliasRules(raw: unknown, issues: string[]): AliasRule[] {
  if (!Array.isArray(raw)) {
    issues.push('aliasRules');
    return createDefaultAliasRules();
  }
  const seen = new Set<string>();
  const rules: AliasRule[] = [];
  raw.slice(0, MAX_ALIAS_RULES).forEach((item, index) => {
    const rule = readRule(item, EPOCH);
    if (!rule || seen.has(rule.id)) {
      issues.push(`aliasRules[${index}]`);
      return;
    }
    seen.add(rule.id);
    rules.push(rule);
  });
  return rules;
}

export const aliasRulesSchema: DocumentSchema<AliasRule[]> = {
  key: STORAGE_KEYS.aliasRules,
  version: 1,
  defaults: () => createDefaultAliasRules(),
  sanitize: sanitizeAliasRules,
};

/* ---------------------------- Importar / exportar ---------------------------- */

export const ALIAS_EXPORT_FORMAT = 'icarus-alias-rules';

export function exportAliasRules(rules: AliasRule[], now: Date = new Date()): string {
  return JSON.stringify({ format: ALIAS_EXPORT_FORMAT, version: 1, exportedAt: now.toISOString(), rules }, null, 2);
}

export type AliasImportParse = { ok: true; items: unknown[] } | { ok: false; error: 'invalid-json' | 'invalid-format' };

export function parseAliasRulesFile(text: string): AliasImportParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid-json' };
  }
  if (Array.isArray(parsed)) return { ok: true, items: parsed };
  if (isRecord(parsed) && parsed.format === ALIAS_EXPORT_FORMAT && Array.isArray(parsed.rules)) {
    return { ok: true, items: parsed.rules };
  }
  return { ok: false, error: 'invalid-format' };
}

export interface AliasImportSummary {
  rules: AliasRule[];
  added: number;
  updated: number;
  skipped: number;
  /** Reglas importadas desactivadas porque su alias ya estaba en uso. */
  disabled: number;
}

/**
 * Combina reglas importadas con las existentes: misma id → se reemplaza;
 * id nueva → se añade. Las reglas inválidas se omiten y las que repiten un alias
 * activo se importan desactivadas.
 */
export function mergeImportedRules(
  existing: AliasRule[],
  items: unknown[],
  context: { now: Date; createId: () => string },
): AliasImportSummary {
  const timestamp = context.now.toISOString();
  let rules = [...existing];
  const summary = { added: 0, updated: 0, skipped: 0, disabled: 0 };

  for (const item of items) {
    const rule = readRule(item, timestamp);
    if (!rule) {
      summary.skipped += 1;
      continue;
    }
    const index = rules.findIndex((candidate) => candidate.id === rule.id);
    if (rule.enabled && findActiveAliasOwner(rule.alias, rules, rule.id)) {
      rule.enabled = false;
      summary.disabled += 1;
    }
    if (index >= 0) {
      rules[index] = { ...rule, createdAt: rules[index]!.createdAt, updatedAt: timestamp };
      summary.updated += 1;
    } else if (rules.length < MAX_ALIAS_RULES) {
      const id = rule.id || context.createId();
      rules = [...rules, { ...rule, id }];
      summary.added += 1;
    } else {
      summary.skipped += 1;
    }
  }
  return { rules, ...summary };
}
