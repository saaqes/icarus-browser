/**
 * Guardar archivos de texto que genera la interfaz (exportar direcciones o la copia
 * de seguridad). La ruta la elige siempre el usuario en el diálogo del sistema: la
 * interfaz solo propone el nombre y nunca escribe donde quiera.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import type { SaveTextResult } from '../../src/types/native';
import { STRINGS } from './strings';
import { sanitizeFileName } from './urlPolicy';

/** Nombre propuesto en el diálogo: sin caracteres no válidos y siempre `.json`. */
export function exportFileName(name: string): string {
  const base = sanitizeFileName(name.replace(/\.json$/i, ''));
  return `${base}.json`;
}

export async function saveTextFile(window: BrowserWindow | null, name: string, content: string): Promise<SaveTextResult> {
  const options = {
    title: STRINGS.dialogs.export,
    defaultPath: join(app.getPath('documents'), exportFileName(name)),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  };
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return { status: 'cancelled' };
  try {
    await writeFile(result.filePath, content, 'utf8');
    return { status: 'saved', path: result.filePath };
  } catch (error) {
    console.warn('[exportar]', (error as Error).message);
    return { status: 'error' };
  }
}
