/**
 * Origen de las actualizaciones. Hoy son las versiones de GitHub del repositorio;
 * para usar un servidor propio basta con cambiar estas constantes (o pasar otra
 * `UpdateSource` al servicio): el manifiesto y su firma son los mismos.
 */

export const UPDATE_REPOSITORY = 'saaqes/icarus-browser';
export const PRODUCT_ID = 'icarus-browser';
export const MANIFEST_FILE = 'icarus-update.json';
export const SIGNATURE_FILE = 'icarus-update.json.sig';

/** Hosts desde los que se acepta descargar (GitHub sirve los archivos desde su CDN). */
export const ALLOWED_DOWNLOAD_HOSTS: readonly string[] = [
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
];
/** Host de la API de GitHub (solo para el canal preliminar). */
export const API_HOST = 'api.github.com';

/** Tamaños máximos: el manifiesto es pequeño y ningún paquete pesa más de 1 GB. */
export const MAX_MANIFEST_BYTES = 256 * 1024;
export const MAX_SIGNATURE_BYTES = 1024;
export const MAX_ASSET_BYTES = 1024 * 1024 * 1024;
export const MAX_NOTES_LENGTH = 20_000;

/** Primera comprobación tras arrancar y frecuencia de las siguientes. */
export const FIRST_CHECK_DELAY_MS = 15_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
