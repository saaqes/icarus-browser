import { describe, expect, it } from 'vitest';
import {
  createAliasRule,
  createDefaultAliasRules,
  deleteAliasRule,
  detectConflicts,
  exportAliasRules,
  filterAliasRules,
  findAliasMatch,
  mergeImportedRules,
  parseAliasRulesFile,
  resolveTypedAlias,
  sanitizeAliasRules,
  setAliasRuleEnabled,
  updateAliasRule,
  validateAliasRuleInput,
} from '../../services/alias-rules';
import type { AliasRule, AliasRuleInput } from '../../types/alias';

const NOW = new Date('2026-05-01T10:00:00.000Z');

function input(overrides: Partial<AliasRuleInput> = {}): AliasRuleInput {
  return {
    name: 'Regla',
    matchType: 'exact',
    pattern: 'https://www.example.com/',
    displayName: 'Ejemplo',
    alias: 'ejemplo.icarus',
    targetUrl: 'https://www.example.com/',
    enabled: true,
    ...overrides,
  };
}

function rule(id: string, overrides: Partial<AliasRuleInput> = {}, createdAt = NOW.toISOString()): AliasRule {
  const result = validateAliasRuleInput(input(overrides));
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return { ...result.value, id, createdAt, updatedAt: createdAt };
}

describe('validateAliasRuleInput', () => {
  it('normaliza y acepta una regla válida', () => {
    const result = validateAliasRuleInput(input({ alias: '  Ejemplo.ICARUS/ ', pattern: 'www.example.com' }));
    expect(result).toEqual({ ok: true, value: input({ alias: 'ejemplo.icarus', pattern: 'https://www.example.com/' }) });
  });

  it('exige los campos obligatorios', () => {
    const result = validateAliasRuleInput(input({ name: ' ', displayName: '', alias: '', pattern: '', targetUrl: '' }));
    expect(result).toEqual({
      ok: false,
      errors: { name: 'required', displayName: 'required', alias: 'required', pattern: 'required', targetUrl: 'required' },
    });
  });

  it('obliga a que el alias pertenezca al espacio reservado .icarus', () => {
    for (const alias of ['www.paypal.com', 'banco', 'https://x.com', 'icarus', 'mal_alias.icarus']) {
      expect(validateAliasRuleInput(input({ alias }))).toMatchObject({ ok: false, errors: { alias: 'alias-format' } });
    }
  });

  it('rechaza protocolos peligrosos en el patrón y en el destino', () => {
    expect(validateAliasRuleInput(input({ pattern: 'javascript:alert(1)' }))).toMatchObject({
      ok: false,
      errors: { pattern: 'unsafe-protocol' },
    });
    expect(validateAliasRuleInput(input({ targetUrl: 'data:text/html,hola' }))).toMatchObject({
      ok: false,
      errors: { targetUrl: 'unsafe-protocol' },
    });
  });

  it('no permite convertir HTTPS en HTTP', () => {
    expect(validateAliasRuleInput(input({ targetUrl: 'http://www.example.com/' }))).toMatchObject({
      ok: false,
      errors: { targetUrl: 'insecure-target' },
    });
    expect(validateAliasRuleInput(input({ matchType: 'host', pattern: 'example.com', targetUrl: 'http://example.com/' }))).toMatchObject({
      ok: false,
      errors: { targetUrl: 'insecure-target' },
    });
    // Se permite si el patrón ya es HTTP (no hay degradación) o si el destino es local.
    expect(validateAliasRuleInput(input({ pattern: 'http://intranet.example.com/', targetUrl: 'http://intranet.example.com/' })).ok).toBe(true);
    expect(validateAliasRuleInput(input({ targetUrl: 'http://localhost:3000/' })).ok).toBe(true);
  });

  it('impide que un alias apunte a otro alias (sin ciclos)', () => {
    expect(validateAliasRuleInput(input({ targetUrl: 'https://otro.icarus/' }))).toMatchObject({
      ok: false,
      errors: { targetUrl: 'target-is-alias' },
    });
    expect(validateAliasRuleInput(input({ pattern: 'otro.icarus' }))).toMatchObject({ ok: false, errors: { pattern: 'pattern-is-alias' } });
    expect(validateAliasRuleInput(input({ matchType: 'host', pattern: '*.icarus' }))).toMatchObject({ ok: false });
  });

  it('detecta alias duplicados solo entre reglas activas', () => {
    const existing = [rule('a')];
    expect(validateAliasRuleInput(input(), existing)).toMatchObject({ ok: false, errors: { alias: 'alias-duplicate' } });
    expect(validateAliasRuleInput(input({ enabled: false }), existing).ok).toBe(true);
    expect(validateAliasRuleInput(input(), existing, 'a').ok).toBe(true);
  });

  it('valida patrones de host con comodín', () => {
    expect(validateAliasRuleInput(input({ matchType: 'host', pattern: '*.Example.com' }))).toMatchObject({
      ok: true,
      value: { pattern: '*.example.com' },
    });
    expect(validateAliasRuleInput(input({ matchType: 'host', pattern: 'https://example.com/x' }))).toMatchObject({
      ok: false,
      errors: { pattern: 'invalid-host' },
    });
  });
});

