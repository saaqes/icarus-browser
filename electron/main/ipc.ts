/**
 * Canales IPC entre la interfaz y el proceso principal. Solo se aceptan
 * mensajes de la interfaz propia de ICARUS (nunca de las páginas web) y todos
 * los argumentos se validan antes de usarse.
 */

import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { ClearDataOptions, DesktopPreferences } from '../../src/types/native';
import type { DownloadManager } from './downloads';
import type { FaviconService } from './favicons';
import type { HistoryStore } from './history';
import type { AuthManager } from './auth';
import type { PermissionManager } from './permissions';
import { sanitizePreferences } from './preferences';
import type { ShieldService } from './shieldService';
import type { TabManager } from './tabs';
import type { UiStorage } from './uiStorage';
import type { UpdateService } from './updates';
import { ZOOM_ACTIONS } from './zoom';
import { assertBoolean, assertColor, assertId, assertOneOf, assertRect, assertString, IpcValidationError, isRecord } from './validate';

export interface IpcContext {
  window: BrowserWindow;
  isUiUrl: (url: string) => boolean;
  bootstrap: () => unknown;
  storage: UiStorage;
  tabs: TabManager;
  history: HistoryStore;
  downloads: DownloadManager;
  shield: ShieldService;
  permissions: PermissionManager;
  auth: AuthManager;
  favicons: FaviconService;
  getPreferences: () => DesktopPreferences;
  setPreferences: (preferences: DesktopPreferences) => DesktopPreferences;
  clearData: (options: ClearDataOptions) => Promise<void>;
  updates: UpdateService;
  setTitleBarColors: (color: string, symbolColor: string) => void;
}

const TAB_COMMANDS = ['back', 'forward', 'reload', 'stop', 'close'] as const;
const DOWNLOAD_COMMANDS = ['cancel', 'show-in-folder'] as const;
const RANGES = ['hour', 'day', 'week', 'all'] as const;
const UPDATE_CHANNELS = ['stable', 'preview'] as const;
const INSTALL_WHEN = ['now', 'on-quit'] as const;

