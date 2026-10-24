// @vitest-environment node
/**
 * Datos compartidos con las apps de Android e iPhone (mobile/shared).
 *
 * Se generan a partir de la implementación de escritorio para que las tres
 * plataformas se comporten igual: las pruebas de Kotlin y de Swift leen los
 * mismos vectores. Para regenerarlos tras cambiar la lógica de escritorio:
 *   UPDATE_MOBILE_SHARED=1 npx vitest run electron/shared
 * Sin la variable, esta prueba falla si algún archivo no está al día.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findAliasMatch } from '../../src/services/alias-rules/resolution';
import { createDefaultAliasRules } from '../../src/services/alias-rules/rules';
import { buildSearchUrl } from '../../src/services/search/providers';
import { createDefaultShortcuts } from '../../src/services/shortcuts/shortcuts';
import { resolveInput } from '../../src/services/url-resolution/resolveInput';
import type { AliasRule } from '../../src/types/alias';
import type { SearchProviderId } from '../../src/types/settings';
import { BUILTIN_LIST_TEXT } from '../shield/builtinList';
import { getRegistrableDomain } from '../shield/domains';
import { FilterEngine } from '../shield/engine';
import { parseFilterList, type ResourceType } from '../shield/filters';
import { PUBLIC_SUFFIX_RULES } from '../shield/publicSuffixList';
import { es } from '../../src/i18n/es';
import { ACCENT_COLORS, THEME_ACCENTS } from '../../src/themes/accents';
import { THEME_IDS } from '../../src/types/settings';

const MOBILE_DIR = fileURLToPath(new URL('../../mobile/', import.meta.url));
const UPDATE = process.env.UPDATE_MOBILE_SHARED === '1';

/** Comprueba (o escribe, con UPDATE_MOBILE_SHARED=1) un archivo generado dentro de mobile/. */
function expectMobile(relativePath: string, content: string): void {
  const path = join(MOBILE_DIR, relativePath);
  if (UPDATE) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    return;
  }
  const hint = `mobile/${relativePath} no está al día: ejecuta UPDATE_MOBILE_SHARED=1 npx vitest run electron/shared`;
  expect(existsSync(path), hint).toBe(true);
  expect(readFileSync(path, 'utf8') === content, hint).toBe(true);
}

const expectShared = (name: string, content: string) => expectMobile(`shared/${name}`, content);

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const EPOCH = new Date('2026-01-01T00:00:00.000Z');

/* ------------------------------ Reglas de alias ------------------------------ */

function rule(id: string, fields: Pick<AliasRule, 'matchType' | 'pattern' | 'displayName' | 'alias' | 'targetUrl'> & { enabled?: boolean }): AliasRule {
  return { id, name: fields.displayName, enabled: true, createdAt: EPOCH.toISOString(), updatedAt: EPOCH.toISOString(), ...fields };
}

const DEFAULT_RULES = createDefaultAliasRules(EPOCH);
const VECTOR_RULES: AliasRule[] = [
  ...DEFAULT_RULES,
  rule('guia', { matchType: 'prefix', pattern: 'https://docs.ejemplo.com/guia', displayName: 'Guía', alias: 'guia.icarus', targetUrl: 'https://docs.ejemplo.com/guia' }),
  rule('org', { matchType: 'host', pattern: '*.ejemplo.org', displayName: 'Ejemplo ORG', alias: 'org.icarus', targetUrl: 'https://ejemplo.org/' }),
  rule('local', { matchType: 'exact', pattern: 'http://localhost:3000/', displayName: 'Servidor local', alias: 'local.icarus', targetUrl: 'http://localhost:3000/' }),
];

/* ---------------------------- Vectores de entrada ---------------------------- */

const INPUTS = [
  'google.com',
  'https://www.youtube.com',
  'https://www.wikipedia.org',
  'www.wikipedia.org',
  'EJEMPLO.COM',
  'ejemplo.com.',
  'ejemplo.com/ruta?x=1#parte',
  'ejemplo.com/ñandú',
  'https://ejemplo.com:443/',
  'http://ejemplo.com:80/a',
  'https://ejemplo.com:8443/a',
  'localhost',
  'localhost:3000',
  '127.0.0.1:8080/x',
  '192.168.1.1',
  '[::1]:8080',
  'café.com',
  'xn--caf-dma.com',
  'ejemplo.com:99999',
  'a.b',
  'hola',
  'hola mundo',
  '¿qué es ICARUS?',
  'cómo funciona javascript: en la web',
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  'file:///etc/passwd',
  'data:text/html,hola',
  'vbscript:msgbox',
  'ftp://ejemplo.com',
  'mailto:hola@ejemplo.com',
  'https://usuario:clave@ejemplo.com/',
  'https://buscar.icarus/',
  'buscar.icarus',
  'BUSCAR.ICARUS',
  'guia.icarus',
  'wiki.icarus',
  'nada.icarus',
  'icarus://nueva-pestana',
  'icarus://inicio',
  'icarus://historial',
  'icarus://configuracion',
  'icarus://en-blanco',
  'icarus://no-existe',
  '   ',
];

