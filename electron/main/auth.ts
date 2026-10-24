/**
 * Autenticación HTTP (Basic, Digest, NTLM…) de las páginas de las pestañas.
 * La interfaz pide el usuario y la contraseña; ICARUS no los guarda. Chromium
 * los recuerda en memoria para ese origen hasta cerrar ICARUS o borrar las
 * cookies y datos de sitios.
 *
 * Electron cancela por defecto cualquier autenticación: solo se intercepta la
 * de las páginas de una pestaña, así que las solicitudes internas (iconos,
 * listas de Shield) nunca muestran un diálogo.
 */

import { randomUUID } from 'node:crypto';
import type { App, AuthInfo, WebContents } from 'electron';
import type { AuthCredentials, AuthRequestInfo } from '../../src/types/native';

/** El realm lo envía el sitio: se recorta para que no ocupe el diálogo. */
const MAX_REALM_LENGTH = 150;

interface Pending {
  info: AuthRequestInfo;
  callback: (username?: string, password?: string) => void;
}

export function describeAuthRequest(id: string, tabId: string, requestUrl: string, authInfo: AuthInfo): AuthRequestInfo {
  let url: URL | null = null;
  try {
    url = new URL(requestUrl);
  } catch {
    url = null;
  }
  const proxyOrigin = `${authInfo.host}:${authInfo.port}`;
  return {
    id,
    tabId,
    origin: authInfo.isProxy || !url ? proxyOrigin : url.origin,
    realm: authInfo.realm.slice(0, MAX_REALM_LENGTH),
    scheme: authInfo.scheme.toLowerCase(),
    isProxy: authInfo.isProxy,
    secure: !authInfo.isProxy && url?.protocol === 'https:',
  };
}

export class AuthManager {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly resolveTab: (contents: WebContents) => string | null,
    private readonly emitRequest: (request: AuthRequestInfo) => void,
    private readonly emitCancelled: (id: string) => void,
  ) {}

  attach(app: App): void {
    app.on('login', (event, contents, details, authInfo, callback) => {
      const tabId = contents && !contents.isDestroyed() ? this.resolveTab(contents) : null;
      if (!tabId) return;
      event.preventDefault();
      const info = describeAuthRequest(randomUUID(), tabId, details.url, authInfo);
      this.pending.set(info.id, { info, callback });
      this.emitRequest(info);
    });
  }

  respond(id: string, credentials: AuthCredentials | null): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (credentials) pending.callback(credentials.username, credentials.password);
    else pending.callback();
  }

  /** Cancela las solicitudes de una pestaña al empezar otra navegación o cerrarla. */
  cancelForTab(tabId: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.info.tabId !== tabId) continue;
      this.pending.delete(id);
      pending.callback();
      this.emitCancelled(id);
    }
  }
}
