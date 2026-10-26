/**
 * Operaciones puras sobre los favoritos: añadir sin duplicados, editar el nombre
 * y la carpeta, borrar, y carpetas propias. La carpeta «Favoritos» siempre existe.
 */

import type { Bookmark, BookmarkFolder, BookmarksData } from '../../types/bookmarks';
import type { DocumentSchema } from '../persistence/document';
import { STORAGE_KEYS } from '../persistence/keys';
import { isRecord, readIsoDate } from '../persistence/validation';
import { parseWebUrl } from '../url-resolution/urlUtils';

export const DEFAULT_FOLDER_ID = 'favoritos';
export const DEFAULT_FOLDER_NAME = 'Favoritos';
export const MAX_BOOKMARKS = 5000;
export const MAX_FOLDERS = 100;
export const BOOKMARK_TITLE_MAX = 300;
export const FOLDER_NAME_MAX = 60;

const EPOCH = '2026-01-01T00:00:00.000Z';

export function createDefaultBookmarks(): BookmarksData {
  return { folders: [{ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME, createdAt: EPOCH }], items: [] };
}

/** Forma con la que se comparan las URL: la de `new URL` (http/https). El fragmento cuenta: `#chart` y `#inicio` son páginas distintas en una SPA. */
export function bookmarkKey(url: string): string | null {
  const parsed = parseWebUrl(url);
  return parsed && !parsed.username && !parsed.password ? parsed.href : null;
}

export function findBookmark(data: BookmarksData, url: string): Bookmark | null {
  const key = bookmarkKey(url);
  return key ? (data.items.find((item) => item.url === key) ?? null) : null;
}

function cleanTitle(title: string, url: string): string {
  return (title.trim() || url).slice(0, BOOKMARK_TITLE_MAX);
}

function folderExists(data: BookmarksData, id: string): boolean {
  return data.folders.some((folder) => folder.id === id);
}

export type BookmarkResult = { ok: true; data: BookmarksData; bookmark: Bookmark } | { ok: false; error: 'invalid-url' | 'limit' };

/** Añade la página; si ya estaba guardada devuelve la existente (no se duplica). */
export function addBookmark(
  data: BookmarksData,
  input: { title: string; url: string; folderId?: string },
  context: { id: string; now: Date },
): BookmarkResult {
  const url = bookmarkKey(input.url);
  if (!url) return { ok: false, error: 'invalid-url' };
  const existing = data.items.find((item) => item.url === url);
  if (existing) return { ok: true, data, bookmark: existing };
  if (data.items.length >= MAX_BOOKMARKS) return { ok: false, error: 'limit' };
  const timestamp = context.now.toISOString();
  const folderId = input.folderId && folderExists(data, input.folderId) ? input.folderId : DEFAULT_FOLDER_ID;
  const bookmark: Bookmark = { id: context.id, title: cleanTitle(input.title, url), url, folderId, createdAt: timestamp, updatedAt: timestamp };
  return { ok: true, data: { ...data, items: [...data.items, bookmark] }, bookmark };
}

/** Cambia el nombre o la carpeta. Un nombre vacío vuelve a ser la dirección. */
export function updateBookmark(data: BookmarksData, id: string, patch: { title?: string; folderId?: string }, now: Date): BookmarksData {
  return {
    ...data,
    items: data.items.map((item) => {
      if (item.id !== id) return item;
      const folderId = patch.folderId !== undefined && folderExists(data, patch.folderId) ? patch.folderId : item.folderId;
      const title = patch.title !== undefined ? cleanTitle(patch.title, item.url) : item.title;
      return { ...item, title, folderId, updatedAt: now.toISOString() };
    }),
  };
}

export function removeBookmark(data: BookmarksData, id: string): BookmarksData {
  return { ...data, items: data.items.filter((item) => item.id !== id) };
}

export type FolderResult = { ok: true; data: BookmarksData; folder: BookmarkFolder } | { ok: false; error: 'required' | 'too-long' | 'limit' };

