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
import { formatAddress, shortAddress } from '../../src/services/custom-addresses/display';
import { displayUrlFor } from '../../src/services/custom-addresses/mapping';
import { classifyAddressEdit, joinBase, splitAddress } from '../../src/services/custom-addresses/rebase';
import { parseSections, sectionOf } from '../../src/services/custom-addresses/sections';
import { convertLegacyRule, sanitizeCustomAddresses, saveSectionAddress } from '../../src/services/custom-addresses/store';
import { validateCustomAddressInput } from '../../src/services/custom-addresses/validation';
import { buildSearchUrl } from '../../src/services/search/providers';
import { createDefaultShortcuts } from '../../src/services/shortcuts/shortcuts';
import { resolveInput } from '../../src/services/url-resolution/resolveInput';
import type { CustomAddress, CustomAddressInput } from '../../src/types/customAddress';
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
  // Git para Windows puede convertir los saltos de línea (y los de las fuentes) a CRLF.
  const lf = (text: string) => text.replace(/\r\n/g, '\n');
  expect(lf(readFileSync(path, 'utf8')) === lf(content), hint).toBe(true);
}

const expectShared = (name: string, content: string) => expectMobile(`shared/${name}`, content);

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const EPOCH = new Date('2026-01-01T00:00:00.000Z');

/* ------------------------- Direcciones personalizadas ------------------------- */

function entry(id: string, target: string, address: string, enabled = true, sections?: string[]): CustomAddress {
  return { id, target, address, ...(sections ? { sections } : {}), enabled, createdAt: EPOCH.toISOString(), updatedAt: EPOCH.toISOString() };
}

const VECTOR_ENTRIES: CustomAddress[] = [
  entry('deriv', 'https://bot.deriv.me/', 'https://miweb.com/'),
  entry('local', 'http://localhost:3000/', 'http://miapp.com/v2'),
  entry('docs', 'https://ejemplo.com/docs', 'https://docs.miweb.org/'),
  entry('migrada', 'https://es.wikipedia.org/', 'https://wiki.icarus/'),
  entry('apagada', 'https://apagada.com/', 'https://desactivada.com/', false),
  // Otra dirección para unas secciones del mismo sitio que «deriv».
  entry('deriv-secciones', 'https://bot.deriv.me/', 'https://otrodominio.com/', true, ['home', 'usuario']),
];

/* ------------------------- Edición de la base ------------------------- */