describe('findAliasMatch', () => {
  const rules = [
    rule('exact', { pattern: 'https://docs.example.com/guia', alias: 'guia.icarus' }),
    rule('prefix', { matchType: 'prefix', pattern: 'https://docs.example.com/', alias: 'docs.icarus' }),
    rule('host', { matchType: 'host', pattern: 'docs.example.com', alias: 'host.icarus' }),
    rule('wild', { matchType: 'host', pattern: '*.example.com', alias: 'todo.icarus' }),
    rule('off', { pattern: 'https://off.example.com/', alias: 'off.icarus', enabled: false }),
  ];

  it('aplica la regla más específica', () => {
    expect(findAliasMatch('https://docs.example.com/guia', rules)?.rule.id).toBe('exact');
    expect(findAliasMatch('https://docs.example.com/guia#parte', rules)?.rule.id).toBe('exact');
    expect(findAliasMatch('https://docs.example.com/otra', rules)?.rule.id).toBe('prefix');
    expect(findAliasMatch('http://docs.example.com/otra', rules)?.rule.id).toBe('host');
    expect(findAliasMatch('https://api.example.com/', rules)?.rule.id).toBe('wild');
    expect(findAliasMatch('https://example.com/', rules)?.rule.id).toBe('wild');
    expect(findAliasMatch('https://example.org/', rules)).toBeNull();
  });

  it('ignora reglas desactivadas', () => {
    expect(findAliasMatch('https://off.example.com/', rules)?.rule.id).toBe('wild');
    expect(findAliasMatch('https://off.example.com/', rules.filter((r) => r.id === 'off'))).toBeNull();
  });

  it('respeta los límites de ruta del prefijo', () => {
    const prefixOnly = [rule('p', { matchType: 'prefix', pattern: 'https://a.com/docs', alias: 'p.icarus' })];
    expect(findAliasMatch('https://a.com/docs', prefixOnly)).not.toBeNull();
    expect(findAliasMatch('https://a.com/docs/x', prefixOnly)).not.toBeNull();
    expect(findAliasMatch('https://a.com/docs?x=1', prefixOnly)).not.toBeNull();
    expect(findAliasMatch('https://a.com/docsx', prefixOnly)).toBeNull();
  });

  it('en empate de especificidad gana la regla más antigua', () => {
    const older = rule('older', { alias: 'a.icarus' }, '2026-01-01T00:00:00.000Z');
    const newer = rule('newer', { alias: 'b.icarus' }, '2026-02-01T00:00:00.000Z');
    expect(findAliasMatch('https://www.example.com/', [newer, older])?.rule.id).toBe('older');
  });

  it('nunca aplica alias sobre URL que no son web', () => {
    expect(findAliasMatch('javascript:alert(1)', rules)).toBeNull();
    expect(findAliasMatch('icarus://configuracion', rules)).toBeNull();
  });
});

describe('resolveTypedAlias', () => {
  it('resuelve en un único paso hacia la URL de destino', () => {
    const rules = createDefaultAliasRules();
    expect(resolveTypedAlias('BUSCAR.icarus/', rules)).toMatchObject({ status: 'resolved', url: 'https://www.google.com/' });
    expect(resolveTypedAlias('wiki.icarus', rules)).toMatchObject({ status: 'disabled' });
    expect(resolveTypedAlias('google.com', rules)).toEqual({ status: 'not-alias' });
  });

  it('descarta destinos manipulados que apunten a un alias', () => {
    const tampered: AliasRule = { ...rule('t'), alias: 'x.icarus', targetUrl: 'https://y.icarus/' };
    expect(resolveTypedAlias('x.icarus', [tampered])).toEqual({ status: 'unknown', alias: 'x.icarus' });
  });
});

