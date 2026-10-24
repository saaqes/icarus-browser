// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BUILTIN_LIST_TEXT } from './builtinList';
import { getPublicSuffix, getRegistrableDomain, isThirdParty } from './domains';
import { PUBLIC_SUFFIX_RULE_COUNT } from './publicSuffixList';
import { FilterEngine } from './engine';
import { looksLikeHtml, parseFilter, parseFilterList, type NetworkFilter } from './filters';

function engine(...lines: string[]) {
  return new FilterEngine(parseFilterList(lines.join('\n')).filters);
}

const page = 'https://news.example.com/articulo';

describe('parseFilter', () => {
  it('reconoce filtros de dominio, comentarios, cosméticos y formato hosts', () => {
    expect(parseFilter('||ads.example.com^')).toMatchObject({ kind: 'filter', filter: { hostname: 'ads.example.com' } });
    expect(parseFilter('! comentario').kind).toBe('ignored');
    expect(parseFilter('[Adblock Plus 2.0]').kind).toBe('ignored');
    expect(parseFilter('example.com##.banner').kind).toBe('ignored');
    expect(parseFilter('##.ad-slot').kind).toBe('ignored');
    expect(parseFilter('example.com#@#.ad').kind).toBe('ignored');
    expect(parseFilter('0.0.0.0 tracker.example.net')).toMatchObject({ kind: 'filter', filter: { hostname: 'tracker.example.net' } });
    expect(parseFilter('127.0.0.1 localhost').kind).toBe('ignored');
    expect(parseFilter('# comentario hosts').kind).toBe('ignored');
    expect(parseFilter('   ').kind).toBe('empty');
  });

  it('ignora opciones que no pueden aplicarse como bloqueo simple', () => {
    expect(parseFilter('||example.com^$redirect=noop.js').kind).toBe('ignored');
    expect(parseFilter('||example.com^$csp=script-src none').kind).toBe('ignored');
    expect(parseFilter('||example.com^$popup').kind).toBe('ignored');
    expect(parseFilter('||example.com^$inventada').kind).toBe('ignored');
    expect(parseFilter('||example.com^$document').kind).toBe('ignored');
  });

  it('detecta filtros inválidos', () => {
    expect(parseFilter('/[sin cerrar/').kind).toBe('invalid');
    expect(parseFilter('$third-party').kind).toBe('invalid');
  });

  it('analiza opciones de tipo, terceros y dominios', () => {
    const outcome = parseFilter('||cdn.example.com/ads/*$script,~image,third-party,domain=a.com|~b.a.com');
    expect(outcome.kind).toBe('filter');
    const filter = (outcome as { filter: NetworkFilter }).filter;
    expect(filter.types).toEqual(new Set(['script']));
    expect(filter.excludedTypes).toEqual(new Set(['image']));
    expect(filter.thirdParty).toBe(true);
    expect(filter.domains).toEqual({ include: ['a.com'], exclude: ['b.a.com'] });
    expect(filter.token).toBe('example');
  });
});

describe('FilterEngine', () => {
  it('bloquea por dominio, incluidos los subdominios', () => {
    const e = engine('||ads.example.com^');
    expect(e.match({ url: 'https://ads.example.com/b.js', type: 'script', pageUrl: page }).blocked).toBe(true);
    expect(e.match({ url: 'https://x.ads.example.com/b.js', type: 'script', pageUrl: page }).blocked).toBe(true);
    expect(e.match({ url: 'https://badads.example.com/b.js', type: 'script', pageUrl: page }).blocked).toBe(false);
    expect(e.match({ url: 'https://example.com/ads.example.com', type: 'script', pageUrl: page }).blocked).toBe(false);
  });

  it('respeta comodines, separadores y anclas', () => {
    const e = engine('/banner/*/img^', '|https://track.', 'pixel.gif|');
    expect(e.match({ url: 'https://cdn.site.com/banner/2026/img?x=1', type: 'image', pageUrl: page }).blocked).toBe(true);
    expect(e.match({ url: 'https://cdn.site.com/banner/2026/imgx', type: 'image', pageUrl: page }).blocked).toBe(false);
    expect(e.match({ url: 'https://track.site.com/a', type: 'xmlhttprequest', pageUrl: page }).blocked).toBe(true);
    expect(e.match({ url: 'https://cdn.site.com/https://track.', type: 'xmlhttprequest', pageUrl: page }).blocked).toBe(false);
    expect(e.match({ url: 'https://site.com/pixel.gif', type: 'image', pageUrl: page }).blocked).toBe(true);
    expect(e.match({ url: 'https://site.com/pixel.gif?a=1', type: 'image', pageUrl: page }).blocked).toBe(false);
  });

  it('las excepciones prevalecen y $document permite toda la página', () => {
    const e = engine('||tracker.net^', '@@||tracker.net/permitido^', '@@||confianza.org^$document');
    expect(e.match({ url: 'https://tracker.net/x.js', type: 'script', pageUrl: page }).blocked).toBe(true);
    expect(e.match({ url: 'https://tracker.net/permitido/x.js', type: 'script', pageUrl: page }).blocked).toBe(false);
    expect(e.match({ url: 'https://tracker.net/x.js', type: 'script', pageUrl: 'https://www.confianza.org/' }).blocked).toBe(false);
  });

  it('aplica terceros, tipos y dominios de la página', () => {
    const e = engine('||cdn.net^$third-party,script', '/widget.js$domain=a.com|~sub.a.com');
    expect(e.match({ url: 'https://cdn.net/lib.js', type: 'script', pageUrl: page }).blocked).toBe(true);
    expect(e.match({ url: 'https://cdn.net/lib.css', type: 'stylesheet', pageUrl: page }).blocked).toBe(false);
    expect(e.match({ url: 'https://cdn.net/lib.js', type: 'script', pageUrl: 'https://www.cdn.net/' }).blocked).toBe(false);
    expect(e.match({ url: 'https://x.com/widget.js', type: 'script', pageUrl: 'https://www.a.com/' }).blocked).toBe(true);
    expect(e.match({ url: 'https://x.com/widget.js', type: 'script', pageUrl: 'https://sub.a.com/' }).blocked).toBe(false);
    expect(e.match({ url: 'https://x.com/widget.js', type: 'script', pageUrl: 'https://b.com/' }).blocked).toBe(false);
  });

  it('admite expresiones regulares y nunca bloquea el documento principal', () => {
    const e = engine('/\\/ad[0-9]+\\.js$/', '||ads.example.com^');
    expect(e.match({ url: 'https://s.com/ad123.js', type: 'script', pageUrl: page }).blocked).toBe(true);
    expect(e.match({ url: 'https://ads.example.com/', type: 'document', pageUrl: page }).blocked).toBe(false);
  });

  it('la lista básica bloquea rastreadores de terceros pero no el sitio propio', () => {
    const e = new FilterEngine(parseFilterList(BUILTIN_LIST_TEXT).filters);
    expect(e.match({ url: 'https://www.google-analytics.com/g/collect?v=2', type: 'ping', pageUrl: page }).blocked).toBe(true);
    expect(e.match({ url: 'https://securepubads.g.doubleclick.net/tag/js/gpt.js', type: 'script', pageUrl: page }).blocked).toBe(true);
    expect(e.match({ url: 'https://www.doubleclick.net/', type: 'image', pageUrl: 'https://www.doubleclick.net/' }).blocked).toBe(false);
  });

  it('mantiene un rendimiento razonable con listas grandes', () => {
    const lines: string[] = [];
    for (let i = 0; i < 40_000; i += 1) lines.push(`||ads${i}.example${i % 97}.com^`);
    for (let i = 0; i < 15_000; i += 1) lines.push(`/path${i}/banner^`);
    const e = engine(...lines);
    const start = performance.now();
    for (let i = 0; i < 2_000; i += 1) {
      e.match({ url: `https://cdn${i}.site.com/static/app${i}.js?v=${i}`, type: 'script', pageUrl: page });
    }
    expect(performance.now() - start).toBeLessThan(1_000);
    expect(e.match({ url: 'https://x.com/path14999/banner/', type: 'image', pageUrl: page }).blocked).toBe(true);
  });
});

