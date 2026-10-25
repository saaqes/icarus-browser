/**
 * Versiones de ICARUS Browser.
 *
 * Solo se aceptan dos formas, en todas las plataformas:
 * - estable: `MAYOR.MENOR.PARCHE` (p. ej. `0.2.1`);
 * - preliminar: `MAYOR.MENOR.PARCHE-preview.N` (p. ej. `0.3.0-preview.2`), anterior a
 *   la estable con los mismos números.
 *
 * El código de versión de Android (y CFBundleVersion en iOS) se deriva de la misma
 * versión, así que nunca puede desincronizarse ni retroceder entre versiones.
 */

export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** Número de la versión preliminar, o null si es estable. */
  preview: number | null;
}

const PATTERN = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d?)\.(0|[1-9]\d?)(?:-preview\.([1-9]\d?))?$/;

/** Límites para que el código de versión de Android quepa en un entero de 32 bits. */
export const VERSION_LIMITS = { major: 2000, minor: 99, patch: 99, preview: 98 } as const;

export function parseVersion(text: unknown): Version | null {
  if (typeof text !== 'string') return null;
  const match = PATTERN.exec(text);
  if (!match) return null;
  const version: Version = {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    preview: match[4] === undefined ? null : Number(match[4]),
  };
  if (version.major > VERSION_LIMITS.major) return null;
  if (version.preview !== null && version.preview > VERSION_LIMITS.preview) return null;
  return version;
}

export function formatVersion(version: Version): string {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  return version.preview === null ? base : `${base}-preview.${version.preview}`;
}

/** Negativo si a < b, 0 si son iguales, positivo si a > b. */
export function compareVersions(a: Version, b: Version): number {
  return (
    a.major - b.major ||
    a.minor - b.minor ||
    a.patch - b.patch ||
    // Una preliminar es anterior a la estable con los mismos números.
    (a.preview ?? Number.MAX_SAFE_INTEGER) - (b.preview ?? Number.MAX_SAFE_INTEGER)
  );
}

/**
 * Código de versión de Android: ((mayor·100 + menor)·100 + parche)·100 + n, con n = 99
 * para la estable y n = N para la preliminar N. Respeta el orden de las versiones.
 */
export function androidVersionCode(version: Version): number {
  return ((version.major * 100 + version.minor) * 100 + version.patch) * 100 + (version.preview ?? 99);
}
