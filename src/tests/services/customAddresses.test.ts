import { describe, expect, it } from 'vitest';
import {
  convertLegacyRule,
  createCustomAddress,
  customAddressesSchema,
  deleteCustomAddress,
  displayUrlFor,
  exportCustomAddresses,
  formatAddress,
  mergeImportedCustomAddresses,
  normalizeLocationInput,
  parseCustomAddressFile,
  resolveCustomAddress,
  sanitizeCustomAddresses,
  setCustomAddressEnabled,
  shortAddress,
  updateCustomAddress,
  validateCustomAddressInput,
} from '../../services/custom-addresses';
import { loadDocument } from '../../services/persistence/document';
import { STORAGE_KEYS } from '../../services/persistence/keys';
import { createMemoryStorage } from '../../services/persistence/storage';
import type { CustomAddress } from '../../types/customAddress';

const NOW = new Date('2026-10-25T10:00:00.000Z');
const entry = (id: string, target: string, address: string, enabled = true, createdAt = '2026-01-01T00:00:00.000Z'): CustomAddress => ({
  id,
  target,
  address,
  enabled,
  createdAt,
  updatedAt: createdAt,
});
const deriv = entry('deriv', 'https://bot.deriv.me/', 'https://miweb.com/');

describe('normalizeLocationInput', () => {
  it('acepta dominios, puertos y rutas tal como se escriben, sin sufijos', () => {
    expect(normalizeLocationInput('bot.deriv.me')).toEqual({ ok: true, location: { protocol: 'https:', host: 'bot.deriv.me', path: '' } });
    expect(normalizeLocationInput('https://Miweb.com/')).toMatchObject({ ok: true, location: { host: 'miweb.com', path: '' } });
    expect(normalizeLocationInput('icarus.marketing')).toMatchObject({ ok: true, location: { host: 'icarus.marketing' } });
    expect(normalizeLocationInput('localhost:3000')).toEqual({ ok: true, location: { protocol: 'http:', host: 'localhost:3000', path: '' } });
    expect(normalizeLocationInput('https://ejemplo.com/ruta/')).toMatchObject({ ok: true, location: { path: '/ruta' } });
    expect(normalizeLocationInput('miweb.com', 'http:')).toMatchObject({ ok: true, location: { protocol: 'http:' } });
  });

  it('rechaza lo que no es una ubicación web', () => {
    expect(normalizeLocationInput('')).toEqual({ ok: false, error: 'required' });
    expect(normalizeLocationInput('no es url')).toEqual({ ok: false, error: 'invalid-url' });
    expect(normalizeLocationInput('palabra')).toEqual({ ok: false, error: 'invalid-url' });
    expect(normalizeLocationInput('javascript:alert(1)')).toEqual({ ok: false, error: 'unsupported-protocol' });
    expect(normalizeLocationInput('ftp://a.com')).toEqual({ ok: false, error: 'unsupported-protocol' });
    expect(normalizeLocationInput('https://a.com/?x=1')).toEqual({ ok: false, error: 'has-query' });
    expect(normalizeLocationInput('a.com/#b')).toEqual({ ok: false, error: 'has-query' });
    expect(normalizeLocationInput('https://user:pw@a.com/')).toEqual({ ok: false, error: 'invalid-url' });
  });
});

