/** Claves de almacenamiento de ICARUS. Todas comparten el prefijo `icarus.`. */
export const STORAGE_PREFIX = 'icarus.';

export const STORAGE_KEYS = {
  settings: 'icarus.settings',
  shortcuts: 'icarus.shortcuts',
  aliasRules: 'icarus.aliasRules',
  widgets: 'icarus.widgets',
  session: 'icarus.session',
  backgroundImage: 'icarus.backgroundImage',
} as const;
