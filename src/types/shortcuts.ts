/** Acceso directo de la página de inicio. `url` siempre es http(s) normalizada. */
export interface Shortcut {
  id: string;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShortcutInput {
  title: string;
  url: string;
}