describe('mostrar la dirección personalizada', () => {
  const entries = [
    deriv,
    entry('docs', 'https://ejemplo.com/docs', 'https://docs.miweb.org/'),
    entry('app', 'http://localhost:3000/', 'http://miapp.com/v2'),
    entry('apagada', 'https://apagada.com/', 'https://desactivada.com/', false),
  ];

  it('conserva la ruta, la consulta y el fragmento reales', () => {
    expect(displayUrlFor('https://bot.deriv.me/', entries)?.url).toBe('https://miweb.com/');
    expect(displayUrlFor('https://bot.deriv.me/panel/a?x=1&y=2#z', entries)?.url).toBe('https://miweb.com/panel/a?x=1&y=2#z');
    expect(displayUrlFor('https://ejemplo.com/docs', entries)?.url).toBe('https://docs.miweb.org/');
    expect(displayUrlFor('https://ejemplo.com/docs/guia?p=2', entries)?.url).toBe('https://docs.miweb.org/guia?p=2');
    expect(displayUrlFor('http://localhost:3000/api', entries)?.url).toBe('http://miapp.com/v2/api');
  });

  it('no se aplica fuera del destino ni con otro protocolo', () => {
    expect(displayUrlFor('https://ejemplo.com/docsx', entries)).toBeNull();
    expect(displayUrlFor('https://ejemplo.com/', entries)).toBeNull();
    expect(displayUrlFor('https://deriv.me/', entries)).toBeNull();
    expect(displayUrlFor('https://x.bot.deriv.me/', entries)).toBeNull();
    // Nunca se presenta una página HTTP con la dirección HTTPS del destino.
    expect(displayUrlFor('http://bot.deriv.me/', entries)).toBeNull();
    expect(displayUrlFor('https://localhost:3000/', entries)).toBeNull();
    expect(displayUrlFor('https://apagada.com/', entries)).toBeNull();
    expect(displayUrlFor('icarus://configuracion', entries)).toBeNull();
  });

  it('al escribir la dirección personalizada se navega al destino equivalente', () => {
    const resolve = (text: string, explicit = true) => resolveCustomAddress(new URL(text), entries, explicit)?.url ?? null;
    expect(resolve('https://miweb.com/')).toBe('https://bot.deriv.me/');
    expect(resolve('https://miweb.com/panel?x=1#z')).toBe('https://bot.deriv.me/panel?x=1#z');
    expect(resolve('https://docs.miweb.org/guia')).toBe('https://ejemplo.com/docs/guia');
    expect(resolve('http://miapp.com/v2/api')).toBe('http://localhost:3000/api');
    expect(resolve('http://miapp.com/v1')).toBeNull();
    // Sin protocolo escrito vale el del destino; escrito, tiene que coincidir.
    expect(resolve('https://miapp.com/v2', false)).toBe('http://localhost:3000/');
    expect(resolve('https://miapp.com/v2', true)).toBeNull();
    expect(resolve('https://desactivada.com/')).toBeNull();
  });

  it('ida y vuelta: mostrar y escribir llevan a la misma página', () => {
    for (const real of ['https://bot.deriv.me/a/b?c=1#d', 'https://ejemplo.com/docs/x', 'http://localhost:3000/']) {
      const shown = displayUrlFor(real, entries)!.url;
      expect(resolveCustomAddress(new URL(shown), entries, true)?.url).toBe(real);
    }
  });
});

describe('validateCustomAddressInput', () => {
  it('normaliza destino y dirección; sin protocolo, la dirección usa el del destino', () => {
    expect(validateCustomAddressInput({ target: 'https://bot.deriv.me', address: 'miweb.com', enabled: true })).toEqual({
      ok: true,
      value: { target: 'https://bot.deriv.me/', address: 'https://miweb.com/', enabled: true },
    });
    expect(validateCustomAddressInput({ target: 'localhost:3000', address: 'miapp.com', enabled: true })).toMatchObject({
      ok: true,
      value: { target: 'http://localhost:3000/', address: 'http://miapp.com/' },
    });
  });

  it('no permite presentar HTTP como HTTPS ni al revés', () => {
    expect(validateCustomAddressInput({ target: 'http://intranet.local.com', address: 'https://miweb.com', enabled: true })).toMatchObject({
      ok: false,
      errors: { address: 'protocol-mismatch' },
    });
    expect(validateCustomAddressInput({ target: 'https://a.com', address: 'http://b.com', enabled: true })).toMatchObject({
      errors: { address: 'protocol-mismatch' },
    });
  });

  it('la dirección no puede ser su propio destino', () => {
    expect(validateCustomAddressInput({ target: 'https://a.com', address: 'a.com', enabled: true })).toMatchObject({ errors: { address: 'same-as-target' } });
    expect(validateCustomAddressInput({ target: 'https://a.com', address: 'a.com/b', enabled: true })).toMatchObject({ errors: { address: 'same-as-target' } });
  });

  it('detecta conflictos con otras entradas activas y dice con cuál', () => {
    const entries = [deriv, entry('docs', 'https://ejemplo.com/docs', 'https://docs.miweb.org/')];
    const sameTarget = validateCustomAddressInput({ target: 'bot.deriv.me/panel', address: 'otra.com', enabled: true }, entries);
    expect(sameTarget).toMatchObject({ ok: false, errors: { target: 'target-in-use' } });
    expect(!sameTarget.ok && sameTarget.conflicts.target?.id).toBe('deriv');
    expect(validateCustomAddressInput({ target: 'otro.com', address: 'miweb.com/x', enabled: true }, entries)).toMatchObject({ errors: { address: 'address-in-use' } });
    expect(validateCustomAddressInput({ target: 'miweb.com', address: 'nueva.com', enabled: true }, entries)).toMatchObject({ errors: { target: 'target-is-address' } });
    expect(validateCustomAddressInput({ target: 'nuevo.com', address: 'bot.deriv.me', enabled: true }, entries)).toMatchObject({ errors: { address: 'address-is-target' } });
    // Secciones distintas del mismo sitio no chocan.
    expect(validateCustomAddressInput({ target: 'https://ejemplo.com/blog', address: 'blog.miweb.org', enabled: true }, entries).ok).toBe(true);
    // Desactivada no choca (se comprueba al activarla) y la propia entrada no choca consigo misma.
    expect(validateCustomAddressInput({ target: 'bot.deriv.me', address: 'otra.com', enabled: false }, entries).ok).toBe(true);
    expect(validateCustomAddressInput({ target: 'bot.deriv.me', address: 'otra.com', enabled: true }, entries, 'deriv').ok).toBe(true);
  });
});

