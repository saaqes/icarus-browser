/**
 * Regla de "Cambiar nombre de URL".
 *
 * Un alias es una etiqueta de presentación interna de ICARUS (p. ej. `buscar.icarus`).
 * No es un dominio de Internet: nunca sustituye al origen real del documento, no
 * toca DNS ni certificados y la URL real siempre sigue disponible.
 */

export const ALIAS_MATCH_TYPES = ['exact', 'prefix', 'host'] as const;
export type AliasMatchType = (typeof ALIAS_MATCH_TYPES)[number];

export interface AliasRule {
  id: string;
  /** Nombre de la regla (solo para el administrador). */
  name: string;
  /** Cómo se compara `pattern` con la URL real. */
  matchType: AliasMatchType;
  /** URL original (exact/prefix) o nombre de host, admite `*.dominio` (host). */
  pattern: string;
  /** Nombre visible del sitio (título de pestaña). */
  displayName: string;
  /** Texto mostrado en lugar de la URL. Siempre termina en `.icarus`. */
  alias: string;
  /** URL real a la que se navega al escribir el alias. */
  targetUrl: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AliasRuleInput = Pick<
  AliasRule,
  'name' | 'matchType' | 'pattern' | 'displayName' | 'alias' | 'targetUrl' | 'enabled'
>;

/** Resultado de aplicar las reglas a una URL real. */
export interface AliasMatch {
  rule: AliasRule;
  /** URL real normalizada que coincidió. */
  realUrl: string;
}

export type AliasConflictType = 'duplicate-alias' | 'duplicate-pattern' | 'overlap';

export interface AliasConflict {
  type: AliasConflictType;
  /** Regla que se aplica según la prioridad. */
  winnerId: string;
  /** Regla que queda eclipsada en la zona en conflicto. */
  loserId: string;
}