function resolveVectors(providerId: SearchProviderId) {
  return INPUTS.map((input) => {
    const result = resolveInput(input, { providerId, rules: VECTOR_RULES });
    switch (result.kind) {
      case 'url':
        return { input, kind: result.kind, url: result.url };
      case 'search':
        return { input, kind: result.kind, url: result.url };
      case 'alias':
        return { input, kind: result.kind, url: result.url, ruleId: result.rule.id };
      case 'alias-unresolved':
        return { input, kind: result.kind, alias: result.alias, reason: result.reason };
      case 'internal':
        return { input, kind: result.kind, page: result.page.kind };
      case 'blocked':
        return { input, kind: result.kind, protocol: result.protocol, dangerous: result.dangerous };
      default:
        return { input, kind: result.kind };
    }
  });
}

const SEARCH_QUERIES = ['icarus', 'hola mundo', 'café & té', 'a+b=c?', '¿qué es? 100%', "it's (fine) ~*!", 'cohete 🚀', '  espacios  '];

/* --------------------------- Coincidencia de alias --------------------------- */

const ALIAS_URLS = [
  'https://www.google.com/',
  'https://WWW.GOOGLE.COM/',
  'https://www.google.com/#seccion',
  'https://www.google.com/?q=x',
  'https://www.google.com/maps',
  'http://www.google.com/',
  'https://docs.ejemplo.com/guia',
  'https://docs.ejemplo.com/guia/capitulo-1',
  'https://docs.ejemplo.com/guia?pagina=2',
  'https://docs.ejemplo.com/guiax',
  'https://ejemplo.org/',
  'https://a.b.ejemplo.org/x',
  'http://ejemplo.org/',
  'https://ejemplo.org.otro.com/',
  'https://es.wikipedia.org/',
  'http://localhost:3000/',
  'http://localhost:3001/',
  'https://buscar.icarus/',
  'javascript:alert(1)',
];

/* ------------------------------ ICARUS Shield ------------------------------ */

const EXTRA_FILTERS = [
  '! Reglas de prueba de ICARUS Shield',
  '||ads.ejemplo.com^',
  '/banner/*/ad.$image',
  '||tracker.net^$script,third-party',
  '@@||tracker.net/permitido.js^',
  '||cdn.ejemplo.com^$domain=noticias.com|~deportes.noticias.com',
  '@@||sinbloqueo.com^$document',
  '/\\/pixel\\?id=\\d+/',
  '0.0.0.0 hosts-bloqueado.com',
  '-publicidad-$~image',
  '||ejemplo.com/anuncio.js|',
  '##.banner-cosmetico',
  'ejemplo.com#@#.anuncio',
  '||redireccion.com^$redirect=noop.js',
  '[Adblock Plus 2.0]',
  '/regex-roto(/',
];

