/** Persistencia opcional de la sesión (solo si el usuario elige restaurar pestañas). */

import { SETTINGS_SECTIONS, type HistoryEntry, type PageEntry, type SessionState, type Tab } from '../../types/tabs';
import type { DocumentSchema } from '../persistence/document';
import { STORAGE_KEYS } from '../persistence/keys';
import { isRecord } from '../persistence/validation';
import { parseWebUrl } from '../url-resolution/urlUtils';
import { MAX_HISTORY, MAX_TABS } from './tabs';

export type StoredSession = SessionState | null;

function readPage(raw: unknown): PageEntry | null {
  if (!isRecord(raw)) return null;
  switch (raw.kind) {
    case 'newtab':
      return { kind: 'newtab' };
    case 'blank':
      return { kind: 'blank' };
    case 'settings':
      return (SETTINGS_SECTIONS as readonly unknown[]).includes(raw.section)
        ? { kind: 'settings', section: raw.section as (typeof SETTINGS_SECTIONS)[number] }
        : null;
    case 'external': {
      const url = typeof raw.url === 'string' ? parseWebUrl(raw.url) : null;
      // Al restaurar no se reabre nada automáticamente: la página queda pendiente.
      return url ? { kind: 'external', url: url.href, openedExternally: false } : null;
    }
    default:
      return null;
  }
}

function readTab(raw: unknown): Tab | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !Array.isArray(raw.entries)) return null;
  const entries: HistoryEntry[] = [];
  for (const item of raw.entries.slice(-MAX_HISTORY)) {
    if (!isRecord(item) || typeof item.id !== 'string') continue;
    const page = readPage(item.page);
    if (page) entries.push({ id: item.id, page, createdAt: typeof item.createdAt === 'number' ? item.createdAt : 0 });
  }
  if (entries.length === 0) return null;
  const index = typeof raw.index === 'number' ? Math.max(0, Math.min(entries.length - 1, Math.floor(raw.index))) : entries.length - 1;
  return { id: raw.id, entries, index, loading: false, reloadToken: 0 };
}

export function sanitizeSession(raw: unknown, issues: string[]): StoredSession {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw) || !Array.isArray(raw.tabs)) {
    issues.push('session');
    return null;
  }
  const ids = new Set<string>();
  const tabs = raw.tabs
    .slice(0, MAX_TABS)
    .map(readTab)
    .filter((tab): tab is Tab => tab !== null && !ids.has(tab.id) && Boolean(ids.add(tab.id)));
  if (tabs.length === 0) {
    issues.push('session.tabs');
    return null;
  }
  const activeTabId = tabs.some((tab) => tab.id === raw.activeTabId) ? (raw.activeTabId as string) : tabs[0]!.id;
  return { tabs, activeTabId };
}

export const sessionSchema: DocumentSchema<StoredSession> = {
  key: STORAGE_KEYS.session,
  version: 1,
  defaults: () => null,
  sanitize: sanitizeSession,
};
