/**
 * Archivo JSON con escritura atómica y diferida, para los datos de ICARUS en la
 * carpeta de usuario de la aplicación (en Windows, %APPDATA%\ICARUS Browser).
 *
 * - Se guarda como `{ version, savedAt, data }`.
 * - La escritura va a un archivo temporal que luego se renombra: un corte de
 *   luz no deja el archivo a medias.
 * - Si el archivo está dañado se conserva una copia `.corrupt-<fecha>` y se
 *   usan valores predeterminados.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface JsonFileOptions<T> {
  version: number;
  defaults: () => T;
  /** Devuelve un valor válido a partir de datos desconocidos. */
  sanitize: (raw: unknown) => T;
  delayMs?: number;
}

export class JsonFile<T> {
  private value: T;
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(
    readonly path: string,
    private readonly options: JsonFileOptions<T>,
  ) {
    this.value = this.load();
  }

  private load(): T {
    if (!existsSync(this.path)) return this.options.defaults();
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as { version?: unknown; data?: unknown };
      const data = parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed;
      return this.options.sanitize(data);
    } catch {
      try {
        copyFileSync(this.path, `${this.path}.corrupt-${Date.now()}`);
      } catch {
        // Sin copia posible: se continúa con los valores predeterminados.
      }
      return this.options.defaults();
    }
  }

  get(): T {
    return this.value;
  }

  set(value: T): void {
    this.value = value;
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.options.delayMs ?? 400);
  }

  update(updater: (current: T) => T): T {
    this.set(updater(this.value));
    return this.value;
  }

  /** Escribe de inmediato si hay cambios pendientes (p. ej. al cerrar la aplicación). */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    const content = JSON.stringify({ version: this.options.version, savedAt: new Date().toISOString(), data: this.value });
    writeFileSync(temp, content, 'utf8');
    renameSync(temp, this.path);
  }
}
