import { describe, expect, it } from 'vitest';
import { createDefaultAliasRules } from '../../services/alias-rules';
import { normalizeUserUrl, parseInternalUrl, resolveInput } from '../../services/url-resolution';
import { buildSearchUrl } from '../../services/search/providers';

const context = { providerId: 'google' as const, rules: createDefaultAliasRules() };

describe('resolveInput', () => {
  it('reconoce direcciones web con y sin protocolo', () => {
    expect(resolveInput('https://example.com/a?b=1', context)).toEqual({ kind: 'url', url: 'https://example.com/a?b=1' });
    expect(resolveInput('example.com', context)).toEqual({ kind: 'url', url: 'https://example.com/' });
    expect(resolveInput('es.wikipedia.org/wiki/Ícaro', context)).toMatchObject({ kind: 'url' });
    expect(resolveInput('localhost:5173', context)).toEqual({ kind: 'url', url: 'http://localhost:5173/' });
    expect(resolveInput('192.168.1.1', context)).toEqual({ kind: 'url', url: 'http://192.168.1.1/' });
  });

  it('convierte texto normal en una búsqueda con el proveedor elegido', () => {
    expect(resolveInput('mitología griega', context)).toEqual({
      kind: 'search',
      query: 'mitología griega',
      providerId: 'google',
      url: 'https://www.google.com/search?q=mitolog%C3%ADa%20griega',
    });
    const bing = resolveInput('ícaro', { ...context, providerId: 'bing' });
    expect(bing).toMatchObject({ kind: 'search', url: 'https://www.bing.com/search?q=%C3%ADcaro' });
    expect(resolveInput('palabra', context)).toMatchObject({ kind: 'search' });
    expect(resolveInput('usuario@example.com', context)).toMatchObject({ kind: 'search' });
  });

  it('bloquea protocolos peligrosos o no compatibles', () => {
    expect(resolveInput('javascript:alert(1)', context)).toEqual({ kind: 'blocked', protocol: 'javascript:', dangerous: true });
    expect(resolveInput('data:text/html,<b>x</b>', context)).toMatchObject({ kind: 'blocked', dangerous: true });
    expect(resolveInput('file:///etc/passwd', context)).toMatchObject({ kind: 'blocked', dangerous: true });
    expect(resolveInput('mailto:alguien@example.com', context)).toMatchObject({ kind: 'blocked', dangerous: false });
    // Con espacios es texto de búsqueda, nunca código.
    expect(resolveInput('javascript: tutorial', context)).toMatchObject({ kind: 'search' });
  });

  it('resuelve páginas internas', () => {
    expect(resolveInput('icarus://configuracion/avanzado', context)).toEqual({
      kind: 'internal',
      page: { kind: 'settings', section: 'advanced' },
    });
    expect(resolveInput('icarus://nada', context)).toEqual({ kind: 'internal-unknown', text: 'icarus://nada' });
  });

  it('solo convierte un alias en destino si existe una regla activa', () => {
    expect(resolveInput('buscar.icarus', context)).toMatchObject({ kind: 'alias', url: 'https://www.google.com/' });
    expect(resolveInput('wiki.icarus', context)).toEqual({ kind: 'alias-unresolved', alias: 'wiki.icarus', reason: 'disabled' });
    expect(resolveInput('otro.icarus', context)).toEqual({ kind: 'alias-unresolved', alias: 'otro.icarus', reason: 'unknown' });
    expect(resolveInput('https://otro.icarus/', context)).toMatchObject({ kind: 'alias-unresolved' });
  });

  it('ignora la entrada vacía', () => {
    expect(resolveInput('   ', context)).toEqual({ kind: 'empty' });
  });
});

describe('normalizeUserUrl', () => {
  it('normaliza dominios y rechaza alias, credenciales y protocolos inseguros', () => {
    expect(normalizeUserUrl('github.com')).toMatchObject({ ok: true, url: 'https://github.com/' });
    expect(normalizeUserUrl('javascript:alert(1)')).toEqual({ ok: false, reason: 'unsafe-protocol' });
    expect(normalizeUserUrl('ftp://example.com')).toEqual({ ok: false, reason: 'unsupported-protocol' });
    expect(normalizeUserUrl('buscar.icarus')).toEqual({ ok: false, reason: 'alias' });
    expect(normalizeUserUrl('https://user:pw@example.com')).toEqual({ ok: false, reason: 'invalid' });
    expect(normalizeUserUrl('no es url')).toEqual({ ok: false, reason: 'invalid' });
    expect(normalizeUserUrl('')).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('parseInternalUrl', () => {
  it('admite las páginas conocidas', () => {
    expect(parseInternalUrl('icarus://nueva-pestana')).toEqual({ kind: 'newtab' });
    expect(parseInternalUrl('icarus://configuracion')).toEqual({ kind: 'settings', section: 'general' });
    expect(parseInternalUrl('icarus://en-blanco')).toEqual({ kind: 'blank' });
    expect(parseInternalUrl('icarus://configuracion/inexistente')).toBeNull();
  });
});

describe('buildSearchUrl', () => {
  it('codifica la consulta', () => {
    expect(buildSearchUrl('duckduckgo', 'a&b c')).toBe('https://duckduckgo.com/?q=a%26b%20c');
  });
});