const SHIELD_REQUESTS: Array<{ url: string; type: ResourceType; pageUrl: string }> = [
  { url: 'https://www.google-analytics.com/analytics.js', type: 'script', pageUrl: 'https://www.ejemplo.com/' },
  { url: 'https://www.google-analytics.com/analytics.js', type: 'script', pageUrl: 'https://analytics.google-analytics.com/' },
  { url: 'https://securepubads.g.doubleclick.net/tag/js/gpt.js', type: 'script', pageUrl: 'https://noticias.com/' },
  { url: 'https://securepubads.g.doubleclick.net/tag/js/gpt.js', type: 'document', pageUrl: 'https://noticias.com/' },
  { url: 'https://ads.ejemplo.com/x.png', type: 'image', pageUrl: 'https://www.ejemplo.com/' },
  { url: 'https://sub.ads.ejemplo.com/x.png', type: 'image', pageUrl: 'https://otra.com/' },
  { url: 'https://noads.ejemplo.com/x.png', type: 'image', pageUrl: 'https://otra.com/' },
  { url: 'https://img.otra.com/banner/300x250/ad.png', type: 'image', pageUrl: 'https://otra.com/' },
  { url: 'https://img.otra.com/banner/300x250/ad.png', type: 'script', pageUrl: 'https://otra.com/' },
  { url: 'https://tracker.net/t.js', type: 'script', pageUrl: 'https://otra.com/' },
  { url: 'https://tracker.net/t.js', type: 'script', pageUrl: 'https://tracker.net/' },
  { url: 'https://tracker.net/t.js', type: 'image', pageUrl: 'https://otra.com/' },
  { url: 'https://tracker.net/permitido.js', type: 'script', pageUrl: 'https://otra.com/' },
  { url: 'https://cdn.ejemplo.com/lib.js', type: 'script', pageUrl: 'https://noticias.com/' },
  { url: 'https://cdn.ejemplo.com/lib.js', type: 'script', pageUrl: 'https://www.noticias.com/' },
  { url: 'https://cdn.ejemplo.com/lib.js', type: 'script', pageUrl: 'https://deportes.noticias.com/' },
  { url: 'https://cdn.ejemplo.com/lib.js', type: 'script', pageUrl: 'https://otra.com/' },
  { url: 'https://www.google-analytics.com/analytics.js', type: 'script', pageUrl: 'https://sinbloqueo.com/' },
  { url: 'https://medidor.com/pixel?id=42', type: 'image', pageUrl: 'https://otra.com/' },
  { url: 'https://medidor.com/pixel?id=abc', type: 'image', pageUrl: 'https://otra.com/' },
  { url: 'https://hosts-bloqueado.com/x', type: 'xmlhttprequest', pageUrl: 'https://otra.com/' },
  { url: 'https://cdn.otra.com/js/-publicidad-.js', type: 'script', pageUrl: 'https://otra.com/' },
  { url: 'https://cdn.otra.com/img/-publicidad-.png', type: 'image', pageUrl: 'https://otra.com/' },
  { url: 'https://ejemplo.com/anuncio.js', type: 'script', pageUrl: 'https://otra.com/' },
  { url: 'https://ejemplo.com/anuncio.js?v=2', type: 'script', pageUrl: 'https://otra.com/' },
  { url: 'https://www.ejemplo.com/', type: 'subdocument', pageUrl: 'https://otra.com/' },
  { url: 'https://connect.facebook.net/es_ES/sdk.js', type: 'script', pageUrl: 'https://otra.com/' },
  { url: 'https://usuario.github.io/app.js', type: 'script', pageUrl: 'https://otro.github.io/' },
];

const REGISTRABLE_HOSTS = [
  'www.ejemplo.com',
  'a.b.ejemplo.com',
  'www.bbc.co.uk',
  'tienda.ejemplo.com.mx',
  'usuario.github.io',
  'github.io',
  'a.b.ck',
  'www.ck',
  'x.www.ck',
  'foo.bar.kawasaki.jp',
  'a.city.kawasaki.jp',
  'a.b.ejemplo.icarusprueba',
  'localhost',
  '192.168.1.1',
  'www.ejemplo.xn--55qx5d.cn',
  'WWW.EJEMPLO.COM.',
];

/* ---------------------------------- Estilos ---------------------------------- */

/** Tokens de color que usan las apps móviles (los mismos nombres que en CSS). */
const THEME_TOKENS = [
  'app-bg', 'tabstrip-bg', 'tab-active-bg', 'toolbar-bg', 'toolbar-border', 'omnibox-bg', 'omnibox-fg', 'omnibox-dim',
  'page-bg', 'surface-1', 'surface-2', 'border-1', 'border-2', 'fg-1', 'fg-2', 'fg-3', 'danger', 'success', 'warning',
] as const;

const readSource = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