export function registerIpc(context: IpcContext): void {
  const fromUi = (event: IpcMainEvent | IpcMainInvokeEvent) => {
    const url = event.senderFrame?.url ?? '';
    if (event.sender !== context.window.webContents || !context.isUiUrl(url)) {
      throw new IpcValidationError('remitente no autorizado');
    }
  };
  const on = (channel: string, handler: (...args: unknown[]) => void) => {
    ipcMain.on(channel, (event, ...args) => {
      try {
        fromUi(event);
        handler(...args);
      } catch (error) {
        console.warn(`[ipc] ${channel}:`, (error as Error).message);
      }
    });
  };
  const handle = (channel: string, handler: (...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, async (event, ...args) => {
      fromUi(event);
      return handler(...args);
    });
  };

  ipcMain.on('icarus:bootstrap', (event) => {
    try {
      fromUi(event);
      event.returnValue = context.bootstrap();
    } catch {
      event.returnValue = null;
    }
  });

  on('icarus:storage:set', (key, value) => {
    context.storage.set(assertString(key, 'key', 100), assertString(value, 'value', 8 * 1024 * 1024));
  });
  on('icarus:storage:remove', (key) => context.storage.remove(assertString(key, 'key', 100)));

  handle('icarus:tabs:navigate', (tabId, url, options) =>
    context.tabs.navigate(
      assertId(tabId, 'tabId'),
      assertString(url, 'url', 8192),
      isRecord(options) && options.newSegment === true,
    ),
  );
  on('icarus:tabs:find', (tabId, text, options) => {
    if (!isRecord(options)) throw new IpcValidationError('options');
    context.tabs.find(assertId(tabId, 'tabId'), assertString(text, 'text', 1000), {
      forward: assertBoolean(options.forward, 'forward'),
      next: assertBoolean(options.next, 'next'),
    });
  });
  on('icarus:tabs:stop-find', (tabId) => context.tabs.stopFind(assertId(tabId, 'tabId')));
  on('icarus:tabs:command', (tabId, command) => {
    const id = assertId(tabId, 'tabId');
    switch (assertOneOf(command, TAB_COMMANDS, 'command')) {
      case 'back':
        return context.tabs.goBack(id);
      case 'forward':
        return context.tabs.goForward(id);
      case 'reload':
        return context.tabs.reload(id);
      case 'stop':
        return context.tabs.stop(id);
      case 'close':
        return context.tabs.close(id);
    }
  });
  on('icarus:tabs:show', (tabId) => context.tabs.show(tabId === null ? null : assertId(tabId, 'tabId')));
  on('icarus:tabs:bounds', (rect) => context.tabs.setBounds(assertRect(rect)));
  handle('icarus:tabs:snapshot', (tabId) => context.tabs.snapshot(assertId(tabId, 'tabId')));
  handle('icarus:tabs:reader', (tabId) => context.tabs.readerContent(assertId(tabId, 'tabId')));
  handle('icarus:tabs:zoom', (tabId, action) => context.tabs.zoom(assertId(tabId, 'tabId'), assertOneOf(action, ZOOM_ACTIONS, 'action')));

  on('icarus:window:titlebar', (color, symbolColor) =>
    context.setTitleBarColors(assertColor(color, 'color'), assertColor(symbolColor, 'symbolColor')),
  );

  handle('icarus:history:list', () => context.history.list());
  handle('icarus:history:remove', (id) => context.history.remove(assertString(id, 'id', 64)));

  handle('icarus:downloads:list', () => context.downloads.list());
  on('icarus:downloads:command', (id, command) => {
    const downloadId = assertString(id, 'id', 64);
    if (assertOneOf(command, DOWNLOAD_COMMANDS, 'command') === 'cancel') context.downloads.cancel(downloadId);
    else context.downloads.showInFolder(downloadId);
  });
  handle('icarus:downloads:open', (id) => context.downloads.open(assertString(id, 'id', 64)));
  on('icarus:downloads:clear', () => context.downloads.clear());
  handle('icarus:downloads:choose-directory', () => context.downloads.chooseDirectory());

  handle('icarus:shield:get', () => context.shield.state());
  handle('icarus:shield:set-enabled', (enabled) => context.shield.setEnabled(assertBoolean(enabled, 'enabled')));
  handle('icarus:shield:set-list-enabled', (id, enabled) =>
    context.shield.setListEnabled(assertString(id, 'id', 64), assertBoolean(enabled, 'enabled')),
  );
  handle('icarus:shield:add-list', (name, url) => context.shield.addList(assertString(name, 'name', 200), assertString(url, 'url', 2048)));
  handle('icarus:shield:remove-list', (id) => context.shield.removeList(assertString(id, 'id', 64)));
  handle('icarus:shield:update', () => context.shield.updateLists(false));
  handle('icarus:shield:set-custom', (text) => context.shield.setCustomRules(assertString(text, 'text', 200_000)));
  handle('icarus:shield:set-site', (hostname, allowed) =>
    context.shield.setSiteAllowed(assertString(hostname, 'hostname', 253), assertBoolean(allowed, 'allowed')),
  );

  handle('icarus:privacy:clear', (options) => {
    if (!isRecord(options)) throw new IpcValidationError('options');
    return context.clearData({
      range: assertOneOf(options.range, RANGES, 'range'),
      history: assertBoolean(options.history, 'history'),
      cookies: assertBoolean(options.cookies, 'cookies'),
      cache: assertBoolean(options.cache, 'cache'),
      downloads: assertBoolean(options.downloads, 'downloads'),
    });
  });

  on('icarus:permissions:respond', (id, granted) => context.permissions.respond(assertString(id, 'id', 64), assertBoolean(granted, 'granted')));
  on('icarus:auth:respond', (id, credentials) => {
    if (credentials !== null && !isRecord(credentials)) throw new IpcValidationError('credentials');
    context.auth.respond(
      assertString(id, 'id', 64),
      credentials === null
        ? null
        : { username: assertString(credentials.username, 'username', 1024), password: assertString(credentials.password, 'password', 1024) },
    );
  });

  handle('icarus:prefs:get', () => context.getPreferences());
  handle('icarus:prefs:set', (preferences) => context.setPreferences(sanitizePreferences(preferences)));

  handle('icarus:favicons:get', (pageUrl) => context.favicons.forPage(assertString(pageUrl, 'pageUrl', 8192)));

  handle('icarus:updates:get', () => context.updates.getState());
  handle('icarus:updates:check', () => context.updates.check(true));
  on('icarus:updates:download', (install) => context.updates.download(assertBoolean(install, 'install')));
  on('icarus:updates:cancel', () => context.updates.cancel());
  on('icarus:updates:install', (when) => void context.updates.install(assertOneOf(when, INSTALL_WHEN, 'when')));
  on('icarus:updates:postpone', () => context.updates.postpone());
  on('icarus:updates:channel', (channel) => context.updates.setChannel(assertOneOf(channel, UPDATE_CHANNELS, 'channel')));
  on('icarus:updates:auto', (value) => context.updates.setAutoUpdate(assertBoolean(value, 'value')));
  on('icarus:updates:acknowledge', () => context.updates.acknowledge());
  on('icarus:updates:reveal', () => context.updates.reveal());
  on('icarus:updates:restart-ready', () => context.updates.readyToRestart());
}
