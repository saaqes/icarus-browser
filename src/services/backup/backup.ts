/**
 * Copia de seguridad completa (preferencias, accesos directos, reglas de alias y
 * datos de widgets) en un archivo JSON. La imagen de fondo subida no se incluye
 * por tamaño. Nunca se guardan contraseñas ni secretos.
 */

import type { AliasRule } from '../../types/alias';
import type { Settings } from '../../types/settings';
import type { Shortcut } from '../../types/shortcuts';
import type { WidgetData } from '../../types/widgets';
import { aliasRulesSchema } from '../alias-rules/rules';
import { isRecord } from '../persistence/validation';
import { settingsSchema } from '../settings/settings';
import { shortcutsSchema } from '../shortcuts/shortcuts';
import { widgetDataSchema } from '../widgets/widgets';

export const BACKUP_FORMAT = 'icarus-backup';
export const BACKUP_VERSION = 1;

export interface BackupData {
  settings: Settings;
  shortcuts: Shortcut[];
  aliasRules: AliasRule[];
  widgets: WidgetData;
}

export function createBackup(data: BackupData, appVersion: string, now: Date = new Date()): string {
  return JSON.stringify(
    { format: BACKUP_FORMAT, version: BACKUP_VERSION, appVersion, exportedAt: now.toISOString(), data },
    null,
    2,
  );
}

export type BackupParseResult =
  | { ok: true; data: BackupData; issues: string[] }
  | { ok: false; error: 'invalid-json' | 'invalid-format' | 'newer-version' };

export function parseBackup(text: string): BackupParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid-json' };
  }
  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT || !isRecord(parsed.data)) {
    return { ok: false, error: 'invalid-format' };
  }
  if (typeof parsed.version !== 'number' || parsed.version > BACKUP_VERSION) return { ok: false, error: 'newer-version' };
  const issues: string[] = [];
  const source = parsed.data;
  return {
    ok: true,
    issues,
    data: {
      settings: settingsSchema.sanitize(source.settings, issues),
      shortcuts: shortcutsSchema.sanitize(source.shortcuts, issues),
      aliasRules: aliasRulesSchema.sanitize(source.aliasRules, issues),
      widgets: widgetDataSchema.sanitize(source.widgets, issues),
    },
  };
}

/** Descarga un texto como archivo en el navegador. */
export function downloadTextFile(fileName: string, content: string, mime = 'application/json'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