/** Declaraciones `--token: valor;` del primer bloque cuyo selector es exactamente `selector`. */
function cssBlock(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No se encontró ${selector}`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) tokens[match[1]] = match[2].trim();
  return tokens;
}

/** #rgb, #rrggbb o rgba() → #RRGGBB / #RRGGBBAA (mismo orden que CSS). */
function toHex(value: string, token: string): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join('') : hex[1];
    return `#${digits.toUpperCase()}`;
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value);
  if (rgba) {
    const channels = rgba.slice(1, 4).map((n) => Number(n));
    const alpha = Math.round(Number(rgba[4] ?? 1) * 255);
    return `#${[...channels, alpha].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  }
  throw new Error(`Color no admitido en --${token}: ${value}`);
}

function themePalettes() {
  const base = readSource('src/styles/tokens.css');
  const baseLight = cssBlock(base, '.icarus-root');
  const baseDark = { ...baseLight, ...cssBlock(base, ".icarus-root[data-mode='dark']") };
  const themes: Record<string, unknown> = {};
  for (const id of THEME_IDS) {
    const css = readSource(`src/themes/${id}/theme.css`);
    const light = { ...baseLight, ...cssBlock(css, `.icarus-root[data-theme='${id}']`) };
    const dark = { ...baseDark, ...cssBlock(css, `.icarus-root[data-theme='${id}'][data-mode='dark']`) };
    const pick = (tokens: Record<string, string>, accent: string) =>
      Object.fromEntries([...THEME_TOKENS.map((token) => [token, toHex(tokens[token], token)]), ['accent', toHex(accent, 'accent')]]);
    themes[id] = {
      name: es.themes[id].name,
      description: es.themes[id].description,
      light: pick(light, THEME_ACCENTS[id].light),
      dark: pick(dark, THEME_ACCENTS[id].dark),
    };
  }
  const accents = Object.fromEntries(
    Object.entries(ACCENT_COLORS).map(([id, pair]) => [id, { light: toHex(pair.light, id), dark: toHex(pair.dark, id) }]),
  );
  return { description: 'Colores de cada estilo, generados desde src/styles/tokens.css y src/themes/*/theme.css.', themes, accents };
}

/* ---------------------------------- Iconos ---------------------------------- */

const ANDROID_DRAWABLES = 'android/app/src/main/res/drawable';

/** Lee los iconos de trazo de src/components/common/Icon.tsx: nombre → elementos SVG. */
function desktopIcons(): Map<string, Array<{ tag: string; attrs: Record<string, string> }>> {
  const source = readSource('src/components/common/Icon.tsx');
  const body = source.slice(source.indexOf('const ICONS = {'), source.indexOf('} satisfies'));
  const icons = new Map<string, Array<{ tag: string; attrs: Record<string, string> }>>();
  const entries = [...body.matchAll(/^ {2}(\w+): /gm)];
  entries.forEach((entry, index) => {
    const chunk = body.slice(entry.index, entries[index + 1]?.index ?? body.length);
    const elements = [...chunk.matchAll(/<(path|circle|rect|ellipse)\s+([^>]*?)\s*\/>/g)].map((element) => ({
      tag: element[1],
      attrs: Object.fromEntries([...element[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((attr) => [attr[1], attr[2]])),
    }));
    if (elements.length === 0) throw new Error(`Icono sin elementos: ${entry[1]}`);
    icons.set(entry[1], elements);
  });
  return icons;
}

/** Convierte un elemento SVG en pathData de VectorDrawable (los arcos se admiten). */
function toPathData({ tag, attrs }: { tag: string; attrs: Record<string, string> }): string {
  const n = (name: string) => Number(attrs[name] ?? 0);
  const f = (value: number) => String(Math.round(value * 1000) / 1000);
  switch (tag) {
    case 'path':
      return attrs.d;
    case 'circle':
    case 'ellipse': {
      const rx = tag === 'circle' ? n('r') : n('rx');
      const ry = tag === 'circle' ? n('r') : n('ry');
      return `M${f(n('cx') - rx)},${f(n('cy'))}a${f(rx)},${f(ry)} 0 1,0 ${f(2 * rx)},0a${f(rx)},${f(ry)} 0 1,0 ${f(-2 * rx)},0z`;
    }
    case 'rect': {
      const [x, y, w, h, r] = [n('x'), n('y'), n('width'), n('height'), n('rx')];
      if (!r) return `M${f(x)},${f(y)}h${f(w)}v${f(h)}h${f(-w)}z`;
      const arc = (dx: number, dy: number) => `a${f(r)},${f(r)} 0 0,1 ${f(dx)},${f(dy)}`;
      return `M${f(x + r)},${f(y)}h${f(w - 2 * r)}${arc(r, r)}v${f(h - 2 * r)}${arc(-r, r)}h${f(-(w - 2 * r))}${arc(-r, -r)}v${f(-(h - 2 * r))}${arc(r, -r)}z`;
    }
    default:
      throw new Error(`Elemento no admitido: ${tag}`);
  }
}

const snakeCase = (name: string) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

function androidVector(name: string, elements: Array<{ tag: string; attrs: Record<string, string> }>): string {
  const paths = elements.map((element) => {
    const filled = element.attrs.fill === 'currentColor';
    return [
      '    <path',
      `        android:fillColor="${filled ? '#FF000000' : '#00000000'}"`,
      `        android:pathData="${toPathData(element)}"`,
      '        android:strokeColor="#FF000000"',
      '        android:strokeLineCap="round"',
      '        android:strokeLineJoin="round"',
      '        android:strokeWidth="1.8" />',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<!-- Icono «${name}» generado desde src/components/common/Icon.tsx (electron/shared/mobileShared.test.ts). -->`,
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    '    android:width="24dp"',
    '    android:height="24dp"',
    '    android:viewportWidth="24"',
    '    android:viewportHeight="24">',
    ...paths,
    '</vector>',
    '',
  ].join('\n');
}

