/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** «confirm» hace que, por defecto, las páginas web se abran con un enlace en lugar de automáticamente. */
  readonly VITE_ICARUS_EXTERNAL_OPENING?: string;
}

/** Versión de la aplicación inyectada por Vite desde package.json. */
declare const __APP_VERSION__: string;
