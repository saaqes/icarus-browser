/** Foto del perfil: se recorta al centro y se reduce antes de guardarla. Solo en navegador. */

import { isValidProfilePhoto } from './settings';

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
export const PROFILE_PHOTO_SIZE = 128;

/** Devuelve la foto como JPEG cuadrado de 128×128 o null si el archivo no es una imagen válida. */
export async function prepareProfilePhoto(file: File): Promise<string | null> {
  if (!ACCEPTED_TYPES.includes(file.type) || file.size > MAX_SOURCE_BYTES) return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = PROFILE_PHOTO_SIZE;
  canvas.height = PROFILE_PHOTO_SIZE;
  const context = canvas.getContext('2d');
  if (!context || side === 0) {
    bitmap.close();
    return null;
  }
  // JPEG no tiene transparencia: las zonas transparentes quedan en blanco.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, PROFILE_PHOTO_SIZE, PROFILE_PHOTO_SIZE);
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, PROFILE_PHOTO_SIZE, PROFILE_PHOTO_SIZE);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
  return isValidProfilePhoto(dataUrl) ? dataUrl : null;
}
