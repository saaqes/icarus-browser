import { describe, expect, it } from 'vitest';
import {
  addBookmark,
  addFolder,
  bookmarksSchema,
  createDefaultBookmarks,
  DEFAULT_FOLDER_ID,
  findBookmark,
  removeBookmark,
  removeFolder,
  renameFolder,
  sanitizeBookmarks,
  searchBookmarks,
  updateBookmark,
} from '../../services/bookmarks/bookmarks';
import { parseBackup, createBackup } from '../../services/backup/backup';
import { loadDocument, saveDocument } from '../../services/persistence/document';
import { createMemoryStorage } from '../../services/persistence/storage';
import { createDefaultSettings } from '../../services/settings/settings';

const NOW = new Date('2026-10-26T10:00:00.000Z');
let counter = 0;
const ctx = () => ({ id: `id-${++counter}`, now: NOW });

describe('favoritos', () => {
  it('guarda la página una sola vez y la encuentra por su URL real', () => {
    const first = addBookmark(createDefaultBookmarks(), { title: 'Panel', url: 'https://bot.deriv.me/#dashboard' }, ctx());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.bookmark).toMatchObject({ title: 'Panel', url: 'https://bot.deriv.me/#dashboard', folderId: DEFAULT_FOLDER_ID });
    // La misma URL (escrita de otra forma) no se duplica.
    const again = addBookmark(first.data, { title: 'Otra vez', url: 'https://BOT.deriv.me/#dashboard' }, ctx());
    expect(again.ok && again.data.items).toHaveLength(1);
    // Otro fragmento es otra página de la aplicación.
    expect(findBookmark(first.data, 'https://bot.deriv.me/#chart')).toBeNull();
    expect(findBookmark(first.data, 'https://bot.deriv.me/#dashboard')?.id).toBe(first.bookmark.id);
  });

  it('solo admite páginas web y respeta el límite', () => {
    expect(addBookmark(createDefaultBookmarks(), { title: 'x', url: 'javascript:alert(1)' }, ctx())).toEqual({ ok: false, error: 'invalid-url' });
    expect(addBookmark(createDefaultBookmarks(), { title: 'x', url: 'icarus://historial' }, ctx())).toEqual({ ok: false, error: 'invalid-url' });
  });

  it('cambia el nombre y la carpeta; un nombre vacío vuelve a ser la dirección', () => {
    const added = addBookmark(createDefaultBookmarks(), { title: 'A', url: 'https://ejemplo.com/' }, ctx());
    if (!added.ok) throw new Error('no añadido');
    const folder = addFolder(added.data, 'Trabajo', ctx());
    if (!folder.ok) throw new Error('sin carpeta');
    let data = updateBookmark(folder.data, added.bookmark.id, { title: '  Mi página ', folderId: folder.folder.id }, NOW);
    expect(data.items[0]).toMatchObject({ title: 'Mi página', folderId: folder.folder.id });
    data = updateBookmark(data, added.bookmark.id, { title: '', folderId: 'no-existe' }, NOW);
    expect(data.items[0]).toMatchObject({ title: 'https://ejemplo.com/', folderId: folder.folder.id });
    // Una carpeta con el mismo nombre se reutiliza.
    expect(addFolder(data, 'trabajo', ctx())).toMatchObject({ ok: true, folder: { id: folder.folder.id } });
    expect(addFolder(data, '   ', ctx())).toEqual({ ok: false, error: 'required' });
    // Borrar la carpeta no borra sus favoritos.
    data = removeFolder(renameFolder(data, folder.folder.id, 'Oficina'), folder.folder.id);
    expect(data.folders.map((item) => item.id)).toEqual([DEFAULT_FOLDER_ID]);
    expect(data.items[0]?.folderId).toBe(DEFAULT_FOLDER_ID);
    expect(removeFolder(data, DEFAULT_FOLDER_ID)).toBe(data);
    expect(removeBookmark(data, added.bookmark.id).items).toEqual([]);
  });

  it('se conservan al cerrar (almacenamiento) y se sanean los datos dañados', () => {
    const storage = createMemoryStorage();
    const added = addBookmark(createDefaultBookmarks(), { title: 'A', url: 'https://ejemplo.com/a' }, ctx());
    if (!added.ok) throw new Error('no añadido');
    saveDocument(storage, bookmarksSchema, added.data);
    expect(loadDocument(storage, bookmarksSchema).value).toEqual(added.data);

    const issues: string[] = [];
    const data = sanitizeBookmarks(
      {
        folders: [{ id: 'f', name: 'Ideas' }, { id: 'f', name: 'Repetida' }, { id: 'x' }],
        items: [
          { id: '1', title: 'Uno', url: 'https://uno.com/', folderId: 'f' },
          { id: '2', title: 'Duplicado', url: 'https://uno.com' },
          { id: '3', title: 'Peligro', url: 'javascript:alert(1)' },
          { id: '4', title: 'Sin carpeta', url: 'https://cuatro.com/', folderId: 'borrada' },
        ],
      },
      issues,
    );
    expect(data.folders.map((item) => item.name)).toEqual(['Favoritos', 'Ideas']);
    expect(data.items.map((item) => [item.id, item.folderId])).toEqual([['1', 'f'], ['4', DEFAULT_FOLDER_ID]]);
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });

  it('busca por nombre o por la dirección visible (la personalizada, no la real)', () => {
    const added = addBookmark(createDefaultBookmarks(), { title: 'Bot', url: 'https://bot.deriv.me/#chart' }, ctx());
    if (!added.ok) throw new Error('no añadido');
    const visible = (url: string) => url.replace('bot.deriv.me', 'miweb.com');
    expect(searchBookmarks(added.data, 'miweb', visible)).toHaveLength(1);
    expect(searchBookmarks(added.data, 'deriv', visible)).toHaveLength(0);
  });

  it('se incluyen en la copia de seguridad; una copia antigua sin favoritos no los borra', () => {
    const added = addBookmark(createDefaultBookmarks(), { title: 'A', url: 'https://ejemplo.com/' }, ctx());
    if (!added.ok) throw new Error('no añadido');
    const base = { settings: createDefaultSettings(), shortcuts: [], customAddresses: [], widgets: { notes: '', tasks: [] } as never };
    const parsed = parseBackup(createBackup({ ...base, bookmarks: added.data }, '0.3.0', NOW));
    expect(parsed.ok && parsed.data.bookmarks?.items).toHaveLength(1);
    const old = parseBackup(createBackup(base, '0.2.0', NOW));
    expect(old.ok && old.data.bookmarks).toBeUndefined();
  });
});