describe('detectConflicts', () => {
  it('informa de patrones duplicados, solapamientos y alias repetidos', () => {
    const a = rule('a', { alias: 'a.icarus' }, '2026-01-01T00:00:00.000Z');
    const b = rule('b', { alias: 'b.icarus' }, '2026-02-01T00:00:00.000Z');
    const host = rule('h', { matchType: 'host', pattern: 'www.example.com', alias: 'h.icarus' });
    const unrelated = rule('u', { pattern: 'https://otro.org/', alias: 'u.icarus' });
    const conflicts = detectConflicts([a, b, host, unrelated]);
    expect(conflicts).toContainEqual({ type: 'duplicate-pattern', winnerId: 'a', loserId: 'b' });
    expect(conflicts).toContainEqual({ type: 'overlap', winnerId: 'a', loserId: 'h' });
    expect(conflicts.some((c) => c.winnerId === 'u' || c.loserId === 'u')).toBe(false);

    const dupAlias = { ...b, alias: 'a.icarus', pattern: 'https://distinto.com/' };
    expect(detectConflicts([a, dupAlias])).toContainEqual({ type: 'duplicate-alias', winnerId: 'a', loserId: 'b' });
  });

  it('no considera reglas desactivadas', () => {
    const a = rule('a', { alias: 'a.icarus' });
    const b = { ...rule('b', { alias: 'b.icarus' }), enabled: false };
    expect(detectConflicts([a, b])).toEqual([]);
  });
});

describe('operaciones CRUD', () => {
  it('crea, edita, activa, desactiva y elimina reglas', () => {
    const created = createAliasRule([], input(), { id: 'r1', now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.rule).toMatchObject({ id: 'r1', createdAt: NOW.toISOString() });

    const later = new Date('2026-05-02T10:00:00.000Z');
    const updated = updateAliasRule(created.rules, 'r1', input({ displayName: 'Nuevo' }), later);
    expect(updated).toMatchObject({ ok: true, rule: { displayName: 'Nuevo', updatedAt: later.toISOString(), createdAt: NOW.toISOString() } });
    if (!updated.ok) return;

    const disabled = setAliasRuleEnabled(updated.rules, 'r1', false, later);
    expect(disabled.ok && disabled.rules[0]?.enabled).toBe(false);
    expect(deleteAliasRule(updated.rules, 'r1')).toEqual([]);
  });

  it('no permite activar una regla cuyo alias ya está en uso', () => {
    const rules = [rule('a'), { ...rule('b'), enabled: false }];
    expect(setAliasRuleEnabled(rules, 'b', true, NOW)).toMatchObject({ ok: false, conflictWith: { id: 'a' } });
  });

  it('filtra por nombre, alias, patrón o destino', () => {
    const rules = createDefaultAliasRules();
    expect(filterAliasRules(rules, 'WIKI').map((r) => r.id)).toEqual(['default-wiki']);
    expect(filterAliasRules(rules, 'google.com').map((r) => r.id)).toEqual(['default-search']);
    expect(filterAliasRules(rules, '')).toHaveLength(2);
  });
});

describe('persistencia e importación', () => {
  it('descarta reglas inválidas al cargar sin perder las válidas', () => {
    const issues: string[] = [];
    const valid = rule('ok');
    const result = sanitizeAliasRules([valid, { ...valid, id: 'bad', targetUrl: 'javascript:alert(1)' }, 'basura'], issues);
    expect(result.map((r) => r.id)).toEqual(['ok']);
    expect(issues).toHaveLength(2);
  });

  it('exporta e importa reglas combinándolas', () => {
    const existing = [rule('a', { alias: 'a.icarus' })];
    const file = exportAliasRules([rule('a', { alias: 'a.icarus', displayName: 'Cambiado' }), rule('b', { alias: 'a.icarus', pattern: 'https://b.com/' }), rule('c', { alias: 'c.icarus', pattern: 'https://c.com/' })], NOW);
    const parsed = parseAliasRulesFile(file);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const summary = mergeImportedRules(existing, [...parsed.items, { nope: true }], { now: NOW, createId: () => 'x' });
    expect(summary).toMatchObject({ added: 2, updated: 1, skipped: 1, disabled: 1 });
    expect(summary.rules.find((r) => r.id === 'a')?.displayName).toBe('Cambiado');
    expect(summary.rules.find((r) => r.id === 'b')?.enabled).toBe(false);
  });

  it('rechaza archivos con formato desconocido', () => {
    expect(parseAliasRulesFile('{')).toEqual({ ok: false, error: 'invalid-json' });
    expect(parseAliasRulesFile('{"format":"otro"}')).toEqual({ ok: false, error: 'invalid-format' });
  });
});
