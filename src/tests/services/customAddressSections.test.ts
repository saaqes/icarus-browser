import { describe, expect, it } from 'vitest';
import {
  addressesStartingWith,
  createCustomAddress,
  displayUrlFor,
  parseSections,
  renameCustomAddressBase,
  resolveCustomAddress,
  sanitizeCustomAddresses,
  saveSectionAddress,
  sectionOf,
  setCustomAddressEnabled,
  updateCustomAddress,
  validateCustomAddressInput,
} from '../../services/custom-addresses';
import type { CustomAddress } from '../../types/customAddress';

const NOW = new Date('2026-10-26T10:00:00.000Z');
const entry = (id: string, target: string, address: string, sections?: string[], enabled = true): CustomAddress => ({
  id,
  target,
  address,
  ...(sections ? { sections } : {}),
  enabled,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
/** El caso del usuario: miweb.com en #inicio y #catalogo; otraweb.com en #home y #usuario. */
const general = entry('general', 'https://bot.deriv.me/', 'https://miweb.com/');
const home = entry('home', 'https://bot.deriv.me/', 'https://otraweb.com/', ['home', 'usuario']);
const shown = (url: string, entries: CustomAddress[]) => displayUrlFor(url, entries)?.url ?? null;

describe('sectionOf', () => {
  it('toma el primer tramo del fragmento, sin #, ! ni /, en minúsculas', () => {
    expect(sectionOf('#inicio')).toBe('inicio');
    expect(sectionOf('#HOME')).toBe('home');
    expect(sectionOf('#/usuario/10')).toBe('usuario');
    expect(sectionOf('#!/home')).toBe('home');
    expect(sectionOf('#catalogo?pagina=2')).toBe('catalogo');
    expect(sectionOf('#tab=2')).toBe('tab');
    expect(sectionOf('#cat%C3%A1logo')).toBe('catálogo');
  });

  it('no hay sección sin fragmento o si no es un nombre', () => {
    expect(sectionOf('')).toBeNull();
    expect(sectionOf('#')).toBeNull();
    expect(sectionOf('#/')).toBeNull();
    expect(sectionOf('#mal%ZZ')).toBeNull();
    expect(sectionOf('#🚀')).toBeNull();
  });
});

describe('parseSections', () => {
  it('acepta #nombres separados por comas o espacios, sin repetir', () => {
    expect(parseSections('#home, #Usuario usuario;#/catalogo')).toEqual({ ok: true, sections: ['home', 'usuario', 'catalogo'] });
    expect(parseSections('  ')).toEqual({ ok: true, sections: [] });
    expect(parseSections('#')).toEqual({ ok: true, sections: [] });
  });

  it('rechaza nombres no válidos y más de 20 secciones', () => {
    expect(parseSections('#home #a/b')).toEqual({ ok: false, error: 'invalid-section' });
    expect(parseSections('#ho me?')).toEqual({ ok: false, error: 'invalid-section' });
    expect(parseSections(Array.from({ length: 21 }, (_, n) => `#s${n}`).join(' '))).toEqual({ ok: false, error: 'too-many-sections' });
  });
});

describe('dirección visible por sección', () => {
  const entries = [general, home];

  it('cada sección del mismo sitio se muestra con su dirección, también en otra pestaña', () => {
    expect(shown('https://bot.deriv.me/#inicio', entries)).toBe('https://miweb.com/#inicio');
    expect(shown('https://bot.deriv.me/#catalogo', entries)).toBe('https://miweb.com/#catalogo');
    expect(shown('https://bot.deriv.me/#home', entries)).toBe('https://otraweb.com/#home');
    expect(shown('https://bot.deriv.me/app?x=1#/usuario/10', entries)).toBe('https://otraweb.com/app?x=1#/usuario/10');
    expect(shown('https://bot.deriv.me/#HOME', entries)).toBe('https://otraweb.com/#HOME');
    expect(shown('https://bot.deriv.me/', entries)).toBe('https://miweb.com/');
    expect(displayUrlFor('https://bot.deriv.me/#home', entries)?.entry.id).toBe('home');
  });

  it('sin entrada general, las demás secciones muestran la dirección real', () => {
    expect(shown('https://bot.deriv.me/#home', [home])).toBe('https://otraweb.com/#home');
    expect(shown('https://bot.deriv.me/#inicio', [home])).toBeNull();
    expect(shown('https://bot.deriv.me/#home', [{ ...home, enabled: false }, general])).toBe('https://miweb.com/#home');
  });

  it('escribir la dirección de la sección abre esa sección del sitio real', () => {
    const resolve = (text: string) => resolveCustomAddress(new URL(text), entries, false);
    expect(resolve('https://otraweb.com/')).toMatchObject({ entry: { id: 'home' }, url: 'https://bot.deriv.me/#home', address: 'https://otraweb.com/#home' });
    expect(resolve('https://otraweb.com/#usuario')).toMatchObject({ url: 'https://bot.deriv.me/#usuario' });
    // Otra sección escrita a mano: se respeta (y se mostrará con la dirección general).
    expect(resolve('https://otraweb.com/#inicio')).toMatchObject({ url: 'https://bot.deriv.me/#inicio' });
    expect(resolve('https://miweb.com/')).toMatchObject({ entry: { id: 'general' }, url: 'https://bot.deriv.me/' });
  });
});

describe('validación con secciones', () => {
  it('la general y las de secciones del mismo destino conviven; las secciones se normalizan', () => {
    expect(validateCustomAddressInput({ target: 'bot.deriv.me', address: 'otraweb.com', sections: '#Home, #usuario', enabled: true }, [general])).toEqual({
      ok: true,
      value: { target: 'https://bot.deriv.me/', address: 'https://otraweb.com/', sections: ['home', 'usuario'], enabled: true },
    });
    expect(validateCustomAddressInput({ target: 'bot.deriv.me', address: 'tercera.com', sections: '#perfil', enabled: true }, [general, home])).toMatchObject({ ok: true });
  });

  it('dos generales o secciones repetidas del mismo destino chocan, nombrando la otra entrada', () => {
    expect(validateCustomAddressInput({ target: 'bot.deriv.me', address: 'tercera.com', enabled: true }, [general, home])).toMatchObject({
      ok: false,
      errors: { target: 'target-in-use' },
      conflicts: { target: { id: 'general' } },
    });
    expect(validateCustomAddressInput({ target: 'bot.deriv.me', address: 'tercera.com', sections: '#perfil #home', enabled: true }, [general, home])).toMatchObject({
      ok: false,
      errors: { sections: 'section-in-use' },
      conflicts: { sections: { id: 'home' } },
    });
    // Dos generales no comparten dirección: cada dirección escrita lleva a un solo destino.
    expect(validateCustomAddressInput({ target: 'otrositio.com', address: 'miweb.com', enabled: true }, [general])).toMatchObject({
      ok: false,
      errors: { address: 'address-in-use' },
      conflicts: { address: { id: 'general' } },
    });
    expect(validateCustomAddressInput({ target: 'bot.deriv.me', address: 'otra.com', sections: '#a/b', enabled: true })).toMatchObject({
      ok: false,
      errors: { sections: 'invalid-section' },
    });
  });

  it('editar una entrada no choca consigo misma y vaciar las secciones la vuelve general', () => {
    const edited = updateCustomAddress([home], 'home', { target: home.target, address: home.address, sections: '', enabled: true }, NOW);
    expect(edited).toMatchObject({ ok: true });
    expect(edited.ok && edited.entry.sections).toBeUndefined();
    const renamed = renameCustomAddressBase([general, home], 'home', 'cuarta.com', NOW);
    expect(renamed.ok && renamed.entry).toMatchObject({ address: 'https://cuarta.com/', sections: ['home', 'usuario'] });
  });

  it('activar una entrada de secciones que choca con otra no se permite', () => {
    const other = entry('otra', 'https://bot.deriv.me/', 'https://quinta.com/', ['home'], false);
    expect(setCustomAddressEnabled([general, home, other], 'otra', true, NOW)).toMatchObject({ ok: false, conflictWith: { id: 'home' } });
  });
});

describe('saveSectionAddress («Guardar solo para #sección»)', () => {
  const context = (id: string) => ({ id, now: NOW });

  it('desde la dirección general: crea una entrada solo para esa sección', () => {
    const result = saveSectionAddress([general], { target: general.target, section: 'home', base: 'otraweb.com' }, context('n1'));
    expect(result.ok && result.entry).toMatchObject({ id: 'n1', target: 'https://bot.deriv.me/', address: 'https://otraweb.com/', sections: ['home'] });
    expect(result.ok && result.entries).toHaveLength(2);
    expect(result.ok && shown('https://bot.deriv.me/#home', result.entries)).toBe('https://otraweb.com/#home');
    expect(result.ok && shown('https://bot.deriv.me/#inicio', result.entries)).toBe('https://miweb.com/#inicio');
  });

  it('la misma base en otra sección se añade a la entrada que ya la usa', () => {
    const first = saveSectionAddress([general], { target: general.target, section: 'home', base: 'otraweb.com' }, context('n1'));
    const second = first.ok ? saveSectionAddress(first.entries, { target: general.target, section: 'usuario', base: 'https://otraweb.com/' }, context('n2')) : first;
    expect(second.ok && second.entries).toHaveLength(2);
    expect(second.ok && second.entry).toMatchObject({ id: 'n1', sections: ['home', 'usuario'] });
  });

  it('mueve la sección a otra base y elimina la entrada que se queda sin secciones', () => {
    const moved = saveSectionAddress([general, home], { target: general.target, section: 'home', base: 'tercera.com' }, context('n3'));
    expect(moved.ok && moved.entries.map((item) => [item.id, item.sections ?? null])).toEqual([
      ['general', null],
      ['home', ['usuario']],
      ['n3', ['home']],
    ]);
    // Volver a la base general: la sección deja su entrada y usa la general.
    const back = moved.ok ? saveSectionAddress(moved.entries, { target: general.target, section: 'usuario', base: 'miweb.com' }, context('n4')) : moved;
    expect(back.ok && back.entry.id).toBe('general');
    expect(back.ok && back.entries.map((item) => item.id)).toEqual(['general', 'n3']);
  });

  it('si la base no es válida o esa sección ya es de otro sitio con esa dirección, no cambia nada', () => {
    const other = entry('otro', 'https://otro.com/', 'https://tercera.com/', ['home']);
    const entries = [general, home, other];
    expect(saveSectionAddress(entries, { target: general.target, section: 'home', base: 'tercera.com' }, context('x'))).toMatchObject({
      ok: false,
      errors: { sections: 'section-in-use' },
      conflicts: { sections: { id: 'otro' } },
    });
    // Volver a la general tampoco: otra entrada muestra miweb.com#tienda con otro sitio.
    const shop = entry('tienda', 'https://otrositio.com/', 'https://miweb.com/', ['tienda']);
    expect(saveSectionAddress([general, shop], { target: general.target, section: 'tienda', base: 'miweb.com' }, context('x'))).toMatchObject({
      ok: false,
      errors: { sections: 'section-in-use' },
      conflicts: { sections: { id: 'tienda' } },
    });
    expect(saveSectionAddress(entries, { target: general.target, section: 'home', base: 'tercera.com/#x' }, context('x'))).toMatchObject({
      ok: false,
      errors: { address: 'has-query' },
    });
  });
});

describe('repetir la dirección real y la visible repartiendo las secciones', () => {
  it('la misma dirección real y visible en varias entradas, cada una con sus secciones', () => {
    const inicio = entry('inicio', 'https://bot.deriv.me/', 'https://miweb.com/', ['inicio']);
    expect(validateCustomAddressInput({ target: 'bot.deriv.me', address: 'miweb.com', sections: '#catalogo', enabled: true }, [inicio])).toMatchObject({ ok: true });
    expect(validateCustomAddressInput({ target: 'bot.deriv.me', address: 'miweb.com', sections: '#catalogo #inicio', enabled: true }, [inicio])).toMatchObject({
      ok: false,
      errors: { sections: 'section-in-use' },
      conflicts: { sections: { id: 'inicio' } },
    });
  });

  it('varias direcciones reales con la misma dirección visible: la sección decide el sitio', () => {
    const a = entry('a', 'https://bot.deriv.me/', 'https://miweb.com/', ['inicio', 'catalogo']);
    const b = entry('b', 'https://otrositio.com/', 'https://miweb.com/', ['home', 'usuario']);
    expect(validateCustomAddressInput({ target: b.target, address: b.address, sections: '#home #usuario', enabled: true }, [a])).toMatchObject({ ok: true });
    const entries = [a, b];
    expect(shown('https://bot.deriv.me/#catalogo', entries)).toBe('https://miweb.com/#catalogo');
    expect(shown('https://otrositio.com/#/usuario/3', entries)).toBe('https://miweb.com/#/usuario/3');
    expect(shown('https://otrositio.com/#inicio', entries)).toBeNull();
    const resolve = (text: string) => resolveCustomAddress(new URL(text), entries, false);
    expect(resolve('https://miweb.com/#home')).toMatchObject({ entry: { id: 'b' }, url: 'https://otrositio.com/#home' });
    expect(resolve('https://miweb.com/#inicio')).toMatchObject({ entry: { id: 'a' }, url: 'https://bot.deriv.me/#inicio' });
    // Sin sección: la entrada más antigua, en su primera sección.
    expect(resolve('https://miweb.com/')).toMatchObject({ entry: { id: 'a' }, url: 'https://bot.deriv.me/#inicio' });
    expect(addressesStartingWith('miw', entries).map((item) => item.id)).toEqual(['a']);
  });

  it('con una general, la sección que reclama otro sitio se muestra con su dirección real', () => {
    const shop = entry('tienda', 'https://otrositio.com/', 'https://miweb.com/', ['tienda']);
    expect(validateCustomAddressInput({ target: shop.target, address: shop.address, sections: '#tienda', enabled: true }, [general])).toMatchObject({ ok: true });
    const entries = [general, shop];
    expect(shown('https://bot.deriv.me/#inicio', entries)).toBe('https://miweb.com/#inicio');
    // miweb.com#tienda lleva a otrositio.com: bot.deriv.me#tienda no puede mostrarse así.
    expect(shown('https://bot.deriv.me/#tienda', entries)).toBeNull();
    expect(shown('https://otrositio.com/#tienda', entries)).toBe('https://miweb.com/#tienda');
    const resolve = (text: string) => resolveCustomAddress(new URL(text), entries, false);
    expect(resolve('https://miweb.com/#tienda')).toMatchObject({ url: 'https://otrositio.com/#tienda' });
    expect(resolve('https://miweb.com/')).toMatchObject({ entry: { id: 'general' }, url: 'https://bot.deriv.me/' });
    expect(addressesStartingWith('miweb', entries).map((item) => item.id)).toEqual(['general']);
  });
});

describe('guardado y carga con secciones', () => {
  it('conserva las secciones al guardar y al leer; las no válidas se descartan con aviso', () => {
    const created = createCustomAddress([general], { target: 'bot.deriv.me', address: 'otraweb.com', sections: '#home', enabled: true }, context());
    expect(created.ok && created.entry.sections).toEqual(['home']);
    const issues: string[] = [];
    const loaded = sanitizeCustomAddresses(
      [general, home, { ...entry('mala', 'https://bot.deriv.me/', 'https://mala.com/'), sections: ['a/b'] }, { ...entry('rara', 'https://x.com/', 'https://y.com/'), sections: 'home' }],
      issues,
    );
    expect(loaded.map((item) => [item.id, item.sections ?? null, item.enabled])).toEqual([
      ['general', null, true],
      ['home', ['home', 'usuario'], true],
    ]);
    expect(issues).toEqual(['customAddresses[2]', 'customAddresses[3]']);
  });

  it('una entrada guardada que choca por secciones se carga desactivada, sin perderse', () => {
    const issues: string[] = [];
    const loaded = sanitizeCustomAddresses([general, home, entry('choca', 'https://bot.deriv.me/', 'https://quinta.com/', ['usuario'])], issues);
    expect(loaded.map((item) => [item.id, item.enabled])).toEqual([
      ['general', true],
      ['home', true],
      ['choca', false],
    ]);
    expect(issues).toEqual(['customAddresses[2]:conflict']);
  });
});

function context() {
  return { id: 'nueva', now: NOW };
}
