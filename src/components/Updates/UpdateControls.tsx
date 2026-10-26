/**
 * Piezas compartidas por Configuración → Actualizaciones y el botón de la barra:
 * mensaje de estado, progreso de la descarga y botones según el modo de
 * instalación de este equipo.
 */

import { useMemo } from 'react';
import { useNative } from '../../hooks/useNative';
import { useMessages } from '../../i18n';
import { formatBytes } from '../../services/format';
import type { UpdateChannel, UpdateState } from '../../types/native';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { Icon, type IconName } from '../common/Icon';
import './Updates.css';

export interface UpdateActions {
  check(): void;
  /** Descarga y verifica; con `install`, instala y reinicia al terminar. */
  download(install: boolean): void;
  cancel(): void;
  install(when: 'now' | 'on-quit'): void;
  postpone(): void;
  setChannel(channel: UpdateChannel): void;
  acknowledge(): void;
  /** Vuelve a mostrar el paquete descargado (modos manuales). */
  reveal(): void;
  openRelease(url: string): void;
}

export function useUpdateActions(): UpdateActions | null {
  const native = useNative();
  const { openUrl } = useBrowser();
  return useMemo(
    () =>
      native
        ? {
            check: () => void native.updates.check(),
            download: (install) => native.updates.download({ install }),
            cancel: () => native.updates.cancel(),
            install: (when) => native.updates.install(when),
            postpone: () => native.updates.postpone(),
            setChannel: (channel) => native.updates.setChannel(channel),
            acknowledge: () => native.updates.acknowledge(),
            reveal: () => native.updates.reveal(),
            openRelease: (url) => openUrl(url, { newTab: true }),
          }
        : null,
    [native, openUrl],
  );
}

const IN_PROGRESS: ReadonlyArray<UpdateState['status']> = ['downloading', 'verifying', 'ready', 'installing'];

/** Hay una descarga o instalación en marcha (no se busca ni se cambia de canal). */
export function isUpdateInProgress(state: UpdateState): boolean {
  return IN_PROGRESS.includes(state.status);
}

/** El aviso de la barra: hay una versión nueva que el usuario no ha pospuesto (o ya la está instalando). */
export function shouldShowUpdateButton(state: UpdateState | null): boolean {
  if (!state?.available || state.mode === 'unsupported') return false;
  return isUpdateInProgress(state) || state.available.version !== state.postponedVersion;
}

function statusLine(state: UpdateState, m: ReturnType<typeof useMessages>): { icon: IconName; text: string; tone: 'info' | 'success' | 'error' } | null {
  const t = m.updates;
  const version = state.available?.version ?? '';
  switch (state.status) {
    case 'checking':
      return { icon: 'reload', text: t.status.checking, tone: 'info' };
    case 'up-to-date':
      return { icon: 'check', text: t.status.upToDate, tone: 'success' };
    case 'available':
      return { icon: 'upgrade', text: t.status.available(version), tone: 'info' };
    case 'downloading':
      return { icon: 'download', text: t.status.downloading(version), tone: 'info' };
    case 'verifying':
      return { icon: 'shield', text: t.status.verifying, tone: 'info' };
    case 'ready':
      if (state.mode !== 'automatic') return { icon: 'check', text: t.status.readyManual(version), tone: 'success' };
      return { icon: 'check', text: state.installOnQuit ? t.status.readyOnQuit(version) : t.status.ready(version), tone: 'success' };
    case 'installing':
      return { icon: 'reload', text: t.status.installing, tone: 'info' };
    case 'error': {
      if (!state.error) return null;
      const failed = state.error.code === 'install-failed' && state.failedVersion;
      return { icon: 'warning', text: failed ? `${t.errors['install-failed']} ${t.failed(state.failedVersion!)}` : t.errors[state.error.code], tone: 'error' };
    }
    default:
      return null;
  }
}

