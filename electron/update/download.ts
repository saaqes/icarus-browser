/**
 * Descarga de un paquete de actualización con verificación.
 *
 * - Se escribe en `<destino>.part` y solo se renombra al destino final cuando el
 *   tamaño y el SHA-256 coinciden exactamente con los del manifiesto firmado.
 * - Si una descarga anterior se interrumpió, se reanuda con `Range` (el hash se
 *   calcula también sobre lo que ya había); si el servidor no admite rangos, se
 *   empieza de nuevo.
 * - Se comprueba el espacio libre antes de empezar y nunca se escriben más bytes
 *   de los esperados.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { mkdir, statfs } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DOWNLOAD_STALL_TIMEOUT_MS } from './config';
import { fetchAllowed, UpdateHttpError, type FetchLike, type UpdateSource } from './source';

export type DownloadError = 'network' | 'interrupted' | 'hash-mismatch' | 'size-mismatch' | 'disk-space' | 'forbidden-host' | 'not-found' | 'write';

export class UpdateDownloadError extends Error {
  constructor(
    readonly code: DownloadError,
    message: string,
  ) {
    super(message);
  }
}

export interface DownloadOptions {
  fetch: FetchLike;
  source: UpdateSource;
  url: string;
  destination: string;
  size: number;
  sha256: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  onProgress?: (received: number, total: number) => void;
  /** Espacio libre disponible (inyectable en las pruebas). */
  freeSpace?: (directory: string) => Promise<number>;
  /** Tiempo máximo sin recibir datos (por defecto DOWNLOAD_STALL_TIMEOUT_MS). */
  stallTimeoutMs?: number;
}

/** Margen de espacio libre que se deja además del paquete (y de su copia al instalar). */
const SPACE_MARGIN = 64 * 1024 * 1024;

async function defaultFreeSpace(directory: string): Promise<number> {
  const stats = await statfs(directory);
  return Number(stats.bavail) * Number(stats.bsize);
}

function hashFile(path: string, hash: ReturnType<typeof createHash>): Promise<void> {
  return new Promise((resolve, reject) => {
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve())
      .on('error', reject);
  });
}

/**
 * Vigila que lleguen datos: si pasan `ms` sin que se llame a `arm()`, `stalled` se
 * rechaza con «interrumpida» y se cancela la conexión (el archivo parcial se
 * conserva para reanudar).
 */
function stallGuard(ms: number, cancel: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fail: (error: Error) => void = () => undefined;
  const stalled = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  stalled.catch(() => undefined);
  return {
    stalled,
    arm() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Primero se rechaza, para que gane a la cancelación de la petición.
        fail(new UpdateDownloadError('interrupted', `Sin datos durante ${Math.round(ms / 1000)} s`));
        cancel();
      }, ms);
    },
    stop: () => clearTimeout(timer),
  };
}

/** SHA-256 de un archivo ya descargado (para volver a comprobarlo antes de instalar). */
export async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await hashFile(path, hash);
  return hash.digest('hex');
}

export async function downloadVerified(options: DownloadOptions): Promise<string> {
  const { destination, size, sha256 } = options;
  const partial = `${destination}.part`;
  await mkdir(dirname(destination), { recursive: true });

  // Ya descargado y verificado en una sesión anterior.
  if (existsSync(destination)) {
    if (statSync(destination).size === size && (await sha256OfFile(destination)) === sha256) return destination;
    rmSync(destination, { force: true });
  }

  let offset = existsSync(partial) ? statSync(partial).size : 0;
  if (offset === size) {
    // La descarga anterior terminó pero no llegó a verificarse.
    if ((await sha256OfFile(partial)) === sha256) {
      renameSync(partial, destination);
      return destination;
    }
    offset = size + 1;
  }
  if (offset > size) {
    rmSync(partial, { force: true });
    offset = 0;
  }

  const free = await (options.freeSpace ?? defaultFreeSpace)(dirname(destination));
  if (free < size - offset + SPACE_MARGIN) {
    throw new UpdateDownloadError('disk-space', `Hacen falta ${size - offset + SPACE_MARGIN} bytes libres y hay ${free}`);
  }

  const hash = createHash('sha256');
  const headers: Record<string, string> = { ...options.headers };
  if (offset > 0) headers.Range = `bytes=${offset}-`;

  const controller = new AbortController();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  const guard = stallGuard(options.stallTimeoutMs ?? DOWNLOAD_STALL_TIMEOUT_MS, () => controller.abort());
  try {
    return await receive(options, offset, partial, headers, hash, controller.signal, guard);
  } finally {
    guard.stop();
  }
}

