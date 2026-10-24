/**
 * Analizador de filtros de red con la sintaxis de Adblock Plus / EasyList y el
 * formato hosts. Admite el subconjunto que puede aplicarse con seguridad al
 * bloquear solicitudes; el resto se ignora y se contabiliza.
 *
 * Admitido:
 *   ||dominio^   |inicio   final|   *   ^   /expresión regular/
 *   @@excepciones
 *   $third-party $first-party $domain= $match-case $important $all
 *   $script $image $stylesheet $xmlhttprequest $subdocument $media $font
 *   $object $ping $websocket $other (y su negación con ~)
 *   @@...$document (excepción para toda la página)
 *   0.0.0.0 dominio / 127.0.0.1 dominio (formato hosts)
 *
 * Ignorado (contado como `ignored`): comentarios, cabeceras, filtros
 * cosméticos (##, #@#, #?#…) y filtros con opciones que cambian el
 * comportamiento (redirect, csp, removeparam, popup…), porque aplicarlos como
 * un bloqueo simple podría romper páginas.
 */

export const RESOURCE_TYPES = [
  'document',
  'subdocument',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'media',
  'websocket',
  'other',
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export interface DomainConstraint {
  include: string[];
  exclude: string[];
}

export interface NetworkFilter {
  raw: string;
  exception: boolean;
  /** Excepción que desactiva el bloqueo en toda la página ($document). */
  documentException: boolean;
  /** Dominio de un filtro `||dominio^` sencillo (se indexa por host). */
  hostname: string | null;
  regex: RegExp | null;
  /** Fragmento literal que debe aparecer en la URL (índice). */
  token: string | null;
  thirdParty: boolean | null;
  types: Set<ResourceType> | null;
  excludedTypes: Set<ResourceType> | null;
  domains: DomainConstraint | null;
}

export type ParseOutcome =
  | { kind: 'filter'; filter: NetworkFilter }
  | { kind: 'ignored' }
  | { kind: 'invalid' }
  | { kind: 'empty' };

const TYPE_ALIASES: Record<string, ResourceType> = {
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  css: 'stylesheet',
  xmlhttprequest: 'xmlhttprequest',
  xhr: 'xmlhttprequest',
  subdocument: 'subdocument',
  frame: 'subdocument',
  media: 'media',
  font: 'font',
  object: 'object',
  ping: 'ping',
  beacon: 'ping',
  websocket: 'websocket',
  other: 'other',
  document: 'document',
  doc: 'document',
};

/** Opciones que cambian el efecto del filtro: no se aplican como bloqueo simple. */
const UNSUPPORTED_OPTIONS = new Set([
  'redirect', 'redirect-rule', 'csp', 'removeparam', 'queryprune', 'popup', 'popunder', 'rewrite', 'header',
  'permissions', 'replace', 'urltransform', 'uritransform', 'badfilter', 'denyallow', 'to', 'method', 'strict1p',
  'strict3p', 'empty', 'mp4', 'elemhide', 'ehide', 'generichide', 'ghide', 'specifichide', 'shide', 'genericblock',
  'inline-script', 'inline-font', 'cname', 'webrtc', 'sitekey', 'jsinject', 'content', 'urlblock', 'extension',
  'stealth', 'cookie', 'network', 'app', 'hls', 'jsonprune', 'referrerpolicy',
]);

const HOSTS_LINE = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1?|::)\s+([^\s#]+)/;
const HOSTNAME = /^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)+$/;
const HOSTS_SKIP = new Set(['localhost', 'localhost.localdomain', 'local', 'broadcasthost', '0.0.0.0', 'ip6-localhost', 'ip6-loopback']);
const SEPARATOR = '(?:[^\\w.%-]|$)';
const TOKEN = /[a-z0-9%]{2,}/g;
/** Fragmentos demasiado frecuentes para servir de índice. */
const COMMON_TOKENS = new Set(['http', 'https', 'www', 'com', 'net', 'org', 'js', 'html', 'php', 'cdn', 'static', 'img']);

function baseFilter(raw: string): NetworkFilter {
  return {
    raw,
    exception: false,
    documentException: false,
    hostname: null,
    regex: null,
    token: null,
    thirdParty: null,
    types: null,
    excludedTypes: null,
    domains: null,
  };
}

function escapeRegex(text: string): string {
  return text.replace(/[.+?${}()|[\]\\]/g, '\\$&');
}

/** Convierte el patrón ABP en una expresión regular. */
function patternToRegex(pattern: string, matchCase: boolean): RegExp {
  let source = pattern;
  let prefix = '';
  let suffix = '';
  if (source.startsWith('||')) {
    source = source.slice(2);
    prefix = '^[a-z][a-z0-9+.-]*:\\/+(?:[^\\/?#]*\\.)?';
  } else if (source.startsWith('|')) {
    source = source.slice(1);
    prefix = '^';
  }
  if (source.endsWith('|')) {
    source = source.slice(0, -1);
    suffix = '$';
  }
  source = source.replace(/^\*+/, '').replace(/\*+$/, '');
  const body = source
    .split('')
    .map((char) => (char === '*' ? '.*' : char === '^' ? SEPARATOR : escapeRegex(char)))
    .join('');
  return new RegExp(prefix + body + suffix, matchCase ? '' : 'i');
}

/**
 * Elige un fragmento literal completo (delimitado por separadores en el patrón)
 * para indexar el filtro. Si no hay ninguno seguro, el filtro es genérico.
 */
function pickToken(pattern: string): string | null {
  const lower = pattern.toLowerCase();
  let best: string | null = null;
  for (const match of lower.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const before = lower.slice(Math.max(0, start - 2), start);
    const prevChar = lower.charAt(start - 1);
    const nextChar = lower.charAt(end);
    const startsClean =
      start === 0 ? false : before.endsWith('||') || (prevChar !== '*' && !/[a-z0-9%]/.test(prevChar));
    const startAnchored = start === 1 && lower.charAt(0) === '|';
    const endsClean =
      end === lower.length ? false : nextChar !== '*' && (nextChar === '^' || !/[a-z0-9%]/.test(nextChar)) && nextChar !== '|';
    const endAnchored = end === lower.length - 1 && lower.charAt(end) === '|';
    if ((startsClean || startAnchored) && (endsClean || endAnchored) && !COMMON_TOKENS.has(match[0])) {
      if (!best || match[0].length > best.length) best = match[0];
    }
  }
  return best;
}

function parseDomains(value: string): DomainConstraint | null {
  const include: string[] = [];
  const exclude: string[] = [];
  for (const part of value.split('|')) {
    const domain = part.trim().toLowerCase();
    if (!domain) continue;
    if (domain.startsWith('~')) exclude.push(domain.slice(1));
    else include.push(domain);
  }
  if (include.some((d) => d.includes('*') || d.startsWith('/')) || exclude.some((d) => d.includes('*') || d.startsWith('/'))) {
    return null;
  }
  return { include, exclude };
}

export function parseFilter(line: string): ParseOutcome {
  const raw = line.trim();
  if (!raw) return { kind: 'empty' };
  // Comentarios (ABP «!», hosts «#»), cabeceras «[Adblock Plus 2.0]» y filtros cosméticos.
  if (raw.startsWith('!') || raw.startsWith('[') || (raw.startsWith('#') && !raw.startsWith('##'))) return { kind: 'ignored' };
  if (/#@?[#?$%]#?|#\+js\(/.test(raw) && !raw.startsWith('/')) return { kind: 'ignored' };

  const hosts = HOSTS_LINE.exec(raw);
  if (hosts) {
    const host = hosts[1]!.toLowerCase().replace(/\.$/, '');
    if (HOSTS_SKIP.has(host) || !HOSTNAME.test(host)) return { kind: 'ignored' };
    const filter = baseFilter(raw);
    filter.hostname = host;
    return { kind: 'filter', filter };
  }

  const filter = baseFilter(raw);
  let text = raw;
  if (text.startsWith('@@')) {
    filter.exception = true;
    text = text.slice(2);
  }

  let options = '';
  if (text.startsWith('/') && /\/\$[^/]*$/.test(text)) {
    const index = text.lastIndexOf('/$');
    options = text.slice(index + 2);
    text = text.slice(0, index + 1);
  } else if (!(text.startsWith('/') && text.endsWith('/') && text.length > 2)) {
    const index = text.lastIndexOf('$');
    // Las opciones empiezan por un nombre (p. ej. «third-party», «csp=…»); su valor puede contener espacios.
    if (index >= 0 && /^~?[a-z0-9_-]+(=|,|$)/i.test(text.slice(index + 1))) {
      options = text.slice(index + 1);
      text = text.slice(0, index);
    }
  }

  let matchCase = false;
  if (options) {
    const included = new Set<ResourceType>();
    const excluded = new Set<ResourceType>();
    for (const rawOption of options.split(',')) {
      const option = rawOption.trim().toLowerCase();
      if (!option) continue;
      const separator = option.indexOf('=');
      const name = separator >= 0 ? option.slice(0, separator) : option;
      const value = separator >= 0 ? option.slice(separator + 1) : '';
      const negated = name.startsWith('~');
      const key = negated ? name.slice(1) : name;
      if (key === 'third-party' || key === '3p') filter.thirdParty = !negated;
      else if (key === 'first-party' || key === '1p') filter.thirdParty = negated;
      else if (key === 'domain' || key === 'from') {
        const domains = parseDomains(value);
        if (!domains) return { kind: 'ignored' };
        filter.domains = domains;
      } else if (key === 'match-case') matchCase = true;
      else if (key === 'important' || key === 'all') {
        // «important» no cambia el resultado en ICARUS: las excepciones siguen ganando.
      } else if (key in TYPE_ALIASES) {
        const type = TYPE_ALIASES[key]!;
        (negated ? excluded : included).add(type);
      } else {
        // Opción no admitida (redirect, csp, popup…) o desconocida: se ignora el filtro completo.
        void UNSUPPORTED_OPTIONS;
        return { kind: 'ignored' };
      }
    }
    if (included.has('document')) {
      if (!filter.exception) return { kind: 'ignored' };
      filter.documentException = true;
      included.delete('document');
    }
    if (included.size > 0) filter.types = included;
    if (excluded.size > 0) filter.excludedTypes = excluded;
  }

  const pattern = text.trim();
  if (!pattern || pattern === '*' || pattern === '||' || pattern === '|') {
    // Un filtro sin patrón solo tiene sentido si las opciones lo acotan a dominios.
    if (!filter.domains || filter.domains.include.length === 0) return { kind: 'invalid' };
    filter.regex = /.*/;
    return { kind: 'filter', filter };
  }

  if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
    try {
      filter.regex = new RegExp(pattern.slice(1, -1), matchCase ? '' : 'i');
    } catch {
      return { kind: 'invalid' };
    }
    return { kind: 'filter', filter };
  }

  const simpleHost = /^\|\|([a-z0-9_.-]+)\^?$/i.exec(pattern);
  if (simpleHost && HOSTNAME.test(simpleHost[1]!.toLowerCase())) {
    filter.hostname = simpleHost[1]!.toLowerCase();
    return { kind: 'filter', filter };
  }

  if (/\s/.test(pattern)) return { kind: 'invalid' };
  try {
    filter.regex = patternToRegex(pattern, matchCase);
  } catch {
    return { kind: 'invalid' };
  }
  filter.token = pickToken(pattern);
  return { kind: 'filter', filter };
}

export interface ParsedList {
  filters: NetworkFilter[];
  ruleCount: number;
  ignoredCount: number;
  invalidCount: number;
}

export function parseFilterList(text: string): ParsedList {
  const filters: NetworkFilter[] = [];
  let ignoredCount = 0;
  let invalidCount = 0;
  for (const line of text.split(/\r?\n/)) {
    const outcome = parseFilter(line);
    if (outcome.kind === 'filter') filters.push(outcome.filter);
    else if (outcome.kind === 'ignored') ignoredCount += 1;
    else if (outcome.kind === 'invalid') invalidCount += 1;
  }
  return { filters, ruleCount: filters.length, ignoredCount, invalidCount };
}

/** ¿Parece el texto descargado una página HTML en lugar de una lista de filtros? */
export function looksLikeHtml(text: string): boolean {
  return /^\s*(<!doctype html|<html|<head|<body)/i.test(text.slice(0, 512));
}
