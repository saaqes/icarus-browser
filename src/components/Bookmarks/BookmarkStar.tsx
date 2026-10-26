/**
 * Estrella de la barra de direcciones (Chrome y Edge): guarda la página actual en
 * Favoritos y abre el editor (nombre, carpeta, quitar). Se rellena si la página ya
 * es un favorito. Ctrl+D hace lo mismo.
 *
 * Se guarda la URL real; el editor muestra la dirección visible (la personalizada si
 * hay una activa), nunca la original.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useServices } from '../../app/ServicesContext';
import { useDismiss } from '../../hooks/useDismiss';
import { useBookmarks, useCustomAddresses } from '../../hooks/useStores';
import { useMessages } from '../../i18n';
import { addBookmark, addFolder, findBookmark, removeBookmark, updateBookmark } from '../../services/bookmarks/bookmarks';
import { shortAddress } from '../../services/custom-addresses/display';
import type { Bookmark } from '../../types/bookmarks';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { Icon } from '../common/Icon';
import { useOverlayLayer } from '../common/overlayLayer';
import { useToast } from '../common/Toast';
import { visibleAddress } from '../AddressBar/suggestions';

const NEW_FOLDER = '__nueva__';

interface BookmarkStarProps {
  /** URL real de la página. */
  url: string;
  title: string;
}

export function BookmarkStar({ url, title }: BookmarkStarProps) {
  const m = useMessages();
  const services = useServices();
  const notify = useToast();
  const [data] = useBookmarks();
  const { bookmarkRequest } = useBrowser();
  const existing = findBookmark(data, url);
  const [editing, setEditing] = useState<{ id: string; isNew: boolean } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const open = () => {
    if (existing) {
      setEditing({ id: existing.id, isNew: false });
      return;
    }
    const result = addBookmark(services.bookmarks.getSnapshot(), { title, url }, { id: services.createId(), now: services.now() });
    if (!result.ok) {
      notify('error', result.error === 'limit' ? m.bookmarks.limit : m.bookmarks.invalid);
      return;
    }
    services.bookmarks.set(result.data);
    setEditing({ id: result.bookmark.id, isNew: true });
  };

  // Ctrl+D: el contexto cambia `bookmarkRequest`; la primera vez solo se toma la referencia.
  const lastRequest = useRef(bookmarkRequest);
  useEffect(() => {
    if (bookmarkRequest === lastRequest.current) return;
    lastRequest.current = bookmarkRequest;
    if (!editing) open();
  }, [bookmarkRequest]);

  const bookmark = editing ? data.items.find((item) => item.id === editing.id) : undefined;
  const label = existing ? m.bookmarks.edit : m.bookmarks.add;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`icon-btn icon-btn--sm omnibox__action omnibox__star${existing ? ' is-active' : ''}`}
        aria-label={label}
        title={`${label} (Ctrl+D)`}
        aria-pressed={Boolean(existing)}
        aria-expanded={Boolean(editing)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => (editing ? setEditing(null) : open())}
        data-testid="bookmark-star"
      >
        <Icon name={existing ? 'starFilled' : 'star'} size={16} />
      </button>
      {editing && bookmark && <BookmarkEditor bookmark={bookmark} isNew={editing.isNew} anchorRef={buttonRef} onClose={() => setEditing(null)} />}
    </>
  );
}

interface BookmarkEditorProps {
  bookmark: Bookmark;
  isNew: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

/** Ventana del favorito: nombre, carpeta (o una nueva), Quitar y Hecho. */
export function BookmarkEditor({ bookmark, isNew, anchorRef, onClose }: BookmarkEditorProps) {
  const m = useMessages();
  const t = m.bookmarks;
  const services = useServices();
  const notify = useToast();
  const [data] = useBookmarks();
  const [customAddresses] = useCustomAddresses();
  const [name, setName] = useState(bookmark.title);
  const [folderId, setFolderId] = useState(bookmark.folderId);
  const [folderName, setFolderName] = useState('');
  const [folderError, setFolderError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useDismiss(ref, true, onClose, anchorRef);
  useOverlayLayer(true);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  const save = () => {
    let target = folderId;
    let current = services.bookmarks.getSnapshot();
    if (folderId === NEW_FOLDER) {
      const created = addFolder(current, folderName, { id: services.createId(), now: services.now() });
      if (!created.ok) {
        setFolderError(t.folderErrors[created.error]);
        return;
      }
      current = created.data;
      target = created.folder.id;
    }
    services.bookmarks.set(updateBookmark(current, bookmark.id, { title: name, folderId: target }, services.now()));
    onClose();
  };

  const remove = () => {
    services.bookmarks.set(removeBookmark(services.bookmarks.getSnapshot(), bookmark.id));
    notify('info', t.removed);
    onClose();
  };

  return (
    <div
      ref={ref}
      className="omnibox-popover bookmark-editor"
      role="dialog"
      aria-label={isNew ? t.added : t.editing}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <p className="omnibox-popover__title">{isNew ? t.added : t.editing}</p>
      <p className="bookmark-editor__url">{shortAddress(visibleAddress(bookmark.url, customAddresses))}</p>
      <label className="bookmark-editor__field">
        <span>{t.name}</span>
        <input
          ref={nameRef}
          className="input"
          value={name}
          maxLength={300}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              save();
            }
          }}
        />
      </label>
      <label className="bookmark-editor__field">
        <span>{t.folder}</span>
        <select className="select" value={folderId} onChange={(event) => setFolderId(event.target.value)}>
          {data.folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
          <option value={NEW_FOLDER}>{t.newFolder}</option>
        </select>
      </label>
      {folderId === NEW_FOLDER && (
        <label className="bookmark-editor__field">
          <span>{t.newFolderName}</span>
          <input
            className="input"
            value={folderName}
            maxLength={60}
            aria-invalid={Boolean(folderError)}
            onChange={(event) => {
              setFolderName(event.target.value);
              setFolderError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                save();
              }
            }}
          />
          {folderError && <span className="field-error">{folderError}</span>}
        </label>
      )}
      <div className="bookmark-editor__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={remove}>
          {t.remove}
        </button>
        <button type="button" className="btn btn--primary btn--sm" onClick={save}>
          {t.done}
        </button>
      </div>
    </div>
  );
}
