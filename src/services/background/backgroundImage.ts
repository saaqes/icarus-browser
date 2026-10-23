/**
 * Imagen de fondo elegida por el usuario. Se guarda aparte de las preferencias
 * (puede ocupar cientos de KB) y se redimensiona antes de guardarla para no
 * agotar la cuota de LocalStorage.
 */

import type { DocumentSchema } from '../persistence/document';
import { STORAGE_KEYS } from '../persistence/keys';
import { isRecord } from '../persistence/validation';

export interface BackgroundImage {
  dataUrl: string;
  name: string;
}

export type StoredBackgroundImage = BackgroundImage | null;

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_DIMENSION = 1920;
const DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i;

export const backgroundImageSchema: DocumentSchema<StoredBackgroundImage> = {
  key: STORAGE_KEYS.backgroundImage,
  version: 1,
  defaults: () => null,
  sanitize: (raw, issues) => {
    if (raw === null || raw === undefined) return null;
    if (isRecord(raw) && typeof raw.dataUrl === 'string' && DATA_URL.test(raw.dataUrl)) {
      return { dataUrl: raw.dataUrl, name: typeof raw.name === 'string' ? raw.name.slice(0, 120) : '' };
    }
    issues.push('backgroundImage');
    return null;
  },
};

export type PrepareImageError = 'type' | 'size' | 'decode';

export class PrepareImageFailure extends Error {
  readonly reason: PrepareImageError;
  constructor(reason: PrepareImageError) {
    super(reason);
    this.reason = reason;
  }
}

/** Valida, redimensiona y comprime una imagen local como JPEG. Solo en navegador. */
export async function prepareBackgroundImage(file: File): Promise<BackgroundImage> {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) throw new PrepareImageFailure('type');
  if (file.size > MAX_SOURCE_BYTES) throw new PrepareImageFailure('size');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new PrepareImageFailure('decode');
  }
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new PrepareImageFailure('decode');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.82), name: file.name };
}
