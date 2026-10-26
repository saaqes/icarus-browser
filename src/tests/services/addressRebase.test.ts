import { describe, expect, it } from 'vitest';
import { classifyAddressEdit, joinBase, renameCustomAddressBase, sanitizeCustomAddresses, splitAddress } from '../../services/custom-addresses';
import type { CustomAddress } from '../../types/customAddress';

const NOW = new Date('2026-10-26T10:00:00.000Z');
const entry = (id: string, target: string, address: string, enabled = true): CustomAddress => ({
  id,
  target,
  address,
  enabled,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
const DERIV = entry('deriv', 'https://bot.deriv.me/', 'https://miweb.com/');
const APP = entry('app', 'http://localhost:3000/', 'http://miapp.com/v2');

/** Base nueva + sufijo de la dirección que muestra la barra. */
function rebase(display: string, custom: CustomAddress | null, base: string) {
  const split = splitAddress(display, custom)!;
  const joined = joinBase(base, split.suffix);
  return joined.ok ? joined.url : joined.error;
}

describe('editar la base conservando ruta, consulta y fragmento', () => {
  it.each([
    ['https://miweb.com/#inicio', 'https://otrapagina.com/#inicio'],
    ['https://miweb.com/#dashboard', 'https://otrapagina.com/#dashboard'],
    ['https://miweb.com/#bot_builder', 'https://otrapagina.com/#bot_builder'],
    ['https://miweb.com/#chart', 'https://otrapagina.com/#chart'],
    ['https://miweb.com/panel/usuarios?id=10', 'https://otrapagina.com/panel/usuarios?id=10'],
  ])('%s → %s', (display, expected) => {
    expect(rebase(display, DERIV, 'https://otrapagina.com')).toBe(expected);
    // Escrita sin protocolo y con barra final: el resultado es el mismo, sin barras dobles.
    expect(rebase(display, DERIV, 'otrapagina.com/')).toBe(expected);
  });

  it('separa la base de la dirección personalizada y el sufijo, sin inventar rutas', () => {
    expect(splitAddress('https://miweb.com/#inicio', DERIV)).toEqual({ base: 'https://miweb.com', suffix: '/#inicio', entry: DERIV });
    expect(splitAddress('https://miweb.com/', DERIV)).toEqual({ base: 'https://miweb.com', suffix: '', entry: DERIV });
    expect(splitAddress('https://miweb.com/a/b/?x=1&y=%202#parte', DERIV)?.suffix).toBe('/a/b/?x=1&y=%202#parte');
    // Base con ruta: el sufijo es lo que cuelga de ella.
    expect(splitAddress('http://miapp.com/v2/panel?id=10#top', APP)).toEqual({ base: 'http://miapp.com/v2', suffix: '/panel?id=10#top', entry: APP });
    expect(splitAddress('http://miapp.com/v2#top', APP)?.suffix).toBe('#top');
    // Sin dirección personalizada, la base es el origen (con puerto si lo hay).
    expect(splitAddress('http://localhost:3000/app/#/ajustes?tab=2', null)).toEqual({ base: 'http://localhost:3000', suffix: '/app/#/ajustes?tab=2', entry: null });
    expect(splitAddress('icarus://configuracion', null)).toBeNull();
  });

  it('admite puertos, varios niveles, barra final, seguimiento y caracteres codificados', () => {
    expect(rebase('http://localhost:3000/a/b/c/', null, 'localhost:4000')).toBe('http://localhost:4000/a/b/c/');
    expect(rebase('https://ejemplo.com/p?utm_source=x&utm_medium=y#s', null, 'otra.com')).toBe('https://otra.com/p?utm_source=x&utm_medium=y#s');
    expect(rebase('https://ejemplo.com/caf%C3%A9/se%C3%B1al?q=%C3%B1', null, 'otra.com')).toBe('https://otra.com/caf%C3%A9/se%C3%B1al?q=%C3%B1');
    expect(rebase('http://miapp.com/v2#top', APP, 'https://nueva.com/v3/')).toBe('https://nueva.com/v3#top');
    expect(rebase('https://miweb.com/', DERIV, 'otrapagina.com')).toBe('https://otrapagina.com/');
  });

  it('la base no puede traer su propia consulta o fragmento ni ser inválida', () => {
    expect(rebase('https://miweb.com/#inicio', DERIV, 'otrapagina.com/#otro')).toBe('has-query');
    expect(rebase('https://miweb.com/#inicio', DERIV, 'otra pagina')).toBe('invalid-url');
    expect(rebase('https://miweb.com/#inicio', DERIV, 'javascript:alert(1)')).toBe('unsupported-protocol');
    expect(rebase('https://miweb.com/#inicio', DERIV, '')).toBe('required');
  });
});

describe('editar la base frente a navegar a otra dirección', () => {
  const split = splitAddress('https://miweb.com/#inicio', DERIV)!;

  it('cambiar solo la base (el resto del texto intacto) es una edición de la base', () => {
    expect(classifyAddressEdit(split, 'https://otrapagina.com/#inicio')).toEqual({ kind: 'rebase', base: 'https://otrapagina.com', url: 'https://otrapagina.com/#inicio' });
    expect(classifyAddressEdit(split, 'otrapagina.com/#inicio')).toMatchObject({ kind: 'rebase', url: 'https://otrapagina.com/#inicio' });
  });

  it('una dirección nueva completa no hereda la ruta anterior', () => {
    expect(classifyAddressEdit(split, 'otrapagina.com')).toEqual({ kind: 'navigate' });
    expect(classifyAddressEdit(split, 'https://otrapagina.com/#dashboard')).toEqual({ kind: 'navigate' });
    expect(classifyAddressEdit(split, 'buscar algo #inicio')).toEqual({ kind: 'navigate' });
    // La misma base (con o sin protocolo) no es un cambio.
    expect(classifyAddressEdit(split, 'https://miweb.com/#inicio')).toEqual({ kind: 'navigate' });
    expect(classifyAddressEdit(split, 'miweb.com/#inicio')).toEqual({ kind: 'navigate' });
    // Sin sufijo que conservar no hay nada que distinguir.
    expect(classifyAddressEdit(splitAddress('https://miweb.com/', DERIV)!, 'otrapagina.com/')).toEqual({ kind: 'navigate' });
  });
});

describe('guardar la base nueva en la dirección personalizada', () => {
  it('cambia solo la dirección y conserva el destino y el estado', () => {
    const result = renameCustomAddressBase([DERIV, APP], 'deriv', 'otrapagina.com', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry).toMatchObject({ id: 'deriv', target: 'https://bot.deriv.me/', address: 'https://otrapagina.com/', enabled: true, updatedAt: NOW.toISOString() });
    expect(result.entries).toHaveLength(2);
  });

  it('rechaza conflictos y una base igual al destino', () => {
    expect(renameCustomAddressBase([DERIV, APP], 'deriv', 'miapp.com/v2', NOW)).toMatchObject({ ok: false });
    expect(renameCustomAddressBase([DERIV, APP], 'deriv', 'bot.deriv.me', NOW)).toMatchObject({ ok: false, errors: { address: 'same-as-target' } });
    expect(renameCustomAddressBase([DERIV], 'otra', 'x.com', NOW)).toMatchObject({ ok: false });
  });

  it('al migrar, las reglas antiguas idénticas (una por fragmento) quedan en una sola entrada', () => {
    const issues: string[] = [];
    const legacy = (id: string, pattern: string) => ({ id, matchType: 'prefix', pattern, alias: 'miweb.com', enabled: true });
    const entries = sanitizeCustomAddresses([legacy('a', 'https://bot.deriv.me/'), legacy('b', 'https://bot.deriv.me/#inicio'), legacy('c', 'https://bot.deriv.me/#chart')], issues);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ target: 'https://bot.deriv.me/', address: 'https://miweb.com/', enabled: true });
    expect(issues.filter((issue) => issue.endsWith(':duplicate'))).toHaveLength(2);
  });
});
