import { describe, expect, it } from 'vitest';
import {
  addShortcut,
  createDefaultShortcuts,
  MAX_SHORTCUTS,
  moveShortcut,
  removeShortcut,
  sanitizeShortcuts,
  updateShortcut,
  validateShortcutInput,
} from '../../services/shortcuts/shortcuts';

const NOW = new Date('2026-05-01T10:00:00.000Z');

describe('accesos directos', () => {
  it('valida nombre y URL', () => {
    expect(validateShortcutInput({ title: ' Mi sitio ', url: 'example.com/inicio' })).toEqual({
      ok: true,
      value: { title: 'Mi sitio', url: 'https://example.com/inicio' },
    });
    expect(validateShortcutInput({ title: '', url: '' })).toEqual({ ok: false, errors: { title: 'required', url: 'required' } });
    expect(validateShortcutInput({ title: 'x', url: 'javascript:alert(1)' })).toMatchObject({ errors: { url: 'unsafe-protocol' } });
    expect(validateShortcutInput({ title: 'x', url: 'buscar.icarus' })).toMatchObject({ errors: { url: 'alias-url' } });
    expect(validateShortcutInput({ title: 'x', url: 'no válido' })).toMatchObject({ errors: { url: 'invalid-url' } });
    expect(validateShortcutInput({ title: 'x'.repeat(41), url: 'a.com' })).toMatchObject({ errors: { title: 'too-long' } });
  });

  it('añade, edita, elimina y reordena', () => {
    const added = addShortcut([], { title: 'Uno', url: 'uno.com' }, { id: '1', now: NOW });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const second = addShortcut(added.shortcuts, { title: 'Dos', url: 'dos.com' }, { id: '2', now: NOW });
    if (!second.ok) throw new Error('esperado');
    expect(addShortcut(second.shortcuts, { title: 'Repetido', url: 'https://uno.com/' }, { id: '3', now: NOW })).toMatchObject({
      ok: false,
      errors: { url: 'duplicate-url' },
    });

    const edited = updateShortcut(second.shortcuts, '1', { title: 'Uno bis', url: 'uno.com' }, NOW);
    expect(edited).toMatchObject({ ok: true, shortcut: { title: 'Uno bis', url: 'https://uno.com/' } });
    if (!edited.ok) return;

    expect(moveShortcut(edited.shortcuts, '2', 0).map((s) => s.id)).toEqual(['2', '1']);
    expect(moveShortcut(edited.shortcuts, '1', 99).map((s) => s.id)).toEqual(['2', '1']);
    expect(removeShortcut(edited.shortcuts, '1').map((s) => s.id)).toEqual(['2']);
  });

  it('respeta el máximo de accesos', () => {
    const many = Array.from({ length: MAX_SHORTCUTS }, (_, i) => ({
      id: String(i),
      title: `S${i}`,
      url: `https://s${i}.com/`,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    }));
    expect(addShortcut(many, { title: 'Otro', url: 'otro.com' }, { id: 'x', now: NOW })).toMatchObject({ ok: false, limit: true });
  });

  it('restaura predeterminados con URL reales y sanea datos dañados', () => {
    const defaults = createDefaultShortcuts();
    expect(defaults.every((s) => s.url.startsWith('https://'))).toBe(true);
    const issues: string[] = [];
    expect(sanitizeShortcuts('basura', issues)).toEqual(defaults);
    const cleaned = sanitizeShortcuts([defaults[0], { id: 'malo', title: 'x', url: 'javascript:1' }, defaults[0]], issues);
    expect(cleaned.map((s) => s.id)).toEqual([defaults[0]!.id]);
  });
});
