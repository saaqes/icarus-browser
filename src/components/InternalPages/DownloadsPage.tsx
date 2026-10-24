/** Página icarus://descargas: lista real de descargas del motor. */

import { useDownloads, useNative } from '../../hooks/useNative';
import { useMessages } from '../../i18n';
import { formatBytes } from '../../services/format';
import type { DownloadItemInfo } from '../../types/native';
import { Icon } from '../common/Icon';
import { useToast } from '../common/Toast';
import { DesktopOnlyNotice } from './DesktopOnlyNotice';
import './InternalPages.css';

export function DownloadRow({ item, compact = false }: { item: DownloadItemInfo; compact?: boolean }) {
  const m = useMessages();
  const t = m.downloads;
  const native = useNative();
  const notify = useToast();
  if (!native) return null;
  const inProgress = item.state === 'progressing' || item.state === 'paused';
  const percent = item.totalBytes > 0 ? Math.min(100, Math.round((item.receivedBytes / item.totalBytes) * 100)) : null;
  const size =
    item.totalBytes > 0
      ? `${formatBytes(item.receivedBytes, m.locale)} / ${formatBytes(item.totalBytes, m.locale)}`
      : formatBytes(item.receivedBytes, m.locale);

  return (
    <li className={`download-row download-row--${item.state}${compact ? ' download-row--compact' : ''}`}>
      <Icon name={item.dangerous ? 'warning' : 'page'} size={20} />
      <div className="download-row__info">
        <p className="download-row__name">{item.filename}</p>
        <p className="download-row__status">
          {t.states[item.state]}
          {inProgress && ` · ${size}`}
          {item.state === 'completed' && ` · ${formatBytes(item.totalBytes || item.receivedBytes, m.locale)}`}
        </p>
        {inProgress && (
          <div className="download-row__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-label={item.filename}>
            <span style={{ width: percent === null ? '40%' : `${percent}%` }} className={percent === null ? 'is-indeterminate' : undefined} />
          </div>
        )}
        {!compact && <p className="download-row__url mono">{item.url}</p>}
        {item.state === 'completed' && item.dangerous && <p className="download-row__warning">{t.dangerous}</p>}
      </div>
      <div className="download-row__actions">
        {inProgress && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => native.downloads.cancel(item.id)}>
            {m.common.cancel}
          </button>
        )}
        {item.state === 'completed' && item.canOpen && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              void native.downloads.open(item.id).then((opened) => {
                if (!opened) notify('error', t.openFailed);
              });
            }}
          >
            {t.open}
          </button>
        )}
        {item.state === 'completed' && (
          <button type="button" className="icon-btn icon-btn--sm" aria-label={t.showInFolder} title={t.showInFolder} onClick={() => native.downloads.showInFolder(item.id)}>
            <Icon name="folder" size={16} />
          </button>
        )}
      </div>
    </li>
  );
}

export function DownloadsPage() {
  const m = useMessages();
  const t = m.downloads;
  const native = useNative();
  const downloads = useDownloads();
  if (!native) return <DesktopOnlyNotice title={t.title} />;
  return (
    <section className="list-page" aria-labelledby="downloads-title">
      <header className="list-page__header">
        <h1 id="downloads-title">
          <Icon name="download" size={22} />
          {t.title}
        </h1>
        {downloads.length > 0 && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => native.downloads.clear()}>
            {t.clear}
          </button>
        )}
      </header>
      {downloads.length === 0 ? (
        <p className="list-page__empty">{t.empty}</p>
      ) : (
        <ul className="download-list">
          {downloads.map((item) => (
            <DownloadRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}
