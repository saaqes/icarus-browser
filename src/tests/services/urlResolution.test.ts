import { describe, expect, it } from 'vitest';
import { normalizeUserUrl, parseInternalUrl, resolveInput } from '../../services/url-resolution';
import { buildSearchUrl } from '../../services/search/providers';
import type { CustomAddress } from '../../types/customAddress';

const entry = (id: string, target: string, address: string, enabled = true): CustomAddress => ({
  id,
  target,
  address,
  enabled,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
const customAddresses = [
  entry('deriv', 'https://bot.deriv.me/', 'https://miweb.com/'),
  entry('local', 'http://localhost:3000/', 'http://miapp.com/'),
  entry('docs', 'https://ejemplo.com/docs', 'https://docs.miweb.org/'),
  entry('apagada', 'https://apagada.com/', 'https://desactivada.com/', false),
];
const context = { providerId: 'google' as const, customAddresses };

describe('resolveInput', () => {
  it('reconoce direcciones web con y sin protocolo', () => {
    expect(resolveInput('https://example.com/a?b=1', context)).toEqual({ kind: 'url', url: 'https://example.com/a?b=1' });
    expect(resolveInput('example.com', context)).toEqual({ kind: 'url', url: 'https://example.com/' });
    expect(resolveInput('es.wikipedia.org/wiki/Ícaro', context)).toMatchObject({ kind: 'url' });
    expect(resolveInput('localhost:5173', context)).toEqual({ kind: 'url', url: 'http://localhost:5173/' });
    expect(resolveInput('192.168.1.1', context)).toEqual({ kind: 'url', url: 'http://192.168.1.1/' });
  });

  it('sin buscador: el texto que no es dirección se intenta como dominio, nunca se busca', () => {
    // Una sola palabra es un dominio de un nivel; el motor mostrará su error si no existe.
    expect(resolveInput('palabra', context)).toEqual({ kind: 'url', url: 'https://palabra/' });
    // Varias palabras no forman un host válido: se intenta igualmente (error real), sin buscar.
    const frase = resolveInput('mitología griega', context);
    expect(frase.kind).toBe('url');
    expect(frase.kind === 'url' && frase.url.startsWith('https://')).toBe(true);
    expect(resolveInput('mitología griega', context)).not.toMatchObject({ kind: 'search' });
    expect(resolveInput('ícaro', context).kind).toBe('url');
  });

  it('bloquea protocolos peligrosos o no compatibles', () => {
    expect(resolveInput('javascript:alert(1)', context)).toEqual({ kind: 'blocked', protocol: 'javascript:', dangerous: true });
    expect(resolveInput('data:text/html,<b>x</b>', context)).toMatchObject({ kind: 'blocked', dangerous: true });
    expect(resolveInput('file:///etc/passwd', context)).toMatchObject({ kind: 'blocked', dangerous: true });
    expect(resolveInput('mailto:alguien@example.com', context)).toMatchObject({ kind: 'blocked', dangerous: false });
    // Con espacios no es código ni búsqueda: se intenta como dominio (error real del motor).
    expect(resolveInput('javascript: tutorial', context)).toMatchObject({ kind: 'url' });
  });

  it('resuelve páginas internas', () => {
    expect(resolveInput('icarus://configuracion/avanzado', context)).toEqual({
      kind: 'internal',
      page: { kind: 'settings', section: 'advanced' },
    });
    expect(resolveInput('icarus://nada', context)).toEqual({ kind: 'internal-unknown', text: 'icarus://nada' });
  });

  it('acepta las direcciones tal como se escriben, sin sufijos', () => {
    expect(resolveInput('bot.deriv.me', { ...context, customAddresses: [] })).toEqual({ kind: 'url', url: 'https://bot.deriv.me/' });
    expect(resolveInput('google.com', context)).toEqual({ kind: 'url', url: 'https://google.com/' });
    expect(resolveInput('youtube.com', context)).toEqual({ kind: 'url', url: 'https://youtube.com/' });
    expect(resolveInput('icarus.marketing', context)).toEqual({ kind: 'url', url: 'https://icarus.marketing/' });
    expect(resolveInput('localhost:3000', context)).toEqual({ kind: 'url', url: 'http://localhost:3000/' });
    expect(resolveInput('https://ejemplo.com/ruta', context)).toEqual({ kind: 'url', url: 'https://ejemplo.com/ruta' });
    expect(resolveInput('ejemplo.com:8443/a?b=1#c', context)).toEqual({ kind: 'url', url: 'https://ejemplo.com:8443/a?b=1#c' });
    // `.icarus` ya no es especial: es una dirección más.
    expect(resolveInput('buscar.icarus', context)).toEqual({ kind: 'url', url: 'https://buscar.icarus/' });
  });

  it('una dirección personalizada lleva a la URL real equivalente del destino', () => {
    expect(resolveInput('miweb.com', context)).toMatchObject({ kind: 'custom', url: 'https://bot.deriv.me/', address: 'https://miweb.com/' });
    expect(resolveInput('https://miweb.com/panel?x=1#a', context)).toMatchObject({ kind: 'custom', url: 'https://bot.deriv.me/panel?x=1#a' });
    expect(resolveInput('MIWEB.com/Ruta', context)).toMatchObject({ kind: 'custom', url: 'https://bot.deriv.me/Ruta' });
    // Sin protocolo escrito se acepta el del destino (http); con https:// explícito no coincide.
    expect(resolveInput('miapp.com/api', context)).toMatchObject({ kind: 'custom', url: 'http://localhost:3000/api' });
    expect(resolveInput('https://miapp.com/', context)).toEqual({ kind: 'url', url: 'https://miapp.com/' });
    // Destino con ruta base.
    expect(resolveInput('docs.miweb.org/guia', context)).toMatchObject({ kind: 'custom', url: 'https://ejemplo.com/docs/guia' });
    // Desactivada: es una dirección normal.
    expect(resolveInput('desactivada.com', context)).toEqual({ kind: 'url', url: 'https://desactivada.com/' });
  });

  it('ignora la entrada vacía', () => {
    expect(resolveInput('   ', context)).toEqual({ kind: 'empty' });
  });
});

describe('normalizeUserUrl', () => {
  it('normaliza dominios y rechaza credenciales y protocolos inseguros', () => {
    expect(normalizeUserUrl('github.com')).toMatchObject({ ok: true, url: 'https://github.com/' });
    expect(normalizeUserUrl('javascript:alert(1)')).toEqual({ ok: false, reason: 'unsafe-protocol' });
    expect(normalizeUserUrl('ftp://example.com')).toEqual({ ok: false, reason: 'unsupported-protocol' });
    expect(normalizeUserUrl('buscar.icarus')).toMatchObject({ ok: true, url: 'https://buscar.icarus/' });
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