describe('crear, editar, activar y eliminar', () => {
  it('guarda, edita y elimina sin tocar las demás', () => {
    const created = createCustomAddress([], { target: 'bot.deriv.me', address: 'miweb.com', enabled: true }, { id: 'n1', now: NOW });
    expect(created).toMatchObject({ ok: true, entry: { id: 'n1', target: 'https://bot.deriv.me/', address: 'https://miweb.com/', createdAt: NOW.toISOString() } });
    if (!created.ok) return;
    const later = new Date('2026-10-26T00:00:00.000Z');
    const updated = updateCustomAddress(created.entries, 'n1', { target: 'bot.deriv.me', address: 'otraweb.com', enabled: true }, later);
    expect(updated).toMatchObject({ ok: true, entry: { address: 'https://otraweb.com/', createdAt: NOW.toISOString(), updatedAt: later.toISOString() } });
    if (!updated.ok) return;
    expect(deleteCustomAddress(updated.entries, 'n1')).toEqual([]);
  });

  it('no sobrescribe otra entrada: devuelve el conflicto', () => {
    const result = createCustomAddress([deriv], { target: 'otro.com', address: 'miweb.com', enabled: true }, { id: 'n2', now: NOW });
    expect(result).toMatchObject({ ok: false, errors: { address: 'address-in-use' } });
  });

  it('no activa una entrada que choca con otra activa', () => {
    const entries = [deriv, entry('copia', 'https://otro.com/', 'https://miweb.com/', false)];
    const result = setCustomAddressEnabled(entries, 'copia', true, NOW);
    expect(result).toMatchObject({ ok: false, conflictWith: { id: 'deriv' } });
    expect(setCustomAddressEnabled(entries, 'deriv', false, NOW)).toMatchObject({ ok: true });
  });
});

