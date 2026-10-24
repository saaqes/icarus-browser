/**
 * Permisos de los sitios. Cámara, micrófono, ubicación, notificaciones,
 * portapapeles y MIDI se preguntan al usuario; el resto se deniega. Las
 * decisiones se recuerdan por origen durante la sesión.
 */

import { randomUUID } from 'node:crypto';
import type { Session, WebContents } from 'electron';
import type { PermissionKind, PermissionRequestInfo } from '../../src/types/native';

const AUTO_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);

function kindFor(permission: string): PermissionKind | null {
  switch (permission) {
    case 'media':
      return 'media';
    case 'geolocation':
      return 'geolocation';
    case 'notifications':
      return 'notifications';
    case 'clipboard-read':
      return 'clipboard-read';
    case 'midi':
      return 'midi';
    default:
      return null;
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

interface Pending {
  info: PermissionRequestInfo;
  callback: (granted: boolean) => void;
}

export class PermissionManager {
  private readonly pending = new Map<string, Pending>();
  private readonly decisions = new Map<string, boolean>();

  constructor(
    private readonly resolveTab: (contents: WebContents) => string | null,
    private readonly emitRequest: (request: PermissionRequestInfo) => void,
    private readonly emitCancelled: (id: string) => void,
  ) {}

  attach(webSession: Session): void {
    webSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      if (AUTO_ALLOW.has(permission)) return callback(true);
      const kind = kindFor(permission);
      const origin = originOf(details.requestingUrl ?? contents.getURL());
      const tabId = this.resolveTab(contents);
      if (!kind || !origin || origin === 'null' || !tabId) return callback(false);
      const key = `${origin}|${kind}`;
      const remembered = this.decisions.get(key);
      if (remembered !== undefined) return callback(remembered);
      const mediaTypes = 'mediaTypes' in details && Array.isArray(details.mediaTypes)
        ? details.mediaTypes.filter((type): type is 'audio' | 'video' => type === 'audio' || type === 'video')
        : [];
      const info: PermissionRequestInfo = { id: randomUUID(), tabId, origin, permission: kind, mediaTypes };
      this.pending.set(info.id, { info, callback });
      this.emitRequest(info);
    });

    webSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
      if (AUTO_ALLOW.has(permission)) return true;
      const kind = kindFor(permission);
      if (!kind) return false;
      return this.decisions.get(`${originOf(requestingOrigin)}|${kind}`) === true;
    });

    // Compartir pantalla requiere un selector propio que aún no existe: se deniega.
    webSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));

    // Dispositivos USB, HID y serie: tampoco hay selector, así que se cancelan
    // todas las solicitudes en lugar de dejar que Electron elija uno.
    webSession.setDevicePermissionHandler(() => false);
    webSession.on('select-hid-device', (event, _details, callback) => {
      event.preventDefault();
      callback();
    });
    webSession.on('select-usb-device', (event, _details, callback) => {
      event.preventDefault();
      callback();
    });
    webSession.on('select-serial-port', (event, _ports, _contents, callback) => {
      event.preventDefault();
      callback('');
    });
  }

  respond(id: string, granted: boolean): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    this.decisions.set(`${pending.info.origin}|${pending.info.permission}`, granted);
    pending.callback(granted);
  }

  /** Cancela (deniega) las solicitudes de una pestaña al navegar o cerrarla. */
  cancelForTab(tabId: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.info.tabId !== tabId) continue;
      this.pending.delete(id);
      pending.callback(false);
      this.emitCancelled(id);
    }
  }

  clearDecisions(): void {
    this.decisions.clear();
  }
}
