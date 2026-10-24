/**
 * Motor integrado de la aplicación de escritorio: Chromium (Electron) con una
 * vista web real por pestaña. La interfaz habla con él mediante el puente
 * `window.icarusNative` que expone el preload.
 */

import type { IcarusNativeApi } from '../../types/native';
import type { BrowserEngine, NavigationOutcome } from './engine';

export function createNativeEngine(native: IcarusNativeApi): BrowserEngine {
  return {
    info: {
      id: 'chromium-embedded',
      name: native.engineName || 'Chromium',
      kind: 'embedded',
      capabilities: {
        embeddedRendering: true,
        // Todas las pestañas comparten cookies y almacenamiento (un único perfil).
        isolatedTabSessions: false,
        nativeHistory: true,
        pageEvents: true,
      },
    },
    async navigate({ tabId, url, newSegment }): Promise<NavigationOutcome> {
      const result = await native.tabs.navigate(tabId, url, { newSegment: Boolean(newSegment) });
      return result.ok ? { status: 'rendered', url } : { status: 'rejected', reason: result.reason === 'invalid-url' ? 'unsafe-url' : result.reason };
    },
    goBack: (tabId) => native.tabs.goBack(tabId),
    goForward: (tabId) => native.tabs.goForward(tabId),
    reload: (tabId) => native.tabs.reload(tabId),
    stop: (tabId) => native.tabs.stop(tabId),
    detachTab: (tabId) => native.tabs.close(tabId),
  };
}
