/**
 * Descargas reales gestionadas por Chromium. El estado «completada» solo se
 * muestra cuando el motor emite `done` con estado `completed`.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, parse } from 'node:path';
import { app, dialog, shell, type BrowserWindow, type DownloadItem, type Session } from 'electron';
import type { DesktopPreferences, DownloadItemInfo, DownloadState } from '../../src/types/native';
import { JsonFile } from './jsonFile';
import { STRINGS } from './strings';
import { isDangerousFile, sanitizeFileName } from './urlPolicy';
import { isRecord } from './validate';

const MAX_DOWNLOADS = 200;
const STATES: DownloadState[] = ['progressing', 'paused', 'completed', 'cancelled', 'interrupted'];

function sanitizeDownloads(raw: unknown): DownloadItemInfo[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is DownloadItemInfo => isRecord(item) && typeof item.id === 'string' && typeof item.filename === 'string')
    .map((item) => ({
      ...item,
      // Una descarga que estaba en curso al cerrar la aplicación quedó interrumpida.
      state: (STATES.includes(item.state) && item.state !== 'progressing' && item.state !== 'paused' ? item.state : 'interrupted') as DownloadState,
      savePath: typeof item.savePath === 'string' ? item.savePath : null,
    }))
    .slice(0, MAX_DOWNLOADS);
}

/** Ruta libre: «archivo.pdf», «archivo (1).pdf», «archivo (2).pdf»… */
export function uniquePath(directory: string, fileName: string, exists: (path: string) => boolean = existsSync): string {
  const { name, ext } = parse(fileName);
  let candidate = join(directory, fileName);
  for (let i = 1; exists(candidate) && i < 1000; i += 1) candidate = join(directory, `${name} (${i})${ext}`);
  return candidate;
}

export class DownloadManager {
  private readonly file: JsonFile<DownloadItemInfo[]>;
  private readonly active = new Map<string, DownloadItem>();
  private emitTimer: NodeJS.Timeout | null = null;

  constructor(
    path: string,
    private readonly getPreferences: () => DesktopPreferences,
    private readonly emit: (downloads: DownloadItemInfo[], startedId?: string) => void,
    private readonly getWindow: () => BrowserWindow | null,
  ) {
    this.file = new JsonFile(path, { version: 1, defaults: () => [], sanitize: sanitizeDownloads, delayMs: 1000 });
  }

  attach(webSession: Session): void {
    webSession.on('will-download', (_event, item) => {
      const id = randomUUID();
      const { askWhereToSave, directory } = this.getPreferences().downloads;
      const folder = directory && existsSync(directory) ? directory : app.getPath('downloads');
      const fileName = sanitizeFileName(item.getFilename());
      if (askWhereToSave) {
        item.setSaveDialogOptions({ title: STRINGS.dialogs.saveAs, defaultPath: join(folder, fileName) });
      } else {
        item.setSavePath(uniquePath(folder, fileName));
      }
      this.active.set(id, item);
      this.upsert({
        id,
        filename: fileName,
        url: item.getURL(),
        savePath: item.getSavePath() || null,
        state: 'progressing',
        receivedBytes: 0,
        totalBytes: item.getTotalBytes(),
        startedAt: Date.now(),
        endedAt: null,
        canOpen: false,
        dangerous: isDangerousFile(fileName),
      });
      this.emitNow(id);

      item.on('updated', (_e, state) => {
        this.patch(id, {
          state: state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing',
          receivedBytes: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes(),
          savePath: item.getSavePath() || null,
          filename: item.getSavePath() ? parse(item.getSavePath()).base : fileName,
        });
      });
      item.once('done', (_e, state) => {
        this.active.delete(id);
        const savePath = item.getSavePath() || null;
        const filename = savePath ? parse(savePath).base : fileName;
        const completed = state === 'completed' && savePath !== null && existsSync(savePath);
        this.patch(id, {
          state: completed ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted',
          receivedBytes: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes(),
          savePath,
          filename,
          endedAt: Date.now(),
          dangerous: isDangerousFile(filename),
          canOpen: completed && !isDangerousFile(filename),
        });
        this.emitNow();
      });
    });
  }

  list(): DownloadItemInfo[] {
    return this.file.get().map((item) =>
      item.state === 'completed' && item.savePath && !existsSync(item.savePath) ? { ...item, canOpen: false } : item,
    );
  }

  cancel(id: string): void {
    this.active.get(id)?.cancel();
  }

  async open(id: string): Promise<boolean> {
    const item = this.file.get().find((download) => download.id === id);
    if (!item || item.state !== 'completed' || !item.savePath || item.dangerous || !existsSync(item.savePath)) return false;
    // ICARUS nunca abre directamente archivos que pueden ejecutar código.
    if (isDangerousFile(item.savePath)) return false;
    return (await shell.openPath(item.savePath)) === '';
  }

  showInFolder(id: string): void {
    const item = this.file.get().find((download) => download.id === id);
    if (item?.savePath && existsSync(item.savePath)) shell.showItemInFolder(item.savePath);
  }

  clear(): void {
    this.file.update((items) => items.filter((item) => this.active.has(item.id)));
    this.emitNow();
  }

  async chooseDirectory(): Promise<string | null> {
    const window = this.getWindow();
    const options = { title: STRINGS.dialogs.chooseDownloadFolder, properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }

  flush(): void {
    this.file.flush();
  }

  private upsert(info: DownloadItemInfo): void {
    this.file.update((items) => [info, ...items.filter((item) => item.id !== info.id)].slice(0, MAX_DOWNLOADS));
  }

  private patch(id: string, patch: Partial<DownloadItemInfo>): void {
    this.file.update((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    this.scheduleEmit();
  }

  private scheduleEmit(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit(this.list());
    }, 150);
  }

  private emitNow(startedId?: string): void {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.emit(this.list(), startedId);
  }
}