describe('datos compartidos con las apps móviles', () => {
  it('vectores de la barra de direcciones', () => {
    const providers: SearchProviderId[] = ['google', 'bing', 'duckduckgo'];
    expectShared(
      'test-vectors/resolve-input.json',
      json({
        description: 'Entrada de la barra de direcciones → resultado (generado desde la versión de escritorio).',
        rules: VECTOR_RULES,
        cases: resolveVectors('google'),
        search: providers.flatMap((providerId) => SEARCH_QUERIES.map((query) => ({ providerId, query, url: buildSearchUrl(providerId, query) }))),
      }),
    );
  });

  it('vectores de alias', () => {
    expectShared(
      'test-vectors/alias-match.json',
      json({
        description: 'URL real → regla de alias que se muestra (o null).',
        rules: VECTOR_RULES,
        cases: ALIAS_URLS.map((url) => {
          const match = findAliasMatch(url, VECTOR_RULES);
          return { url, ruleId: match?.rule.id ?? null, realUrl: match?.realUrl ?? null };
        }),
      }),
    );
  });

  it('vectores de ICARUS Shield', () => {
    const listText = `${BUILTIN_LIST_TEXT}\n${EXTRA_FILTERS.join('\n')}`;
    const parsed = parseFilterList(listText);
    const engine = new FilterEngine(parsed.filters);
    expectShared(
      'test-vectors/shield-match.json',
      json({
        description: 'Lista de filtros y solicitudes → bloqueada o no (motor de escritorio).',
        list: listText,
        counts: { rules: parsed.ruleCount, ignored: parsed.ignoredCount, invalid: parsed.invalidCount },
        requests: SHIELD_REQUESTS.map((request) => ({ ...request, blocked: engine.match(request).blocked })),
      }),
    );
  });

  it('vectores de dominio registrable', () => {
    expectShared(
      'test-vectors/registrable-domain.json',
      json({
        description: 'Nombre de host → dominio registrable (Public Suffix List).',
        cases: REGISTRABLE_HOSTS.map((host) => ({ host, domain: getRegistrableDomain(host) })),
      }),
    );
  });

  it('textos compartidos', () => {
    const { form } = es.aliasManager;
    expectShared(
      'strings.json',
      json({
        description: 'Textos de escritorio (src/i18n/es.ts) que reutilizan las apps móviles.',
        aliasErrors: es.aliasManager.errors,
        shortcutErrors: es.shortcuts.errors,
        shieldListErrors: es.shield.settings.errors,
        aliasManager: {
          title: es.aliasManager.title,
          subtitle: es.aliasManager.subtitle,
          priorityNote: es.aliasManager.priorityNote,
          matchTypes: form.matchTypes,
          matchHints: form.matchHints,
          patternPlaceholders: form.patternPlaceholders,
          aliasHint: form.aliasHint,
          targetHint: form.targetHint,
          displayNameHint: form.displayNameHint,
        },
        shield: { intro: es.shield.settings.intro, listsHint: es.shield.settings.listsHint, customHint: es.shield.settings.customHint },
      }),
    );
  });

  it('iconos de Android', () => {
    const icons = desktopIcons();
    expect(icons.size).toBeGreaterThan(40);
    for (const [name, elements] of icons) expectMobile(`${ANDROID_DRAWABLES}/icarus_${snakeCase(name)}.xml`, androidVector(name, elements));
  });

  it('paletas de los estilos', () => {
    expectShared('themes.json', json(themePalettes()));
  });

  it('listas y valores predeterminados', () => {
    expectShared('shield-basic.txt', `${BUILTIN_LIST_TEXT}\n`);
    expectShared(
      'public-suffix-rules.txt',
      `// Public Suffix List (https://publicsuffix.org/) en ASCII, generada desde electron/shield/publicSuffixList.ts.\n// Mozilla Public License 2.0: https://mozilla.org/MPL/2.0/\n${PUBLIC_SUFFIX_RULES}\n`,
    );
    expectShared(
      'defaults.json',
      json({
        shortcuts: createDefaultShortcuts(EPOCH).map(({ id, title, url }) => ({ id, title, url })),
        aliasRules: DEFAULT_RULES,
      }),
    );
  });
});
