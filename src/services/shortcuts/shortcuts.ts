/** Operaciones puras sobre los accesos directos de la página de inicio. */

import type { Shortcut, ShortcutInput } from '../../types/shortcuts';
import type { DocumentSchema } from '../persistence/document';
import { STORAGE_KEYS } from '../persistence/keys';
import { isRecord, readIsoDate } from '../persistence/validation';
import { normalizeUserUrl } from '../url-resolution/urlUtils';

export const MAX_SHORTCUTS = 24;
export const SHORTCUT_TITLE_MAX = 40;

export type ShortcutFieldError =
  | 'required'
  | 'too-long'
  | 'invalid-url'
  | 'unsafe-protocol'
  | 'alias-url'
  | 'duplicate-url';

export type ShortcutErrors = Partial<Record<keyof ShortcutInput, ShortcutFieldError>>;

export type ShortcutValidation = { ok: true; value: ShortcutInput } | { ok: false; errors: ShortcutErrors };

export type ShortcutMutation =
  | { ok: true; shortcuts: Shortcut[]; shortcut: Shortcut }
  | { ok: false; errors: ShortcutErrors; limit?: boolean };

const EPOCH = '2026-01-01T00:00:00.000Z';

const DEFAULT_SHORTCUTS: ReadonlyArray<ShortcutInput & { id: string }> = [
  { id: 'default-google', title: 'Google', url: 'https://www.google.com/' },
  { id: 'default-youtube', title: 'YouTube', url: 'https://www.youtube.com/' },
  { id: 'default-wikipedia', title: 'Wikipedia', url: 'https://es.wikipedia.org/' },
  { id: 'default-github', title: 'GitHub', url: 'https://github.com/' },
  { id: 'default-gmail', title: 'Gmail', url: 'https://mail.google.com/' },
  { id: 'default-outlook', title: 'Outlook', url: 'https://outlook.live.com/' },
];

export function createDefaultShortcuts(now: Date = new Date(EPOCH)): Shortcut[] {
  const timestamp = now.toISOString();
  return DEFAULT_SHORTCUTS.map((item) => ({ ...item, createdAt: timestamp, updatedAt: timestamp }));
}

export function validateShortcutInput(
  input: ShortcutInput,
  existing: Shortcut[] = [],
  editingId?: string,
): ShortcutValidation {
  const errors: ShortcutErrors = {};
  const title = input.title.trim();
  if (!title) errors.title = 'required';
  else if (title.length > SHORTCUT_TITLE_MAX) errors.title = 'too-long';

  const normalized = normalizeUserUrl(input.url);
  let url = '';
  if (!normalized.ok) {
    errors.url =
      normalized.reason === 'empty'
        ? 'required'
        : normalized.reason === 'alias'
          ? 'alias-url'
          : normalized.reason === 'invalid'
            ? 'invalid-url'
            : 'unsafe-protocol';
  } else {
    url = normalized.url;
    if (existing.some((shortcut) => shortcut.id !== editingId && shortcut.url === url)) errors.url = 'duplicate-url';
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: { title, url } };
}

export function addShortcut(
  shortcuts: Shortcut[],
  input: ShortcutInput,
  context: { id: string; now: Date },
): ShortcutMutation {
  if (shortcuts.length >= MAX_SHORTCUTS) return { ok: false, errors: {}, limit: true };
  const result = validateShortcutInput(input, shortcuts);
  if (!result.ok) return result;
  const timestamp = context.now.toISOString();
  const shortcut: Shortcut = { id: context.id, ...result.value, createdAt: timestamp, updatedAt: timestamp };
  return { ok: true, shortcuts: [...shortcuts, shortcut], shortcut };
}

export function updateShortcut(shortcuts: Shortcut[], id: string, input: ShortcutInput, now: Date): ShortcutMutation {
  const current = shortcuts.find((shortcut) => shortcut.id === id);
  if (!current) return { ok: false, errors: {} };
  const result = validateShortcutInput(input, shortcuts, id);
  if (!result.ok) return result;
  const shortcut: Shortcut = { ...current, ...result.value, updatedAt: now.toISOString() };
  return { ok: true, shortcuts: shortcuts.map((item) => (item.id === id ? shortcut : item)), shortcut };
}

export function removeShortcut(shortcuts: Shortcut[], id: string): Shortcut[] {
  return shortcuts.filter((shortcut) => shortcut.id !== id);
}

/** Mueve un acceso a la posición `toIndex` (se limita al rango válido). */
export function moveShortcut(shortcuts: Shortcut[], id: string, toIndex: number): Shortcut[] {
  const from = shortcuts.findIndex((shortcut) => shortcut.id === id);
  if (from < 0) return shortcuts;
  const target = Math.max(0, Math.min(shortcuts.length - 1, toIndex));
  if (target === from) return shortcuts;
  const next = [...shortcuts];
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item!);
  return next;
}

export function sanitizeShortcuts(raw: unknown, issues: string[]): Shortcut[] {
  if (!Array.isArray(raw)) {
    issues.push('shortcuts');
    return createDefaultShortcuts();
  }
  const result: Shortcut[] = [];
  const ids = new Set<string>();
  raw.slice(0, MAX_SHORTCUTS).forEach((item, index) => {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id)) {
      issues.push(`shortcuts[${index}]`);
      return;
    }
    const validation = validateShortcutInput(
      { title: typeof item.title === 'string' ? item.title : '', url: typeof item.url === 'string' ? item.url : '' },
      result,
    );
    if (!validation.ok) {
      issues.push(`shortcuts[${index}]`);
      return;
    }
    ids.add(item.id);
    const ignored: string[] = [];
    result.push({
      id: item.id,
      ...validation.value,
      createdAt: readIsoDate(item.createdAt, EPOCH, 'createdAt', ignored),
      updatedAt: readIsoDate(item.updatedAt, EPOCH, 'updatedAt', ignored),
    });
  });
  return result;
}

export const shortcutsSchema: DocumentSchema<Shortcut[]> = {
  key: STORAGE_KEYS.shortcuts,
  version: 1,
  defaults: () => createDefaultShortcuts(),
  sanitize: sanitizeShortcuts,
};