describe('listas', () => {
  it('cuenta reglas, ignoradas e inválidas', () => {
    const list = parseFilterList(['! comentario', '||a.com^', 'a.com##.x', '/[mal/', '0.0.0.0 b.com'].join('\n'));
    expect(list).toMatchObject({ ruleCount: 2, ignoredCount: 2, invalidCount: 1 });
  });

  it('detecta respuestas HTML que no son listas', () => {
    expect(looksLikeHtml('<!DOCTYPE html><html>')).toBe(true);
    expect(looksLikeHtml('[Adblock Plus 2.0]\n||a.com^')).toBe(false);
  });
});

describe('dominios (Public Suffix List)', () => {
  it('calcula el dominio registrable con sufijos de varios niveles', () => {
    expect(getRegistrableDomain('a.b.example.com')).toBe('example.com');
    expect(getRegistrableDomain('www.bbc.co.uk')).toBe('bbc.co.uk');
    expect(getRegistrableDomain('tienda.ejemplo.com.mx')).toBe('ejemplo.com.mx');
    expect(getRegistrableDomain('www.example.com.')).toBe('example.com');
    expect(isThirdParty('cdn.example.com', 'www.example.com')).toBe(false);
    expect(isThirdParty('tracker.net', 'www.example.com')).toBe(true);
  });

  it('trata los dominios privados de la lista como sitios distintos', () => {
    expect(getRegistrableDomain('usuario.github.io')).toBe('usuario.github.io');
    expect(getRegistrableDomain('github.io')).toBe('github.io');
    expect(isThirdParty('otro.github.io', 'usuario.github.io')).toBe(true);
    expect(isThirdParty('assets.usuario.github.io', 'usuario.github.io')).toBe(false);
  });

  it('aplica reglas comodín y de excepción', () => {
    // *.ck y !www.ck
    expect(getPublicSuffix('a.b.ck')).toBe('b.ck');
    expect(getRegistrableDomain('a.b.ck')).toBe('a.b.ck');
    expect(getRegistrableDomain('www.ck')).toBe('www.ck');
    expect(getRegistrableDomain('x.www.ck')).toBe('www.ck');
    // *.kawasaki.jp y !city.kawasaki.jp
    expect(getRegistrableDomain('foo.bar.kawasaki.jp')).toBe('foo.bar.kawasaki.jp');
    expect(getRegistrableDomain('a.city.kawasaki.jp')).toBe('city.kawasaki.jp');
  });

  it('usa la regla implícita «*» para sufijos desconocidos y respeta IP y punycode', () => {
    expect(getRegistrableDomain('a.b.ejemplo.icarusprueba')).toBe('ejemplo.icarusprueba');
    expect(getRegistrableDomain('localhost')).toBe('localhost');
    expect(getRegistrableDomain('192.168.1.1')).toBe('192.168.1.1');
    expect(getRegistrableDomain('[::1]')).toBe('[::1]');
    // 公司.cn llega como xn--55qx5d.cn en las URL.
    expect(getRegistrableDomain('www.ejemplo.xn--55qx5d.cn')).toBe('ejemplo.xn--55qx5d.cn');
  });

  it('incluye la lista completa', () => {
    expect(PUBLIC_SUFFIX_RULE_COUNT).toBeGreaterThan(5000);
  });
});
