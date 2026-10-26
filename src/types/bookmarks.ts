/**
 * Favoritos. Se guarda siempre la URL real (la que se carga); la interfaz la
 * muestra con la dirección personalizada que corresponda, igual que la barra.
 */

export interface BookmarkFolder {
  id: string;
  name: string;
  createdAt: string;
}

export interface Bookmark {
  id: string;
  title: string;
  /** URL real http(s). */
  url: string;
  folderId: string;
  createdAt: string;
  updatedAt: string;
}

export interface BookmarksData {
  /** La primera es siempre la carpeta «Favoritos», que no se puede borrar. */
  folders: BookmarkFolder[];
  items: Bookmark[];
}
