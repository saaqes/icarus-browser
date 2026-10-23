/**
 * Validación de reglas de alias. Devuelve códigos de error por campo; la interfaz
 * los traduce a mensajes (ver i18n).
 */

import { ALIAS_MATCH_TYPES, type AliasRule, type AliasRuleInput } from '../../types/alias';
import { isAliasHost, isLoopbackHost, normalizeUserUrl } from '../url-resolution/urlUtils';
import { canonicalUrl, formatHostPattern, hostPatternIsAlias, normalizeHostPattern } from './patterns';

export const RULE_NAME_MAX = 60;
export const DISPLAY_NAME_MAX = 60;
export const ALIAS_MAX = 80;

export type AliasFieldError =
  | 'required'
  | 'too-long'
  | 'invalid-url'
  | 'unsafe-protocol'
  | 'invalid-host'
  | 'alias-format'
  | 'alias-duplicate'
  | 'pattern-is-alias'
  | 'target-is-alias'
  | 'insecure-target';

export type AliasFieldErrors = Partial<Record<keyof AliasRuleInput, AliasFieldError>>;

export type AliasValidationResult = { ok: true; value: AliasRuleInput } | { ok: false; errors: AliasFieldErrors };

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
/** `nombre.icarus`, `a.b.icarus` o `nombre.icarus/ruta`. */
const ALIAS_PATTERN = new RegExp(`^(?:${LABEL}\\.)+icarus(?:/[a-z0-9._~\\-/]*)?$`);

/** Normaliza el texto de un alias: minúsculas, sin espacios, sin protocolo ni barra final. */
export function normalizeAliasText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/^(?:https?|icarus):\/\//, '')
    .replace(/\/+$/, '');
}

export function isAliasText(text: string): boolean {
  const value = normalizeAliasText(text);
  return value.length > 0 && value.length <= ALIAS_MAX && ALIAS_PATTERN.test(value);
}

/** Regla activa (distinta de `exceptId`) que ya usa este alias. */
export function findActiveAliasOwner(alias: string, rules: AliasRule[], exceptId?: string): AliasRule | undefined {
  const value = normalizeAliasText(alias);
  return rules.find((rule) => rule.enabled && rule.id !== exceptId && rule.alias === value);
}

function validateText(value: string, max: number): AliasFieldError | null {
  if (!value) return 'required';
  if (value.length > max) return 'too-long';
  return null;
}

function urlError(reason: string): AliasFieldError {
  if (reason === 'empty') return 'required';
  if (reason === 'unsafe-protocol' || reason === 'unsupported-protocol') return 'unsafe-protocol';
  if (reason === 'alias') return 'pattern-is-alias';
  return 'invalid-url';
}

/**
 * Valida y normaliza una regla.
 * @param otherRules reglas existentes para comprobar alias duplicados.
 * @param editingId id de la regla que se edita (se excluye de la comprobación).
 */
export function validateAliasRuleInput(
  input: AliasRuleInput,
  otherRules: AliasRule[] = [],
  editingId?: string,
): AliasValidationResult {
  const errors: AliasFieldErrors = {};

  const name = input.name.trim();
  const nameError = validateText(name, RULE_NAME_MAX);
  if (nameError) errors.name = nameError;

  const displayName = input.displayName.trim();
  const displayError = validateText(displayName, DISPLAY_NAME_MAX);
  if (displayError) errors.displayName = displayError;

  const matchType = (ALIAS_MATCH_TYPES as readonly string[]).includes(input.matchType) ? input.matchType : 'exact';

  let pattern = input.pattern.trim();
  let patternProtocol: string | null = null;
  if (matchType === 'host') {
    const hostPattern = normalizeHostPattern(pattern);
    if (!pattern) errors.pattern = 'required';
    else if (!hostPattern) errors.pattern = 'invalid-host';
    else if (hostPatternIsAlias(hostPattern)) errors.pattern = 'pattern-is-alias';
    else pattern = formatHostPattern(hostPattern);
  } else {
    const result = normalizeUserUrl(pattern);
    if (!result.ok) errors.pattern = urlError(result.reason);
    else {
      pattern = canonicalUrl(result.parsed);
      patternProtocol = result.parsed.protocol;
    }
  }

  const alias = normalizeAliasText(input.alias);
  if (!alias) errors.alias = 'required';
  else if (alias.length > ALIAS_MAX) errors.alias = 'too-long';
  else if (!ALIAS_PATTERN.test(alias)) errors.alias = 'alias-format';
  else if (input.enabled && findActiveAliasOwner(alias, otherRules, editingId)) errors.alias = 'alias-duplicate';

  let targetUrl = input.targetUrl.trim();
  const target = normalizeUserUrl(targetUrl);
  if (!target.ok) {
    errors.targetUrl = target.reason === 'alias' ? 'target-is-alias' : urlError(target.reason);
  } else if (isAliasHost(target.parsed.hostname)) {
    errors.targetUrl = 'target-is-alias';
  } else {
    targetUrl = target.url;
    // Una regla nunca puede llevar de HTTPS a HTTP: el destino HTTP solo se permite
    // si el patrón ya es HTTP o si el destino es local (localhost).
    const insecure = target.parsed.protocol === 'http:';
    if (insecure && patternProtocol !== 'http:' && !isLoopbackHost(target.parsed.hostname)) {
      errors.targetUrl = 'insecure-target';
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { name, matchType, pattern, displayName, alias, targetUrl, enabled: Boolean(input.enabled) },
  };
}