/** Mensaje de estado y barra de progreso. */
export function UpdateStatus({ state }: { state: UpdateState }) {
  const m = useMessages();
  const line = statusLine(state, m);
  const progress = state.status === 'downloading' ? state.progress : null;
  const percent = progress && progress.total > 0 ? Math.min(100, Math.floor((progress.received / progress.total) * 100)) : null;
  if (!line) return null;
  return (
    <div className="update-status">
      <p className={`update-status__line update-status__line--${line.tone}`} role={line.tone === 'error' ? 'alert' : 'status'}>
        <Icon name={line.icon} size={16} />
        <span>{line.text}</span>
      </p>
      {(state.status === 'downloading' || state.status === 'verifying' || state.status === 'installing') && (
        <div
          className="update-status__bar"
          role="progressbar"
          aria-label={line.text}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
        >
          <span className={percent === null ? 'is-indeterminate' : undefined} style={percent === null ? undefined : { width: `${percent}%` }} />
        </div>
      )}
      {progress && percent !== null && (
        <p className="update-status__meta">{m.updates.progress(percent, formatBytes(progress.received, m.locale), formatBytes(progress.total, m.locale))}</p>
      )}
      {state.status === 'ready' && state.manualFile && <p className="update-status__meta mono selectable">{state.manualFile}</p>}
    </div>
  );
}

/** Botones que corresponden al estado actual. */
export function UpdateButtons({ state, actions, compact = false }: { state: UpdateState; actions: UpdateActions; compact?: boolean }) {
  const m = useMessages();
  const t = m.updates;
  const size = compact ? ' btn--sm' : '';
  const available = state.available;

  if (state.status === 'downloading') {
    return (
      <div className="manager-actions">
        <button type="button" className={`btn btn--subtle${size}`} onClick={actions.cancel}>
          {t.cancel}
        </button>
      </div>
    );
  }
  if (state.status === 'ready') {
    if (state.mode !== 'automatic') {
      return (
        <div className="manager-actions">
          <button type="button" className={`btn btn--primary${size}`} onClick={actions.reveal}>
            <Icon name="folder" size={16} />
            {t.showFile}
          </button>
        </div>
      );
    }
    return (
      <div className="manager-actions">
        <button type="button" className={`btn btn--primary${size}`} onClick={() => actions.install('now')}>
          <Icon name="reload" size={16} />
          {t.installNow}
        </button>
        {!state.installOnQuit && (
          <button type="button" className={`btn btn--ghost${size}`} onClick={() => actions.install('on-quit')}>
            {t.installOnQuit}
          </button>
        )}
      </div>
    );
  }
  if (state.status === 'verifying' || state.status === 'installing' || state.status === 'checking') return null;

  if (!available) {
    // Error al buscar o tras una instalación fallida: se vuelve a buscar.
    if (state.status !== 'error') return null;
    return (
      <div className="manager-actions">
        <button type="button" className={`btn btn--ghost${size}`} onClick={actions.check}>
          <Icon name="reload" size={16} />
          {t.retry}
        </button>
      </div>
    );
  }

  const retry = state.status === 'error';
  const postponed = available.version === state.postponedVersion;
  let primary;
  if (state.mode === 'manual-release' || !available.file) {
    primary = (
      <button type="button" className={`btn btn--primary${size}`} onClick={() => actions.openRelease(available.releasePage)}>
        <Icon name="external" size={16} />
        {t.openRelease}
      </button>
    );
  } else {
    const automatic = state.mode === 'automatic';
    primary = (
      <button type="button" className={`btn btn--primary${size}`} onClick={() => actions.download(automatic)}>
        <Icon name={automatic ? 'upgrade' : 'download'} size={16} />
        {retry ? t.retry : automatic ? t.updateNow : t.downloadUpdate}
      </button>
    );
  }
  return (
    <div className="manager-actions">
      {primary}
      {!postponed && !retry && (
        <button type="button" className={`btn btn--subtle${size}`} onClick={actions.postpone}>
          {t.later}
        </button>
      )}
    </div>
  );
}
