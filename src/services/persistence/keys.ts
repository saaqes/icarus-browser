/** Claves de almacenamiento de ICARUS. Todas comparten el prefijo `icarus.`. */
export const STORAGE_PREFIX = 'icarus.';

export const STORAGE_KEYS = {
  settings: 'icarus.settings',
  shortcuts: 'icarus.shortcuts',
  // Nombre histórico (antes guardaba las reglas de alias): se conserva para leer los datos existentes.
  customAddresses: 'icarus.aliasRules',
  widgets: 'icarus.widgets',
  session: 'icarus.session',
  backgroundImage: 'icarus.backgroundImage',
} as const;
