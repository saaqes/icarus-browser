/**
 * Página icarus://favoritos: favoritos por carpeta con búsqueda, abrir (en esta
 * pestaña o en otra), cambiar el nombre, mover de carpeta y eliminar; carpetas
 * propias (crear, renombrar y eliminar sin perder sus favoritos). Muestra la
 * dirección visible (la personalizada si existe), igual que la barra.
 */

import { useMemo, useState } from 'react';
import { useServices } from '../../app/ServicesContext';
import { useBookmarks, useCustomAddresses } from '../../hooks/useStores';
import { useMessages } from '../../i18n';
import { addFolder, DEFAULT_FOLDER_ID, removeBookmark, removeFolder, renameFolder, updateBookmark } from '../../services/bookmarks/bookmarks';
import { shortAddress } from '../../services/custom-addresses/display';
import type { Bookmark } from '../../types/bookmarks';
import { visibleAddress } from '../AddressBar/suggestions';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { Favicon } from '../common/Favicon';
import { Icon } from '../common/Icon';
import { useToast } from '../common/Toast';
import '../InternalPages/InternalPages.css';
import './Bookmarks.css';

export function BookmarksPage() {
  const m = useMessages();
  const t = m.bookmarks;
  const services = useServices();
  const notify = useToast();
  const [data] = useBookmarks();
  const [customAddresses] = useCustomAddresses();
  const { openUrl } = useBrowser();
  const [folderId, setFolderId] = useState(DEFAULT_FOLDER_ID);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);

  const shown = useMemo(() => (url: string) => shortAddress(visibleAddress(url, customAddresses)), [customAddresses]);
  const folder = data.folders.find((item) => item.id === folderId) ?? data.folders[0]!;
  const needle = query.trim().toLocaleLowerCase('es');
  const items = data.items.filter((item) =>
    needle ? item.title.toLocaleLowerCase('es').includes(needle) || shown(item.url).toLocaleLowerCase('es').includes(needle) : item.folderId === folder.id,
  );
  const set = (next: typeof data) => services.bookmarks.set(next);

  const createFolder = () => {
    const result = addFolder(services.bookmarks.getSnapshot(), newFolder ?? '', { id: services.createId(), now: services.now() });
    if (!result.ok) {
      setFolderError(t.folderErrors[result.error]);
      return;
    }
    set(result.data);
    setFolderId(result.folder.id);
    setNewFolder(null);
    setFolderError(null);
  };

  return (
    <section className="list-page bookmarks-page" aria-labelledby="bookmarks-title">
      <header className="list-page__header">
        <h1 id="bookmarks-title">
          <Icon name="bookmarks" size={22} />
          {t.title}
        </h1>
        <label className="list-page__search">
          <Icon name="search" size={16} />
          <span className="visually-hidden">{t.search}</span>
          <input type="search" className="input" placeholder={t.search} value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </header>

      <div className="bookmarks-page__body">
        <nav className="bookmarks-page__folders" aria-label={m.bookmarks.folder}>
          <ul>
            {data.folders.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`bookmarks-page__folder${item.id === folder.id && !needle ? ' is-active' : ''}`}
                  aria-current={item.id === folder.id && !needle ? 'page' : undefined}
                  onClick={() => {
                    setFolderId(item.id);
                    setQuery('');
                  }}
                >
                  <Icon name="folder" size={16} />
                  <span>{item.name}</span>
                  <span className="bookmarks-page__count">{data.items.filter((bookmark) => bookmark.folderId === item.id).length}</span>
                </button>
              </li>
            ))}
          </ul>
          {newFolder === null ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setNewFolder('')}>
              <Icon name="plus" size={14} />
              {t.newFolder.replace('…', '')}
            </button>
          ) : (
            <div className="bookmarks-page__new-folder">
              <input
                className="input input--sm"
                autoFocus
                aria-label={t.newFolderName}
                placeholder={t.newFolderName}
                value={newFolder}
                maxLength={60}
                aria-invalid={Boolean(folderError)}
                onChange={(event) => {
                  setNewFolder(event.target.value);
                  setFolderError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') createFolder();
                  if (event.key === 'Escape') setNewFolder(null);
                }}
              />
              <button type="button" className="btn btn--primary btn--sm" onClick={createFolder}>
                {t.createFolder}
              </button>
              {folderError && <span className="field-error">{folderError}</span>}
            </div>
          )}
        </nav>

        <div className="bookmarks-page__content">
          {!needle && (
            <div className="bookmarks-page__folder-header">
              {renaming === folder.id ? (
                <input
                  className="input input--sm"
                  autoFocus
                  aria-label={t.renameFolder}
                  defaultValue={folder.name}
                  maxLength={60}
                  onBlur={(event) => {
                    set(renameFolder(services.bookmarks.getSnapshot(), folder.id, event.target.value));
                    setRenaming(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <h2>{folder.name}</h2>
              )}
              <span className="bookmarks-page__count">{t.count(items.length)}</span>
              <button type="button" className="icon-btn icon-btn--sm" aria-label={t.renameFolder} title={t.renameFolder} onClick={() => setRenaming(folder.id)}>
                <Icon name="edit" size={14} />
              </button>
              {folder.id !== DEFAULT_FOLDER_ID && (
                <button
                  type="button"
                  className="icon-btn icon-btn--sm"
                  aria-label={t.deleteFolder}
                  title={t.deleteFolder}
                  onClick={() => {
                    set(removeFolder(services.bookmarks.getSnapshot(), folder.id));
                    setFolderId(DEFAULT_FOLDER_ID);
                    notify('info', t.folderDeleted(folder.name));
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>
          )}
          {items.length === 0 ? (
            <p className="list-page__empty">{needle ? t.noResults : data.items.length === 0 ? t.empty : t.emptyFolder}</p>
          ) : (
            <ul className="history-list bookmarks-list">
              {items.map((item) => (
                <BookmarkRow
                  key={item.id}
                  bookmark={item}
                  address={shown(item.url)}
                  folders={data.folders}
                  onOpen={(newTab) => openUrl(item.url, newTab ? { newTab: true } : undefined)}
                  onRename={(title) => set(updateBookmark(services.bookmarks.getSnapshot(), item.id, { title }, services.now()))}
                  onMove={(target) => set(updateBookmark(services.bookmarks.getSnapshot(), item.id, { folderId: target }, services.now()))}
                  onDelete={() => {
                    set(removeBookmark(services.bookmarks.getSnapshot(), item.id));
                    notify('info', t.removed);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

interface BookmarkRowProps {
  bookmark: Bookmark;
  address: string;
  folders: { id: string; name: string }[];
  onOpen: (newTab: boolean) => void;
  onRename: (title: string) => void;
  onMove: (folderId: string) => void;
  onDelete: () => void;
}

function BookmarkRow({ bookmark, address, folders, onOpen, onRename, onMove, onDelete }: BookmarkRowProps) {
  const m = useMessages();
  const t = m.bookmarks;
  const [editing, setEditing] = useState(false);
  return (
    <li className="history-row bookmark-row" data-testid="bookmark-row">
      <Favicon url={bookmark.url} label={bookmark.title} size={16} />
      {editing ? (
        <input
          className="input input--sm bookmark-row__name"
          autoFocus
          aria-label={t.rename}
          defaultValue={bookmark.title}
          maxLength={300}
          onBlur={(event) => {
            onRename(event.target.value);
            setEditing(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <button type="button" className="history-row__open" onClick={(event) => onOpen(event.ctrlKey || event.metaKey)} title={address} aria-label={t.open(bookmark.title)}>
          <span className="history-row__title">{bookmark.title}</span>
          <span className="history-row__host">{address}</span>
        </button>
      )}
      <select className="select bookmark-row__folder" aria-label={t.move} value={bookmark.folderId} onChange={(event) => onMove(event.target.value)}>
        {folders.map((folder) => (
          <option key={folder.id} value={folder.id}>
            {folder.name}
          </option>
        ))}
      </select>
      <button type="button" className="icon-btn icon-btn--sm" aria-label={t.openInNewTab} title={t.openInNewTab} onClick={() => onOpen(true)}>
        <Icon name="external" size={14} />
      </button>
      <button type="button" className="icon-btn icon-btn--sm" aria-label={`${t.rename}: ${bookmark.title}`} title={t.rename} onClick={() => setEditing(true)}>
        <Icon name="edit" size={14} />
      </button>
      <button type="button" className="icon-btn icon-btn--sm" aria-label={`${t.delete}: ${bookmark.title}`} title={t.delete} onClick={onDelete}>
        <Icon name="trash" size={14} />
      </button>
    </li>
  );
}
