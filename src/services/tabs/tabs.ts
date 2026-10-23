/**
 * Reducer puro de pestañas e historial. Los identificadores y marcas de tiempo se
 * reciben en las acciones para que el reducer sea determinista y fácil de probar.
 */

import type { HistoryEntry, PageEntry, SessionState, Tab } from '../../types/tabs';

export const MAX_TABS = 30;
export const MAX_HISTORY = 50;

export function createHistoryEntry(page: PageEntry, id: string, now: number): HistoryEntry {
  return { id, page, createdAt: now };
}

export function createTab(id: string, entry: HistoryEntry): Tab {
  return { id, entries: [entry], index: 0, loading: false, reloadToken: 0 };
}

export function createSession(tab: Tab): SessionState {
  return { tabs: [tab], activeTabId: tab.id };
}

export type SessionAction =
  | { type: 'tab/create'; tab: Tab; position?: 'end' | 'after-active' }
  | { type: 'tab/close'; tabId: string; replacement: Tab }
  | { type: 'tab/activate'; tabId: string }
  | { type: 'tab/activate-relative'; offset: number }
  | { type: 'tab/navigate'; tabId: string; entry: HistoryEntry }
  | { type: 'tab/replace'; tabId: string; page: PageEntry }
  | { type: 'tab/back'; tabId: string }
  | { type: 'tab/forward'; tabId: string }
  | { type: 'tab/reload'; tabId: string }
  | { type: 'tab/loading'; tabId: string; loading: boolean }
  | { type: 'tab/mark-opened'; tabId: string; entryId: string }
  | { type: 'session/replace'; state: SessionState };

export function getActiveTab(state: SessionState): Tab {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0]!;
}

export function getCurrentEntry(tab: Tab): HistoryEntry {
  return tab.entries[tab.index] ?? tab.entries[0]!;
}

export const canGoBack = (tab: Tab): boolean => tab.index > 0;
export const canGoForward = (tab: Tab): boolean => tab.index < tab.entries.length - 1;

function updateTab(state: SessionState, tabId: string, update: (tab: Tab) => Tab): SessionState {
  let changed = false;
  const tabs = state.tabs.map((tab) => {
    if (tab.id !== tabId) return tab;
    const next = update(tab);
    if (next !== tab) changed = true;
    return next;
  });
  return changed ? { ...state, tabs } : state;
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'tab/create': {
      if (state.tabs.length >= MAX_TABS) return state;
      const tabs = [...state.tabs];
      if (action.position === 'after-active') {
        const index = tabs.findIndex((tab) => tab.id === state.activeTabId);
        tabs.splice(index + 1, 0, action.tab);
      } else {
        tabs.push(action.tab);
      }
      return { tabs, activeTabId: action.tab.id };
    }
    case 'tab/close': {
      const index = state.tabs.findIndex((tab) => tab.id === action.tabId);
      if (index < 0) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== action.tabId);
      // Al cerrar la última pestaña se abre una nueva, como en los navegadores de escritorio.
      if (tabs.length === 0) return createSession(action.replacement);
      if (state.activeTabId !== action.tabId) return { ...state, tabs };
      const neighbor = tabs[Math.min(index, tabs.length - 1)]!;
      return { tabs, activeTabId: neighbor.id };
    }
    case 'tab/activate':
      return state.tabs.some((tab) => tab.id === action.tabId) && state.activeTabId !== action.tabId
        ? { ...state, activeTabId: action.tabId }
        : state;
    case 'tab/activate-relative': {
      if (state.tabs.length < 2) return state;
      const index = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
      const next = (index + action.offset + state.tabs.length) % state.tabs.length;
      return { ...state, activeTabId: state.tabs[next]!.id };
    }
    case 'tab/navigate':
      return updateTab(state, action.tabId, (tab) => {
        const entries = [...tab.entries.slice(0, tab.index + 1), action.entry].slice(-MAX_HISTORY);
        return { ...tab, entries, index: entries.length - 1 };
      });
    case 'tab/replace':
      return updateTab(state, action.tabId, (tab) => {
        const current = getCurrentEntry(tab);
        const entries = tab.entries.map((entry, i) => (i === tab.index ? { ...current, page: action.page } : entry));
        return { ...tab, entries };
      });
    case 'tab/back':
      return updateTab(state, action.tabId, (tab) => (canGoBack(tab) ? { ...tab, index: tab.index - 1 } : tab));
    case 'tab/forward':
      return updateTab(state, action.tabId, (tab) => (canGoForward(tab) ? { ...tab, index: tab.index + 1 } : tab));
    case 'tab/reload':
      return updateTab(state, action.tabId, (tab) => ({ ...tab, reloadToken: tab.reloadToken + 1 }));
    case 'tab/loading':
      return updateTab(state, action.tabId, (tab) => (tab.loading === action.loading ? tab : { ...tab, loading: action.loading }));
    case 'tab/mark-opened':
      return updateTab(state, action.tabId, (tab) => {
        let changed = false;
        const entries = tab.entries.map((entry) => {
          if (entry.id !== action.entryId || entry.page.kind !== 'external' || entry.page.openedExternally) return entry;
          changed = true;
          return { ...entry, page: { ...entry.page, openedExternally: true } };
        });
        return changed ? { ...tab, entries } : tab;
      });
    case 'session/replace':
      return action.state;
  }
}