describe('compatibilidad con las reglas de alias anteriores', () => {
  const legacy = (fields: Record<string, unknown>) => ({
    id: 'r',
    name: 'Regla',
    displayName: 'Nombre',
    enabled: true,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-02T00:00:00.000Z',
    ...fields,
  });

  it('convierte cada tipo de regla en destino → dirección, sin añadir sufijos', () => {
    expect(convertLegacyRule(legacy({ matchType: 'host', pattern: 'bot.deriv.me', alias: 'bot.icarus', targetUrl: 'https://bot.deriv.me/' }))).toEqual({
      kind: 'entry',
      input: { target: 'https://bot.deriv.me/', address: 'https://bot.icarus', enabled: true },
    });
    expect(convertLegacyRule(legacy({ matchType: 'host', pattern: '*.ejemplo.org', alias: 'org.icarus', targetUrl: 'https://ejemplo.org/' }))).toMatchObject({
      input: { target: 'https://ejemplo.org/' },
    });
    expect(convertLegacyRule(legacy({ matchType: 'prefix', pattern: 'https://docs.ejemplo.com/guia', alias: 'guia.icarus/v1', targetUrl: 'x' }))).toMatchObject({
      input: { target: 'https://docs.ejemplo.com/guia', address: 'https://guia.icarus/v1' },
    });
    expect(convertLegacyRule(legacy({ matchType: 'exact', pattern: 'http://localhost:3000/?a=1', alias: 'local.icarus', targetUrl: 'http://localhost:3000/' }))).toMatchObject({
      input: { target: 'http://localhost:3000/', address: 'http://local.icarus' },
    });
  });

  it('no migra las reglas de ejemplo sin modificar', () => {
    expect(convertLegacyRule({ id: 'default-search', matchType: 'exact', pattern: 'https://www.google.com/', alias: 'buscar.icarus', targetUrl: 'https://www.google.com/' })).toEqual({ kind: 'skip' });
    expect(convertLegacyRule({ id: 'default-wiki', matchType: 'host', pattern: 'es.wikipedia.org', alias: 'wiki.icarus', targetUrl: 'https://es.wikipedia.org/' })).toEqual({ kind: 'skip' });
    // Si el usuario la cambió, se conserva.
    expect(convertLegacyRule({ id: 'default-search', matchType: 'exact', pattern: 'https://www.google.com/', alias: 'g.icarus', targetUrl: '' }).kind).toBe('entry');
  });

  it('lee el documento guardado por versiones anteriores (versión 1) y conserva fechas e ids', () => {
    const storage = createMemoryStorage();
    storage.setItem(
      STORAGE_KEYS.customAddresses,
      JSON.stringify({
        version: 1,
        data: [
          { id: 'default-search', name: 'Página de búsqueda', matchType: 'exact', pattern: 'https://www.google.com/', displayName: 'Buscar', alias: 'buscar.icarus', targetUrl: 'https://www.google.com/', enabled: true },
          legacy({ id: 'mia', matchType: 'host', pattern: 'bot.deriv.me', alias: 'bot.icarus', targetUrl: 'https://bot.deriv.me/' }),
        ],
      }),
    );
    const result = loadDocument(storage, customAddressesSchema);
    expect(result.value).toEqual([
      { id: 'mia', target: 'https://bot.deriv.me/', address: 'https://bot.icarus/', enabled: true, createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-02T00:00:00.000Z' },
    ]);
  });

  it('las entradas guardadas que chocan se conservan desactivadas, nunca se pierden', () => {
    const issues: string[] = [];
    const result = sanitizeCustomAddresses([deriv, entry('dup', 'https://otra.com/', 'https://miweb.com/')], issues);
    expect(result.map((item) => [item.id, item.enabled])).toEqual([
      ['deriv', true],
      ['dup', false],
    ]);
    expect(issues).toEqual(['customAddresses[1]:conflict']);
    expect(sanitizeCustomAddresses('x', [])).toEqual([]);
  });
});

describe('importar y exportar', () => {
  it('exporta y vuelve a importar', () => {
    const parsed = parseCustomAddressFile(exportCustomAddresses([deriv], NOW));
    expect(parsed).toEqual({ ok: true, items: [deriv] });
    if (!parsed.ok) return;
    const summary = mergeImportedCustomAddresses([], parsed.items, { now: NOW });
    expect(summary).toMatchObject({ added: 1, updated: 0, skipped: 0, disabled: 0, entries: [deriv] });
  });

  it('acepta archivos de reglas de alias antiguos y desactiva las que chocan', () => {
    const file = JSON.stringify({
      format: 'icarus-alias-rules',
      version: 1,
      rules: [
        { id: 'x', matchType: 'host', pattern: 'otro.com', alias: 'miweb.com', targetUrl: 'https://otro.com/', enabled: true },
        { id: 'y', matchType: 'host', pattern: 'nuevo.com', alias: 'nuevo.icarus', targetUrl: 'https://nuevo.com/', enabled: true },
        { id: 'z', matchType: 'host', pattern: '', alias: '', targetUrl: '', enabled: true },
      ],
    });
    const parsed = parseCustomAddressFile(file);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const summary = mergeImportedCustomAddresses([deriv], parsed.items, { now: NOW });
    expect(summary).toMatchObject({ added: 2, skipped: 1, disabled: 1 });
    expect(summary.entries.find((item) => item.id === 'x')?.enabled).toBe(false);
    expect(summary.entries.find((item) => item.id === 'y')?.address).toBe('https://nuevo.icarus/');
    expect(parseCustomAddressFile('{"format":"otro"}')).toEqual({ ok: false, error: 'invalid-format' });
    expect(parseCustomAddressFile('x')).toEqual({ ok: false, error: 'invalid-json' });
  });
});

describe('formato de la barra (como Chrome)', () => {
  it('forma corta sin https://, www. ni barra final; completa al editar', () => {
    expect(formatAddress('https://www.google.com/', false)).toEqual({ prefix: '', host: 'google.com', rest: '' });
    expect(formatAddress('https://miweb.com/panel?x=1#a', false)).toEqual({ prefix: '', host: 'miweb.com', rest: '/panel?x=1#a' });
    expect(formatAddress('http://localhost:3000/', false)).toEqual({ prefix: '', host: 'localhost:3000', rest: '' });
    expect(formatAddress('https://www.google.com/', true)).toEqual({ prefix: 'https://', host: 'www.google.com', rest: '/' });
    expect(formatAddress('https://home.deriv.me/dashboard/login', true)).toEqual({ prefix: 'https://', host: 'home.deriv.me', rest: '/dashboard/login' });
    expect(shortAddress('https://bot.deriv.me/')).toBe('bot.deriv.me');
  });
});