const REBASE_CASES: Array<{ shown: string; entryId: string | null; bases: string[]; typed: string[] }> = [
  {
    shown: 'https://miweb.com/#inicio',
    entryId: 'deriv',
    bases: ['https://otrapagina.com', 'otrapagina.com/', 'OTRAPAGINA.com', 'otrapagina.com/#x', 'otra pagina', 'javascript:alert(1)', ''],
    typed: ['https://otrapagina.com/#inicio', 'otrapagina.com/#inicio', 'otrapagina.com', 'https://otrapagina.com/#dashboard', 'miweb.com/#inicio', 'buscar algo #inicio'],
  },
  { shown: 'https://miweb.com/#dashboard', entryId: 'deriv', bases: ['otrapagina.com'], typed: ['otrapagina.com/#dashboard'] },
  { shown: 'https://miweb.com/#bot_builder', entryId: 'deriv', bases: ['otrapagina.com'], typed: [] },
  { shown: 'https://miweb.com/#chart', entryId: 'deriv', bases: ['otrapagina.com'], typed: [] },
  { shown: 'https://miweb.com/panel/usuarios?id=10', entryId: 'deriv', bases: ['otrapagina.com', 'localhost:3000'], typed: ['otra.com/panel/usuarios?id=10', 'otra.com/x/panel/usuarios?id=10'] },
  { shown: 'https://miweb.com/', entryId: 'deriv', bases: ['otrapagina.com'], typed: ['otrapagina.com/'] },
  { shown: 'https://miweb.com/a/b/?x=1&y=%202#parte', entryId: 'deriv', bases: ['otra.com'], typed: [] },
  { shown: 'http://miapp.com/v2/panel?id=10#top', entryId: 'local', bases: ['nueva.com/v3/', 'https://nueva.com'], typed: ['nueva.com/v3/panel?id=10#top'] },
  { shown: 'http://miapp.com/v2#top', entryId: 'local', bases: ['nueva.com/v3'], typed: [] },
  { shown: 'http://localhost:3000/a/b/c/', entryId: null, bases: ['localhost:4000', '127.0.0.1:8080'], typed: ['localhost:4000/a/b/c/'] },
  { shown: 'https://ejemplo.com/p?utm_source=x&utm_medium=y#s', entryId: null, bases: ['otra.com'], typed: [] },
  { shown: 'https://ejemplo.com/caf%C3%A9/se%C3%B1al?q=%C3%B1', entryId: null, bases: ['otra.com'], typed: [] },
  { shown: 'https://ejemplo.com/', entryId: null, bases: ['otra.com'], typed: ['otra.com'] },
  { shown: 'icarus://configuracion', entryId: null, bases: [], typed: [] },
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
  'bot.deriv.me',
  'icarus.marketing',
  'miweb.com',
  'otrodominio.com',
  'otrodominio.com/#usuario',
  'OTRODOMINIO.COM/panel#inicio',
  'MIWEB.COM/Panel?x=1#a',
  'https://miweb.com/ruta',
  'http://miweb.com/',
  'miapp.com/v2/api',
  'https://miapp.com/v2',
  'miapp.com/v1',
  'docs.miweb.org/guia',
  'wiki.icarus',
  'https://buscar.icarus/',
  'buscar.icarus',
  'desactivada.com',
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
    const result = resolveInput(input, { providerId, customAddresses: VECTOR_ENTRIES });
    switch (result.kind) {
      case 'url':
        return { input, kind: result.kind, url: result.url };
      case 'search':
        return { input, kind: result.kind, url: result.url };
      case 'custom':
        return { input, kind: result.kind, url: result.url, address: result.address, entryId: result.entry.id };
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

/* ------------------------ Dirección que muestra la barra ------------------------ */

const DISPLAY_URLS = [
  'https://bot.deriv.me/',
  'https://BOT.DERIV.ME/panel/a?x=1&y=2#z',
  'https://bot.deriv.me:443/x',
  'http://bot.deriv.me/',
  'https://x.bot.deriv.me/',
  'https://ejemplo.com/docs',
  'https://ejemplo.com/docs/',
  'https://ejemplo.com/docs/guia?p=2',
  'https://ejemplo.com/docsx',
  'https://ejemplo.com/',
  'http://localhost:3000/',
  'http://localhost:3000/api?q=1',
  'https://localhost:3000/',
  'https://es.wikipedia.org/wiki/%C3%8Dcaro',
  'https://apagada.com/',
  'https://www.google.com/',
  'https://www.google.com/search?q=icarus',
  'http://www.ejemplo.com/a/',
  'https://usuario:clave@bot.deriv.me/',
  'javascript:alert(1)',
  // Secciones: #home y #usuario se muestran con otrodominio.com; el resto, con miweb.com.
  'https://bot.deriv.me/#inicio',
  'https://bot.deriv.me/#catalogo',
  'https://bot.deriv.me/#home',
  'https://bot.deriv.me/#HOME',
  'https://bot.deriv.me/panel?x=1#/usuario/10',
  'https://bot.deriv.me/#!/home',
  'https://bot.deriv.me/#home-2',
];

/* ------------------------- Validación y conflictos ------------------------- */

const VALIDATION_CASES: Array<CustomAddressInput & { editingId?: string }> = [
  { target: 'bot.deriv.me', address: 'miweb.com', enabled: true, editingId: 'deriv' },
  { target: 'https://bot.deriv.me', address: 'https://otraweb.com/', enabled: true, editingId: 'deriv' },
  { target: 'localhost:3000', address: 'miapp.com', enabled: true, editingId: 'local' },
  { target: 'https://ejemplo.com/ruta/', address: 'icarus.marketing', enabled: true },
  { target: 'nuevo.com', address: 'nueva.com', enabled: true },
  { target: '', address: '', enabled: true },
  { target: 'no es url', address: 'palabra', enabled: true },
  { target: 'javascript:alert(1)', address: 'ftp://a.com', enabled: true },
  { target: 'https://a.com/?x=1', address: 'b.com#c', enabled: true },
  { target: 'http://intranet.ejemplo.com', address: 'https://miweb2.com', enabled: true },
  { target: 'https://a.com', address: 'a.com/b', enabled: true },
  { target: 'bot.deriv.me/panel', address: 'otra.com', enabled: true },
  { target: 'otro.com', address: 'miweb.com/x', enabled: true },
  { target: 'miweb.com', address: 'nueva2.com', enabled: true },
  { target: 'nuevo2.com', address: 'bot.deriv.me', enabled: true },
  { target: 'https://ejemplo.com/blog', address: 'blog.miweb.org', enabled: true },
  { target: 'bot.deriv.me', address: 'otra.com', enabled: false },
  // Secciones: conviven con la general del mismo destino; no se repiten ni se mezclan.
  { target: 'bot.deriv.me', address: 'tercera.com', sections: '#perfil, #Ajustes', enabled: true },
  { target: 'bot.deriv.me', address: 'tercera.com', sections: '#perfil #home', enabled: true },
  { target: 'bot.deriv.me', address: 'otrodominio.com', sections: '#home #usuario #ayuda', enabled: true, editingId: 'deriv-secciones' },
  { target: 'bot.deriv.me', address: 'miweb.com', sections: '#perfil', enabled: true },
  { target: 'bot.deriv.me', address: 'tercera.com', sections: '#a/b', enabled: true },
  { target: 'bot.deriv.me', address: 'tercera.com', sections: Array.from({ length: 21 }, (_, n) => `#s${n}`).join(' '), enabled: true },
  { target: 'bot.deriv.me', address: 'otrodominio.com', sections: '', enabled: true, editingId: 'deriv-secciones' },
];

/* ------------------------------ Secciones (#) ------------------------------ */

const SECTION_FRAGMENTS = ['', '#', '#/', '#inicio', '#HOME', '#/usuario/10', '#!/home', '#catalogo?pagina=2', '#tab=2', '#cat%C3%A1logo', '#mal%ZZ', '#🚀', '#home-2.v~1_x'];
const SECTION_TEXTS = ['', '#', '#home, #usuario', '#Home usuario;#/catalogo, #home', 'home #a/b', '#ho me?', '#cat%C3%A1logo #niño', Array.from({ length: 21 }, (_, n) => `#s${n}`).join(' ')];

/** «Guardar solo para #sección», uno tras otro desde VECTOR_ENTRIES (cada uno parte del resultado anterior si fue bien). */
const SECTION_SAVES = [
  { section: 'perfil', base: 'tercera.com', id: 's1' },
  { section: 'ajustes', base: 'https://tercera.com/', id: 's2' },
  { section: 'home', base: 'tercera.com', id: 's3' },
  { section: 'usuario', base: 'miweb.com', id: 's4' },
  { section: 'perfil', base: 'desactivada.com', id: 's5' },
  { section: 'perfil', base: 'docs.miweb.org', id: 's6' },
  { section: 'perfil', base: 'tercera.com/#x', id: 's7' },
];

/** Reglas de alias guardadas por versiones anteriores (se convierten al leerlas). */
const LEGACY_RULES = [
  { id: 'default-search', name: 'Página de búsqueda', matchType: 'exact', pattern: 'https://www.google.com/', displayName: 'Buscar', alias: 'buscar.icarus', targetUrl: 'https://www.google.com/', enabled: true },
  { id: 'default-wiki', name: 'Enciclopedia', matchType: 'host', pattern: 'es.wikipedia.org', displayName: 'Wikipedia', alias: 'wiki.icarus', targetUrl: 'https://es.wikipedia.org/', enabled: false },
  { id: 'bot', name: 'Bot', matchType: 'host', pattern: 'bot.deriv.me', displayName: 'Bot', alias: 'bot.icarus', targetUrl: 'https://bot.deriv.me/', enabled: true, createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-02T00:00:00.000Z' },
  { id: 'org', name: 'Org', matchType: 'host', pattern: '*.ejemplo.org', displayName: 'Org', alias: 'org.icarus', targetUrl: 'https://ejemplo.org/', enabled: true },
  { id: 'guia', name: 'Guía', matchType: 'prefix', pattern: 'https://docs.ejemplo.com/guia', displayName: 'Guía', alias: 'guia.icarus/v1', targetUrl: 'https://docs.ejemplo.com/guia', enabled: true },
  { id: 'local', name: 'Local', matchType: 'exact', pattern: 'http://localhost:3000/?a=1', displayName: 'Local', alias: 'local.icarus', targetUrl: 'http://localhost:3000/', enabled: false },
  { id: 'choca', name: 'Choca', matchType: 'host', pattern: 'otro.com', displayName: 'Otro', alias: 'bot.icarus', targetUrl: 'https://otro.com/', enabled: true },
  { id: 'rota', name: 'Rota', matchType: 'host', pattern: '', displayName: '', alias: '', targetUrl: '', enabled: true },
  { id: 'nueva', target: 'https://nuevo.com/', address: 'https://nueva.com/', enabled: true, createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z' },
  // Una regla por fragmento del mismo sitio: se convierten en una sola entrada.
  { id: 'panel-inicio', name: 'Inicio', matchType: 'prefix', pattern: 'https://panel.ejemplo.net/#inicio', displayName: 'Inicio', alias: 'panel.icarus', targetUrl: 'https://panel.ejemplo.net/#inicio', enabled: true },
  { id: 'panel-chart', name: 'Gráfico', matchType: 'prefix', pattern: 'https://panel.ejemplo.net/#chart', displayName: 'Gráfico', alias: 'panel.icarus', targetUrl: 'https://panel.ejemplo.net/#chart', enabled: true },
];

/** Plantilla de un texto con parámetros: los parámetros se sustituyen por {nombre}. */
function template<A extends string[]>(fn: (...args: A) => string, ...names: A): string {
  return fn(...(names.map((name) => `{${name}}`) as A));
}

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
        customAddresses: VECTOR_ENTRIES,
        cases: resolveVectors('google'),
        search: providers.flatMap((providerId) => SEARCH_QUERIES.map((query) => ({ providerId, query, url: buildSearchUrl(providerId, query) }))),
      }),
    );
  });

  it('vectores de la dirección visible', () => {
    expectShared(
      'test-vectors/custom-address-display.json',
      json({
        description:
          'URL real → dirección que muestra la barra (personalizada o real) y su forma corta (sin foco) y completa (al editar), como en Chrome.',
        customAddresses: VECTOR_ENTRIES,
        cases: DISPLAY_URLS.map((url) => {
          const match = displayUrlFor(url, VECTOR_ENTRIES);
          const shown = match?.url ?? url;
          const full = formatAddress(shown, true);
          return { url, entryId: match?.entry.id ?? null, shown, short: shortAddress(shown), full: `${full.prefix}${full.host}${full.rest}` };
        }),
      }),
    );
  });

  it('vectores de la edición de la base', () => {
    const byId = (id: string | null) => VECTOR_ENTRIES.find((item) => item.id === id) ?? null;
    expectShared(
      'test-vectors/address-rebase.json',
      json({
        description:
          'Editar la base de la dirección conservando ruta, consulta y fragmento: dirección mostrada (+ entrada aplicada) → base y sufijo; base nueva → URL; texto escrito → editar la base o navegar.',
        customAddresses: VECTOR_ENTRIES,
        cases: REBASE_CASES.map(({ shown, entryId, bases, typed }) => {
          const split = splitAddress(shown, byId(entryId));
          return {
            shown,
            entryId,
            split: split && { base: split.base, suffix: split.suffix },
            joins: split
              ? bases.map((base) => {
                  const result = joinBase(base, split.suffix);
                  return { base, url: result.ok ? result.url : null, error: result.ok ? null : result.error };
                })
              : [],
            edits: split ? typed.map((text) => ({ typed: text, ...classifyAddressEdit(split, text) })) : [],
          };
        }),
      }),
    );
  });

  it('vectores de validación y migración', () => {
    expectShared(
      'test-vectors/custom-address-validation.json',
      json({
        description: 'Entrada del editor → valores normalizados o errores por campo (con la entrada que provoca el conflicto).',
        customAddresses: VECTOR_ENTRIES,
        cases: VALIDATION_CASES.map(({ editingId, ...input }) => {
          const result = validateCustomAddressInput(input, VECTOR_ENTRIES, editingId);
          return result.ok
            ? { input, editingId: editingId ?? null, ok: true, value: result.value }
            : {
                input,
                editingId: editingId ?? null,
                ok: false,
                errors: result.errors,
                conflicts: Object.fromEntries(Object.entries(result.conflicts).map(([field, other]) => [field, other.id])),
              };
        }),
        legacy: {
          rules: LEGACY_RULES,
          conversions: LEGACY_RULES.filter((raw) => 'alias' in raw).map((raw) => ({ id: raw.id, result: convertLegacyRule(raw) })),
          loaded: sanitizeCustomAddresses(LEGACY_RULES, []),
        },
      }),
    );
  });

  it('vectores de las secciones', () => {
    const now = new Date('2026-10-26T10:00:00.000Z');
    let entries = VECTOR_ENTRIES;
    const saves = SECTION_SAVES.map(({ section, base, id }) => {
      const result = saveSectionAddress(entries, { target: 'https://bot.deriv.me/', section, base }, { id, now });
      if (!result.ok) return { section, base, id, ok: false, errors: result.errors };
      entries = result.entries;
      return { section, base, id, ok: true, entryId: result.entry.id, entries: result.entries.filter((item) => item.target === 'https://bot.deriv.me/') };
    });
    expectShared(
      'test-vectors/custom-address-sections.json',
      json({
        description:
          'Secciones (#fragmento) de las direcciones personalizadas: sección de un fragmento, secciones escritas en el editor y «Guardar solo para #sección» (destino https://bot.deriv.me/, a partir de customAddresses; cada paso parte del anterior si fue bien; las entradas son las de ese destino).',
        customAddresses: VECTOR_ENTRIES,
        now: now.toISOString(),
        fragments: SECTION_FRAGMENTS.map((hash) => ({ hash, section: sectionOf(hash) })),
        texts: SECTION_TEXTS.map((text) => ({ text, ...parseSections(text) })),
        saves,
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
    const t = es.customAddresses;
    const info = es.addressBar.info;
    expectShared(
      'strings.json',
      json({
        description: 'Textos de escritorio (src/i18n/es.ts) que reutilizan las apps móviles. {nombre} marca un parámetro.',
        customAddressErrors: Object.fromEntries(Object.entries(t.errors).map(([code, fn]) => [code, template(fn, 'address', 'target')])),
        shortcutErrors: es.shortcuts.errors,
        shieldListErrors: es.shield.settings.errors,
        addressBar: {
          notSecure: es.addressBar.notSecure,
          secureTitle: info.secureTitle,
          secureBody: template(info.secureBody, 'host'),
          insecureTitle: info.insecureTitle,
          insecureBody: info.insecureBody,
          dangerousBody: template(info.dangerousBody, 'host'),
          customTitle: info.customTitle,
          customBody: template(info.customBody, 'shown', 'real'),
          showFullUrls: es.settings.navigation.showFullUrls,
          showFullUrlsHint: es.settings.navigation.showFullUrlsHint,
        },
        customAddresses: {
          title: t.title,
          subtitle: t.subtitle,
          add: t.add,
          empty: t.empty,
          targetOf: template(t.targetOf, 'target'),
          sectionsOf: template(t.sectionsOf, 'sections'),
          disabled: t.disabled,
          howTo: t.howTo,
          form: {
            createTitle: t.form.createTitle,
            editTitle: t.form.editTitle,
            target: t.form.target,
            targetHint: t.form.targetHint,
            targetPlaceholder: t.form.targetPlaceholder,
            chooseFrom: t.form.chooseFrom,
            address: t.form.address,
            addressHint: t.form.addressHint,
            addressPlaceholder: t.form.addressPlaceholder,
            sections: t.form.sections,
            sectionsHint: t.form.sectionsHint,
            sectionsPlaceholder: t.form.sectionsPlaceholder,
            preview: t.form.preview,
            previewShows: template(t.form.previewShows, 'target', 'address'),
            previewOpens: template(t.form.previewOpens, 'address', 'target'),
            previewPaths: template(t.form.previewPaths, 'real', 'shown'),
            previewSections: template(t.form.previewSections, 'sections'),
            previewIncomplete: t.form.previewIncomplete,
            limitation: t.form.limitation,
            enabled: t.form.enabled,
            remove: t.form.remove,
            unsaved: t.form.unsaved,
            fixErrors: t.form.fixErrors,
          },
          created: template(t.created, 'address'),
          saved: t.saved,
          deleted: t.deleted,
          enabledToast: template(t.enabledToast, 'address'),
          disabledToast: template(t.disabledToast, 'address'),
          toggleConflict: template(t.toggleConflict, 'address', 'target'),
          limit: t.limit,
          deleteTitle: t.deleteTitle,
          deleteBody: template(t.deleteBody, 'address', 'target'),
          discardTitle: t.discardTitle,
          discardBody: t.discardBody,
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
        customAddresses: [],
      }),
    );
  });
});
