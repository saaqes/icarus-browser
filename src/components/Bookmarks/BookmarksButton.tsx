/**
 * Botón «Favoritos» de la barra (como el de Edge): lista los favoritos por carpeta
 * y abre uno con un clic. Desde aquí se llega a icarus://favoritos para editarlos.
 */

import { useRef, useState } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import { useBookmarks, useCustomAddresses } from '../../hooks/useStores';
import { useMessages } from '../../i18n';
import { shortAddress } from '../../services/custom-addresses/display';
import { visibleAddress } from '../AddressBar/suggestions';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { Favicon } from '../common/Favicon';
import { Icon } from '../common/Icon';
import { useOverlayLayer } from '../common/overlayLayer';

const MAX_SHOWN = 60;

export function BookmarksButton() {
  const m = useMessages();
  const t = m.bookmarks;
  const [data] = useBookmarks();
  const [customAddresses] = useCustomAddresses();
  const { openUrl, openPage } = useBrowser();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDismiss(panelRef, open, () => setOpen(false), buttonRef);
  useOverlayLayer(open);

  let shown = 0;
  const groups = data.folders
    .map((folder) => ({ folder, items: data.items.filter((item) => item.folderId === folder.id) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="toolbar-popover-root">
      <button
        ref={buttonRef}
        type="button"
        className="icon-btn"
        aria-label={m.toolbar.bookmarks}
        title={`${m.toolbar.bookmarks} (Ctrl+Mayús+O)`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        data-testid="bookmarks-button"
      >
        <Icon name="bookmarks" />
      </button>
      {open && (
        <div ref={panelRef} className="toolbar-popover toolbar-popover--wide bookmarks-hub" role="dialog" aria-label={t.title}>
          <h2 className="toolbar-popover__title">
            <Icon name="bookmarks" size={18} />
            {t.title}
          </h2>
          {groups.length === 0 ? (
            <p className="bookmarks-hub__empty">{t.empty}</p>
          ) : (
            <div className="bookmarks-hub__list">
              {groups.map(({ folder, items }) => (
                <section key={folder.id} className="bookmarks-hub__folder" aria-label={folder.name}>
                  {data.folders.length > 1 && (
                    <h3 className="bookmarks-hub__folder-name">
                      <Icon name="folder" size={14} />
                      {folder.name}
                    </h3>
                  )}
                  <ul>
                    {items.map((item) => {
                      if (shown >= MAX_SHOWN) return null;
                      shown += 1;
                      const address = shortAddress(visibleAddress(item.url, customAddresses));
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            className="bookmarks-hub__item"
                            title={address}
                            onClick={() => {
                              setOpen(false);
                              openUrl(item.url);
                            }}
                          >
                            <Favicon url={item.url} label={item.title} size={16} />
                            <span className="bookmarks-hub__title">{item.title}</span>
                            <span className="bookmarks-hub__address">{address}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setOpen(false);
              openPage({ kind: 'bookmarks' }, { newTab: true });
            }}
          >
            {t.manage}
          </button>
        </div>
      )}
    </div>
  );
}
