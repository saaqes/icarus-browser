/**
 * Preload de la interfaz de ICARUS (nunca se carga en las páginas web).
 * Expone una API mínima y tipada mediante contextBridge; ninguna función de
 * Node ni de Electron llega directamente a la interfaz.
 *
 * Al ejecutarse en un sandbox, este archivo no puede importar otros módulos
 * locales: solo `electron` (y tipos, que desaparecen al compilar).
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { IcarusNativeApi, NativeEvent } from '../../src/types/native';

interface Bootstrap {
  snapshot: Record<string, string>;
  appVersion: string;
  chromiumVersion: string;
  engineName: string;
  dataDirectory: string;
}

const bootstrap = (ipcRenderer.sendSync('icarus:bootstrap') as Bootstrap | null) ?? {
  snapshot: {},
  appVersion: '0.0.0',
  chromiumVersion: '',
  engineName: 'Chromium',
  dataDirectory: '',
};

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>;
const send = (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args);

const api: IcarusNativeApi = {
  apiVersion: 1,
  platform: process.platform,
  appVersion: bootstrap.appVersion,
  engineName: bootstrap.engineName,
  chromiumVersion: bootstrap.chromiumVersion,
  dataDirectory: bootstrap.dataDirectory,
  storage: {
    snapshot: bootstrap.snapshot,
    setItem: (key, value) => send('icarus:storage:set', key, value),
    removeItem: (key) => send('icarus:storage:remove', key),
  },
  tabs: {
    navigate: (tabId, url, options) => invoke('icarus:tabs:navigate', tabId, url, { newSegment: options.newSegment }),
    goBack: (tabId) => send('icarus:tabs:command', tabId, 'back'),
    goForward: (tabId) => send('icarus:tabs:command', tabId, 'forward'),
    reload: (tabId) => send('icarus:tabs:command', tabId, 'reload'),
    stop: (tabId) => send('icarus:tabs:command', tabId, 'stop'),
    close: (tabId) => send('icarus:tabs:command', tabId, 'close'),
    show: (tabId) => send('icarus:tabs:show', tabId),
    setBounds: (rect) => send('icarus:tabs:bounds', { x: rect.x, y: rect.y, width: rect.width, height: rect.height }),
    snapshot: (tabId) => invoke('icarus:tabs:snapshot', tabId),
    readerContent: (tabId) => invoke('icarus:tabs:reader', tabId),
    find: (tabId, text, options) => send('icarus:tabs:find', tabId, text, { forward: options.forward, next: options.next }),
    stopFind: (tabId) => send('icarus:tabs:stop-find', tabId),
    zoom: (tabId, action) => invoke('icarus:tabs:zoom', tabId, action),
  },
  window: {
    setTitleBarColors: ({ color, symbolColor }) => send('icarus:window:titlebar', color, symbolColor),
  },
  history: {
    list: () => invoke('icarus:history:list'),
    remove: (id) => invoke('icarus:history:remove', id),
  },
  downloads: {
    list: () => invoke('icarus:downloads:list'),
    cancel: (id) => send('icarus:downloads:command', id, 'cancel'),
    open: (id) => invoke('icarus:downloads:open', id),
    showInFolder: (id) => send('icarus:downloads:command', id, 'show-in-folder'),
    clear: () => send('icarus:downloads:clear'),
    chooseDirectory: () => invoke('icarus:downloads:choose-directory'),
  },
  shield: {
    getState: () => invoke('icarus:shield:get'),
    setEnabled: (enabled) => invoke('icarus:shield:set-enabled', enabled),
    setListEnabled: (id, enabled) => invoke('icarus:shield:set-list-enabled', id, enabled),
    addList: (name, url) => invoke('icarus:shield:add-list', name, url),
    removeList: (id) => invoke('icarus:shield:remove-list', id),
    updateLists: () => invoke('icarus:shield:update'),
    setCustomRules: (text) => invoke('icarus:shield:set-custom', text),
    setSiteAllowed: (hostname, allowed) => invoke('icarus:shield:set-site', hostname, allowed),
  },
  privacy: {
    clearData: (options) => invoke('icarus:privacy:clear', { ...options }),
  },
  permissions: {
    respond: (id, granted) => send('icarus:permissions:respond', id, granted),
  },
  auth: {
    respond: (id, credentials) =>
      send('icarus:auth:respond', id, credentials ? { username: credentials.username, password: credentials.password } : null),
  },
  preferences: {
    get: () => invoke('icarus:prefs:get'),
    set: (preferences) => invoke('icarus:prefs:set', JSON.parse(JSON.stringify(preferences))),
  },
  favicons: {
    get: (pageUrl) => invoke('icarus:favicons:get', pageUrl),
  },
  updates: {
    getState: () => invoke('icarus:updates:get'),
    check: () => invoke('icarus:updates:check'),
    download: (options) => send('icarus:updates:download', options.install === true),
    cancel: () => send('icarus:updates:cancel'),
    install: (when) => send('icarus:updates:install', when),
    postpone: () => send('icarus:updates:postpone'),
    setChannel: (channel) => send('icarus:updates:channel', channel),
    setAutoUpdate: (value) => send('icarus:updates:auto', value === true),
    acknowledge: () => send('icarus:updates:acknowledge'),
    reveal: () => send('icarus:updates:reveal'),
    readyToRestart: () => send('icarus:updates:restart-ready'),
  },
  onEvent: (listener) => {
    const wrapped = (_event: unknown, payload: NativeEvent) => listener(payload);
    ipcRenderer.on('icarus:event', wrapped);
    return () => {
      ipcRenderer.removeListener('icarus:event', wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('icarusNative', api);