async function receive(
  options: DownloadOptions,
  start: number,
  partial: string,
  headers: Record<string, string>,
  hash: ReturnType<typeof createHash>,
  signal: AbortSignal,
  guard: ReturnType<typeof stallGuard>,
): Promise<string> {
  const { destination, size, sha256 } = options;
  let offset = start;
  let response: Response;
  guard.arm();
  try {
    response = await Promise.race([fetchAllowed(options.fetch, options.source, options.url, { headers, signal }), guard.stalled]);
  } catch (error) {
    if (error instanceof UpdateDownloadError) throw error;
    if (error instanceof UpdateHttpError) {
      throw new UpdateDownloadError(error.code === 'forbidden-host' ? 'forbidden-host' : error.code === 'not-found' ? 'not-found' : 'network', error.message);
    }
    if ((error as Error).name === 'AbortError') throw error;
    throw new UpdateDownloadError('network', (error as Error).message);
  }

  if (response.status === 206 && offset > 0) {
    guard.stop();
    await hashFile(partial, hash);
    guard.arm();
  } else if (response.status === 200) {
    offset = 0;
  } else {
    await response.body?.cancel().catch(() => undefined);
    throw new UpdateDownloadError('network', `HTTP ${response.status}`);
  }

  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > 0 && offset + declared !== size) {
    await response.body?.cancel().catch(() => undefined);
    throw new UpdateDownloadError('size-mismatch', `El servidor anuncia ${offset + declared} bytes y el manifiesto ${size}`);
  }
  const out = createWriteStream(partial, { flags: offset > 0 ? 'a' : 'w' });
  const writeError = new Promise<never>((_resolve, reject) => out.on('error', (error) => reject(new UpdateDownloadError('write', error.message))));
  let received = offset;
  options.onProgress?.(received, size);
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new UpdateDownloadError('interrupted', 'Respuesta sin contenido');
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), writeError, guard.stalled]);
      if (done) break;
      guard.arm();
      received += value.byteLength;
      if (received > size) {
        await reader.cancel().catch(() => undefined);
        throw new UpdateDownloadError('size-mismatch', 'El archivo es mayor de lo que indica el manifiesto');
      }
      hash.update(value);
      if (!out.write(value)) await Promise.race([new Promise<void>((resolve) => out.once('drain', () => resolve())), writeError]);
      options.onProgress?.(received, size);
    }
  } catch (error) {
    out.destroy();
    if (error instanceof UpdateDownloadError) throw error;
    if ((error as Error).name === 'AbortError') throw error;
    // El archivo parcial se conserva para reanudar la próxima vez.
    throw new UpdateDownloadError('interrupted', (error as Error).message);
  }
  await Promise.race([new Promise<void>((resolve) => out.end(resolve)), writeError]);
  if (received !== size) throw new UpdateDownloadError('interrupted', `Se recibieron ${received} de ${size} bytes`);

  const digest = hash.digest('hex');
  if (digest !== sha256) {
    // Un archivo que no coincide no se reutiliza nunca.
    rmSync(partial, { force: true });
    throw new UpdateDownloadError('hash-mismatch', `SHA-256 ${digest} en lugar de ${sha256}`);
  }
  renameSync(partial, destination);
  return destination;
}
