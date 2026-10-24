import { describe, expect, it, vi } from 'vitest';
import { createExternalBrowserEngine } from '../../services/navigation/externalEngine';
import { describePage } from '../../services/tabs/pages';
import { sanitizeSession } from '../../services/tabs/session';
import {
  canGoBack,
  canGoForward,
  createHistoryEntry,
  createSession,
  createTab,
  getActiveTab,
  getCurrentEntry,
  sessionReducer,
} from '../../services/tabs/tabs';
import { createDefaultAliasRules } from '../../services/alias-rules';
import type { PageEntry } from '../../types/tabs';

const home: PageEntry = { kind: 'newtab' };
const tab = (id: string, page: PageEntry = home) => createTab(id, createHistoryEntry(page, `${id}-e0`, 0));
const external = (url: string): PageEntry => ({ kind: 'web', url, openedExternally: true });

describe('sessionReducer', () => {
  it('crea, activa y cierra pestañas', () => {
    let state = createSession(tab('a'));
    state = sessionReducer(state, { type: 'tab/create', tab: tab('b') });
    state = sessionReducer(state, { type: 'tab/create', tab: tab('c') });
    expect(state.tabs.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(state.activeTabId).toBe('c');

    state = sessionReducer(state, { type: 'tab/activate', tabId: 'a' });
    state = sessionReducer(state, { type: 'tab/create', tab: tab('d'), position: 'after-active' });
    expect(state.tabs.map((t) => t.id)).toEqual(['a', 'd', 'b', 'c']);

    state = sessionReducer(state, { type: 'tab/close', tabId: 'd', replacement: tab('r') });
    expect(state.activeTabId).toBe('b');
    state = sessionReducer(state, { type: 'tab/activate-relative', offset: 1 });
    expect(state.activeTabId).toBe('c');
    state = sessionReducer(state, { type: 'tab/activate-relative', offset: 1 });
    expect(state.activeTabId).toBe('a');
  });

  it('abre una pestaña nueva al cerrar la última', () => {
    const state = sessionReducer(createSession(tab('a')), { type: 'tab/close', tabId: 'a', replacement: tab('nueva') });
    expect(state.tabs.map((t) => t.id)).toEqual(['nueva']);
    expect(state.activeTabId).toBe('nueva');
  });

  it('gestiona el historial atrás/adelante y descarta el futuro al navegar', () => {
    let state = createSession(tab('a'));
    state = sessionReducer(state, { type: 'tab/navigate', tabId: 'a', entry: createHistoryEntry(external('https://uno.com/'), 'e1', 1) });
    state = sessionReducer(state, { type: 'tab/navigate', tabId: 'a', entry: createHistoryEntry(external('https://dos.com/'), 'e2', 2) });
    state = sessionReducer(state, { type: 'tab/back', tabId: 'a' });
    let active = getActiveTab(state);
    expect(getCurrentEntry(active).id).toBe('e1');
    expect(canGoBack(active) && canGoForward(active)).toBe(true);

    state = sessionReducer(state, { type: 'tab/navigate', tabId: 'a', entry: createHistoryEntry(home, 'e3', 3) });
    active = getActiveTab(state);
    expect(active.entries.map((e) => e.id)).toEqual(['a-e0', 'e1', 'e3']);
    expect(canGoForward(active)).toBe(false);
  });

  it('marca una página como abierta externamente', () => {
    let state = createSession(tab('a', { kind: 'web', url: 'https://x.com/', openedExternally: false }));
    state = sessionReducer(state, { type: 'tab/mark-opened', tabId: 'a', entryId: 'a-e0' });
    expect(getCurrentEntry(getActiveTab(state)).page).toEqual({ kind: 'web', url: 'https://x.com/', openedExternally: true });
  });
});

describe('sanitizeSession', () => {
  it('restaura solo páginas válidas y sin reabrirlas automáticamente', () => {
    const issues: string[] = [];
    const restored = sanitizeSession(
      {
        activeTabId: 'zzz',
        tabs: [
          { id: 'a', index: 5, entries: [{ id: '1', page: external('https://x.com/') }, { id: '2', page: { kind: 'external', url: 'javascript:1' } }] },
          { id: 'b', entries: [] },
        ],
      },
      issues,
    );
    expect(restored?.tabs).toHaveLength(1);
    expect(restored?.activeTabId).toBe('a');
    expect(restored?.tabs[0]?.entries[0]?.page).toEqual({ kind: 'web', url: 'https://x.com/', openedExternally: false });
    expect(restored?.tabs[0]?.index).toBe(0);
  });
});

describe('describePage', () => {
  const titles = { newTab: 'Nueva pestaña', blank: 'En blanco', settings: 'Configuración', history: 'Historial', downloads: 'Descargas' };

  it('muestra el alias sin perder la URL real', () => {
    const presentation = describePage(external('https://www.google.com/'), { rules: createDefaultAliasRules(), showAliases: true, titles });
    expect(presentation.alias?.rule.alias).toBe('buscar.icarus');
    expect(presentation.realUrl).toBe('https://www.google.com/');
    expect(presentation.title).toBe('Buscar');
    expect(presentation.protocol).toBe('https:');
  });

  it('no aplica alias si están desactivados en la configuración', () => {
    const presentation = describePage(external('https://www.google.com/'), { rules: createDefaultAliasRules(), showAliases: false, titles });
    expect(presentation.alias).toBeNull();
    expect(presentation.title).toBe('google.com');
  });

  it('describe páginas internas', () => {
    expect(describePage({ kind: 'settings', section: 'advanced' }, { rules: [], showAliases: true, titles })).toMatchObject({
      realUrl: 'icarus://configuracion/avanzado',
      title: 'Configuración',
      icon: 'settings',
    });
  });
});

describe('createExternalBrowserEngine', () => {
  it('abre solo URL http(s) con noopener y noreferrer', async () => {
    const open = vi.fn();
    const engine = createExternalBrowserEngine({ open });
    await expect(engine.navigate({ tabId: 't', url: 'https://example.com/' })).resolves.toEqual({
      status: 'opened-externally',
      url: 'https://example.com/',
    });
    expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
    await expect(engine.navigate({ tabId: 't', url: 'javascript:alert(1)' })).resolves.toEqual({ status: 'rejected', reason: 'unsafe-url' });
    expect(open).toHaveBeenCalledTimes(1);
    expect(engine.info.capabilities.embeddedRendering).toBe(false);
  });
});
