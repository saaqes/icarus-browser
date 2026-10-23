/**
 * Motor provisional: abre las páginas en el navegador predeterminado del sistema
 * (o en una pestaña nueva del navegador que aloja el prototipo web).
 *
 * No muestra la página dentro de ICARUS, no aísla sesiones y no recibe eventos de
 * la página. La interfaz lo comunica en la página interna de la pestaña.
 */

import { parseWebUrl } from '../url-resolution/urlUtils';
import type { BrowserEngine, NavigationOutcome } from './engine';

type WindowOpener = Pick<Window, 'open'>;

export function createExternalBrowserEngine(target: WindowOpener = window): BrowserEngine {
  return {
    info: {
      id: 'external-system-browser',
      name: 'Navegador externo del sistema',
      kind: 'external',
      capabilities: {
        embeddedRendering: false,
        isolatedTabSessions: false,
        nativeHistory: false,
        pageEvents: false,
      },
    },
    navigate({ url }) {
      const parsed = parseWebUrl(url);
      // Defensa en profundidad: solo http(s), aunque la interfaz ya lo haya validado.
      if (!parsed) return Promise.resolve<NavigationOutcome>({ status: 'rejected', reason: 'unsafe-url' });
      try {
        // `noopener` impide que la página abierta controle ICARUS; `noreferrer` no envía el origen.
        target.open(parsed.href, '_blank', 'noopener,noreferrer');
        return Promise.resolve<NavigationOutcome>({ status: 'opened-externally', url: parsed.href });
      } catch {
        return Promise.resolve<NavigationOutcome>({ status: 'failed', reason: 'open-error' });
      }
    },
  };
}