/** Crea una carpeta; si ya hay una con ese nombre (sin distinguir mayúsculas) se reutiliza. */
export function addFolder(data: BookmarksData, name: string, context: { id: string; now: Date }): FolderResult {
  const clean = name.trim();
  if (!clean) return { ok: false, error: 'required' };
  if (clean.length > FOLDER_NAME_MAX) return { ok: false, error: 'too-long' };
  const existing = data.folders.find((folder) => folder.name.toLocaleLowerCase('es') === clean.toLocaleLowerCase('es'));
  if (existing) return { ok: true, data, folder: existing };
  if (data.folders.length >= MAX_FOLDERS) return { ok: false, error: 'limit' };
  const folder: BookmarkFolder = { id: context.id, name: clean, createdAt: context.now.toISOString() };
  return { ok: true, data: { ...data, folders: [...data.folders, folder] }, folder };
}

export function renameFolder(data: BookmarksData, id: string, name: string): BookmarksData {
  const clean = name.trim().slice(0, FOLDER_NAME_MAX);
  if (!clean) return data;
  return { ...data, folders: data.folders.map((folder) => (folder.id === id ? { ...folder, name: clean } : folder)) };
}

/** Borra una carpeta propia; sus favoritos pasan a «Favoritos» (no se pierden). */
export function removeFolder(data: BookmarksData, id: string): BookmarksData {
  if (id === DEFAULT_FOLDER_ID) return data;
  return {
    folders: data.folders.filter((folder) => folder.id !== id),
    items: data.items.map((item) => (item.folderId === id ? { ...item, folderId: DEFAULT_FOLDER_ID } : item)),
  };
}

/* ------------------------------ Carga y saneado ------------------------------ */

export function sanitizeBookmarks(raw: unknown, issues: string[]): BookmarksData {
  const result = createDefaultBookmarks();
  if (!isRecord(raw)) {
    if (raw !== undefined) issues.push('bookmarks');
    return result;
  }
  const folderIds = new Set([DEFAULT_FOLDER_ID]);
  const folders = Array.isArray(raw.folders) ? raw.folders : [];
  for (const [index, folder] of folders.entries()) {
    if (!isRecord(folder) || typeof folder.id !== 'string' || typeof folder.name !== 'string' || !folder.name.trim()) {
      issues.push(`bookmarks.folders[${index}]`);
      continue;
    }
    if (folder.id === DEFAULT_FOLDER_ID) {
      result.folders[0] = { ...result.folders[0]!, name: folder.name.trim().slice(0, FOLDER_NAME_MAX) };
      continue;
    }
    if (folderIds.has(folder.id) || result.folders.length >= MAX_FOLDERS) continue;
    folderIds.add(folder.id);
    result.folders.push({ id: folder.id, name: folder.name.trim().slice(0, FOLDER_NAME_MAX), createdAt: readIsoDate(folder.createdAt, EPOCH, `bookmarks.folders[${index}].createdAt`, issues) });
  }
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const items = Array.isArray(raw.items) ? raw.items : [];
  for (const [index, item] of items.slice(0, MAX_BOOKMARKS).entries()) {
    const url = isRecord(item) && typeof item.url === 'string' ? bookmarkKey(item.url) : null;
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id || !url || seenIds.has(item.id) || seenUrls.has(url)) {
      issues.push(`bookmarks.items[${index}]`);
      continue;
    }
    seenIds.add(item.id);
    seenUrls.add(url);
    const path = `bookmarks.items[${index}]`;
    result.items.push({
      id: item.id,
      url,
      title: cleanTitle(typeof item.title === 'string' ? item.title : '', url),
      folderId: typeof item.folderId === 'string' && folderIds.has(item.folderId) ? item.folderId : DEFAULT_FOLDER_ID,
      createdAt: readIsoDate(item.createdAt, EPOCH, `${path}.createdAt`, issues),
      updatedAt: readIsoDate(item.updatedAt, EPOCH, `${path}.updatedAt`, issues),
    });
  }
  return result;
}

export const bookmarksSchema: DocumentSchema<BookmarksData> = {
  key: STORAGE_KEYS.bookmarks,
  version: 1,
  defaults: createDefaultBookmarks,
  sanitize: sanitizeBookmarks,
};

/** Favoritos cuyo título o dirección contienen lo escrito (para las sugerencias de la barra). */
export function searchBookmarks(data: BookmarksData, query: string, visible: (url: string) => string, limit = 4): Bookmark[] {
  const needle = query.trim().toLocaleLowerCase('es');
  if (!needle) return [];
  return data.items
    .filter((item) => item.title.toLocaleLowerCase('es').includes(needle) || visible(item.url).toLocaleLowerCase('es').includes(needle))
    .slice(0, limit);
}
