/** Botón de descargas: aparece cuando hay descargas y muestra su progreso real. */

import { useRef, useState } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import { useDownloads, useNative } from '../../hooks/useNative';
import { useMessages } from '../../i18n';
import { Icon } from '../common/Icon';
import { useOverlayLayer } from '../common/overlayLayer';
import { DownloadRow } from '../InternalPages/DownloadsPage';
import { useBrowser } from './BrowserContext';

export function DownloadsButton() {
  const m = useMessages();
  const native = useNative();
  const downloads = useDownloads();
  const { openPage } = useBrowser();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDismiss(panelRef, open, () => setOpen(false), buttonRef);
  useOverlayLayer(open);

  if (!native || downloads.length === 0) return null;
  const active = downloads.filter((item) => item.state === 'progressing' || item.state === 'paused');
  const received = active.reduce((sum, item) => sum + item.receivedBytes, 0);
  const total = active.reduce((sum, item) => sum + item.totalBytes, 0);
  const progress = active.length > 0 && total > 0 ? received / total : null;

  return (
    <div className="toolbar-popover-root">
      <button
        ref={buttonRef}
        type="button"
        className={`icon-btn downloads-btn${active.length ? ' is-active' : ''}`}
        aria-label={m.downloads.button(active.length)}
        title={m.downloads.button(active.length)}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={progress !== null ? ({ '--progress': `${Math.round(progress * 100)}%` } as React.CSSProperties) : undefined}
      >
        <Icon name="download" />
      </button>
      {open && (
        <div ref={panelRef} className="toolbar-popover toolbar-popover--wide" role="dialog" aria-label={m.downloads.title}>
          <h2 className="toolbar-popover__title">
            <Icon name="download" size={18} />
            {m.downloads.title}
          </h2>
          <ul className="download-list">
            {downloads.slice(0, 5).map((item) => (
              <DownloadRow key={item.id} item={item} compact />
            ))}
          </ul>
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setOpen(false);
              openPage({ kind: 'downloads' }, { newTab: true });
            }}
          >
            {m.downloads.viewAll}
          </button>
        </div>
      )}
    </div>
  );
}
