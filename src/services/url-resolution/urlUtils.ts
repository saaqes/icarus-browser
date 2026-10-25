/**
 * Utilidades de URL compartidas por la barra de direcciones, los accesos directos
 * y las direcciones personalizadas. Solo se consideran navegables las URL http(s).
 */

export const WEB_PROTOCOLS = ['http:', 'https:'] as const;

/** Protocolos que nunca se abren porque pueden ejecutar código o leer datos locales. */
export const DANGEROUS_PROTOCOLS = ['javascript:', 'data:', 'vbscript:', 'file:', 'blob:'] as const;

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6_BRACKETED = /^\[[0-9a-f:.]+\]$/i;
const DOMAIN = /^(?=.{1,253}$)(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?:\p{L}{2,63}|xn--[a-z0-9-]{1,59})\.?$/iu;
const PORT = /^\d{1,5}$/;

export function isWebUrl(url: URL): boolean {
  return (WEB_PROTOCOLS as readonly string[]).includes(url.protocol) && url.hostname.length > 0;
}

/** Analiza una URL absoluta http(s). Devuelve null para cualquier otro protocolo. */
export function parseWebUrl(text: string): URL | null {
  try {
    const url = new URL(text.trim());
    return isWebUrl(url) ? url : null;
  } catch {
    return null;
  }
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost') || /^127\./.test(host) || host === '[::1]';
}

export function isIpLiteral(hostname: string): boolean {
  return IPV4.test(hostname) || IPV6_BRACKETED.test(hostname);
}

/** ¿Parece `texto` un host con puerto opcional (ej. `ejemplo.com`, `localhost:3000`)? */
export function looksLikeHost(text: string): boolean {
  if (!text || text.includes('@')) return false;
  let host = text;
  const portMatch = /^(.*):([^:\]]*)$/.exec(text);
  if (portMatch && !IPV6_BRACKETED.test(text)) {
    if (!PORT.test(portMatch[2] ?? '')) return false;
    host = portMatch[1] ?? '';
  }
  return host.toLowerCase() === 'localhost' || IPV4.test(host) || IPV6_BRACKETED.test(host) || DOMAIN.test(host);
}

export function getProtocol(text: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(text.trim());
  return match ? `${match[1]!.toLowerCase()}:` : null;
}

export function isDangerousProtocol(protocol: string): boolean {
  return (DANGEROUS_PROTOCOLS as readonly string[]).includes(protocol.toLowerCase());
}

export type NormalizeUrlFailure = 'empty' | 'unsafe-protocol' | 'unsupported-protocol' | 'invalid';
export type NormalizeUrlResult = { ok: true; url: string; parsed: URL } | { ok: false; reason: NormalizeUrlFailure };

/**
 * Normaliza una URL escrita por el usuario en formularios (accesos directos,
 * página principal). Acepta `ejemplo.com` y lo convierte en
 * `https://ejemplo.com/`. Rechaza protocolos peligrosos.
 */
export function normalizeUserUrl(text: string): NormalizeUrlResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  if (/\s/.test(trimmed)) return { ok: false, reason: 'invalid' };

  const protocol = getProtocol(trimmed);
  const hasPortInsteadOfScheme = protocol !== null && /^[^:/]+:\d+(?:[/?#]|$)/.test(trimmed);
  let candidate = trimmed;

  if (protocol && !hasPortInsteadOfScheme) {
    if (isDangerousProtocol(protocol)) return { ok: false, reason: 'unsafe-protocol' };
    if (!(WEB_PROTOCOLS as readonly string[]).includes(protocol)) return { ok: false, reason: 'unsupported-protocol' };
  } else {
    const hostPart = trimmed.split(/[/?#]/)[0] ?? '';
    if (!looksLikeHost(hostPart)) return { ok: false, reason: 'invalid' };
    const bareHost = hostPart.replace(/:\d+$/, '');
    candidate = `${isLoopbackHost(bareHost) || isIpLiteral(bareHost) ? 'http' : 'https'}://${trimmed}`;
  }

  const parsed = parseWebUrl(candidate);
  if (!parsed) return { ok: false, reason: 'invalid' };
  if (parsed.username || parsed.password) return { ok: false, reason: 'invalid' };
  return { ok: true, url: parsed.href, parsed };
}

export function getHostname(href: string): string | null {
  return parseWebUrl(href)?.hostname ?? null;
}
