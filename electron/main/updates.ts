/**
 * Servicio de actualizaciones de la aplicación de escritorio.
 *
 * - Comprueba al arrancar y cada 6 horas (sin descargar nada hasta que el usuario
 *   pulsa «Actualizar ahora»).
 * - Solo acepta manifiestos firmados con la clave de ICARUS y paquetes cuyo SHA-256
 *   coincide; nunca ofrece una versión igual o anterior a la instalada.
 * - Antes de instalar deja un marcador en updates.json. Al arrancar, si la versión
 *   es la nueva se confirma la actualización; si sigue siendo la anterior, se
 *   registra el fallo y esa versión no se vuelve a instalar sola (sin bucles).
 * - Los datos del usuario no se tocan: solo se usa la carpeta `updates/` para las
 *   descargas, que se borra después de actualizar.
 */

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { UpdateChannel, UpdateErrorCode, UpdateInfo, UpdateState } from '../../src/types/native';
import { CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS } from '../update/config';
import { fetchSignedManifest, type CheckError } from '../update/checker';
import { downloadVerified, sha256OfFile, UpdateDownloadError } from '../update/download';
import { evaluateManifest, type UpdateAsset, type UpdateManifest } from '../update/manifest';
import type { FetchLike, UpdateSource } from '../update/source';
import { parseVersion } from '../update/version';
import { JsonFile } from './jsonFile';
import type { InstallPlan } from './updateInstall';
import { isRecord } from './validate';

interface StoredUpdates {
  channel: UpdateChannel;
  lastCheckedAt: string | null;
  postponedVersion: string | null;
  failedVersion: string | null;
  /**
   * Instalación en curso: se resuelve en el siguiente arranque. `manual`: el usuario
   * coloca el paquete él mismo, así que no haberlo hecho aún no es un fallo.
   */
  pending: { from: string; to: string; at: string; manual: boolean } | null;
}

function defaults(): StoredUpdates {
  return { channel: 'stable', lastCheckedAt: null, postponedVersion: null, failedVersion: null, pending: null };
}

const optionalVersion = (value: unknown) => (typeof value === 'string' && parseVersion(value) ? value : null);

export function sanitizeUpdates(raw: unknown): StoredUpdates {
  const root = isRecord(raw) ? raw : {};
  const pending = isRecord(root.pending) ? root.pending : null;
  return {
    channel: root.channel === 'preview' ? 'preview' : 'stable',
    lastCheckedAt: typeof root.lastCheckedAt === 'string' && !Number.isNaN(Date.parse(root.lastCheckedAt)) ? root.lastCheckedAt : null,
    postponedVersion: optionalVersion(root.postponedVersion),
    failedVersion: optionalVersion(root.failedVersion),
    pending:
      pending && optionalVersion(pending.from) && optionalVersion(pending.to) && typeof pending.at === 'string'
        ? { from: pending.from as string, to: pending.to as string, at: pending.at, manual: pending.manual === true }
        : null,
  };
}

/** Lo que cada plataforma hace con un paquete ya verificado. */
export interface UpdateInstaller {
  /** Comprobaciones propias del sistema (firma de código, contenido de la app…). Devuelve lo que se instalará. */
  prepare(file: string, asset: UpdateAsset, manifest: UpdateManifest): Promise<string>;
  /** Lanza la instalación de `version`; `relaunch` vuelve a abrir ICARUS al terminar. */
  launch(prepared: string, relaunch: boolean, version: string): void;
  /** Muestra el paquete al usuario (modos manuales). */
  reveal(file: string): void;
}

export interface UpdateServiceOptions {
  dataDir: string;
  currentVersion: string;
  plan: InstallPlan;
  /** null: compilación sin clave pública (no se ofrecen actualizaciones). */
  publicKey: string | null;
  isPackaged: boolean;
  fetch: FetchLike;
  source: UpdateSource;
  installer: UpdateInstaller;
  emit: (state: UpdateState) => void;
  /** Pide a la interfaz que guarde la sesión; responde con `readyToRestart()`. */
  requestRestart: () => void;
  /** Espera máxima a esa respuesta. */
  restartTimeoutMs?: number;
  quit: () => void;
  headers?: Record<string, string>;
  firstCheckDelayMs?: number;
  /** Límites de tiempo de la comprobación y de la descarga (pruebas). */
  checkTimeoutMs?: number;
  stallTimeoutMs?: number;
  now?: () => Date;
}

const CHECK_ERRORS: Record<CheckError, UpdateErrorCode | null> = {
  network: 'network',
  'rate-limited': 'rate-limited',
  'not-found': 'not-found',
  signature: 'signature',
  'invalid-manifest': 'invalid-manifest',
  'no-key': null,
};

export class UpdateService {
  private readonly file: JsonFile<StoredUpdates>;
  private state: UpdateState;
  private manifest: UpdateManifest | null = null;
  private asset: UpdateAsset | null = null;
  private prepared: string | null = null;
  private busy: Promise<unknown> | null = null;
  private abort: AbortController | null = null;
  private timers: NodeJS.Timeout[] = [];
  private restartWaiter: (() => void) | null = null;
  private readonly now: () => Date;

  constructor(private readonly options: UpdateServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.file = new JsonFile(join(options.dataDir, 'updates.json'), { version: 1, defaults, sanitize: sanitizeUpdates, delayMs: 200 });
    const stored = this.file.get();
    const supported = options.isPackaged && options.publicKey !== null && options.plan.mode !== 'unsupported';
    this.state = {
      currentVersion: options.currentVersion,
      channel: stored.channel,
      mode: supported ? options.plan.mode : 'unsupported',
      unsupportedReason: supported ? null : !options.isPackaged ? 'development' : 'no-key',
      status: 'idle',
      lastCheckedAt: stored.lastCheckedAt,
      available: null,
      progress: null,
      error: null,
      postponedVersion: stored.postponedVersion,
      installOnQuit: false,
      manualFile: null,
      justUpdated: null,
      failedVersion: stored.failedVersion,
      keychainNotice: false,
    };
    this.resolvePending(stored);
  }

  /** Resultado de la instalación anterior, si la hubo. */
  private resolvePending(stored: StoredUpdates): void {
    if (!stored.pending) return;
    const { from, to, manual } = stored.pending;
    if (to !== this.options.currentVersion && manual) return;
    if (to === this.options.currentVersion) {
      this.state.justUpdated = { from, to };
      this.state.failedVersion = null;
      this.state.postponedVersion = null;
      this.removeDownloads();
    } else if (from === this.options.currentVersion) {
      this.state.failedVersion = to;
      this.state.error = { code: 'install-failed', detail: to };
      this.state.status = 'error';
    }
    this.save({ pending: null, failedVersion: this.state.failedVersion, postponedVersion: this.state.postponedVersion }, true);
  }

  private save(patch: Partial<StoredUpdates>, immediately = false): void {
    this.file.set({ ...this.file.get(), ...patch });
    if (immediately) this.file.flush();
  }

  private update(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.options.emit(this.getState());
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  get supported(): boolean {
    return this.state.mode !== 'unsupported';
  }

  /** Programa la primera comprobación y las periódicas. */
  start(): void {
    if (!this.supported) return;
    const first = setTimeout(() => void this.check(false), this.options.firstCheckDelayMs ?? FIRST_CHECK_DELAY_MS);
    const periodic = setInterval(() => void this.check(false), CHECK_INTERVAL_MS);
    first.unref?.();
    periodic.unref?.();
    this.timers.push(first, periodic);
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.abort?.abort();
  }

  setChannel(channel: UpdateChannel): void {
    // No se cambia de canal con una descarga o instalación en marcha.
    if (channel === this.state.channel || this.busy || ['downloading', 'verifying', 'ready', 'installing'].includes(this.state.status)) return;
    this.save({ channel }, true);
    // Al cambiar de canal se olvida lo encontrado en el anterior.
    this.manifest = null;
    this.asset = null;
    this.update({ channel, available: null, status: 'idle', error: null });
    void this.check(true);
  }

  postpone(): void {
    const version = this.state.available?.version ?? null;
    if (!version) return;
    this.save({ postponedVersion: version }, true);
    this.update({ postponedVersion: version });
  }

  acknowledge(): void {
    if (this.state.justUpdated) this.update({ justUpdated: null });
  }

  /** Lo decide main.ts al arrancar (en macOS consulta la firma de la app instalada). */
  setKeychainNotice(value: boolean): void {
    if (this.state.keychainNotice !== value) this.update({ keychainNotice: value });
  }

  reveal(): void {
    if (this.state.status === 'ready' && this.state.manualFile) this.options.installer.reveal(this.state.manualFile);
  }

  /** Comprueba ahora. `manual`: la pide el usuario (muestra los errores de red). */
  async check(manual = true): Promise<UpdateState> {
    if (!this.supported) return this.getState();
    // Durante una descarga o con la actualización lista no se vuelve a comprobar.
    if (this.busy || ['downloading', 'verifying', 'ready', 'installing'].includes(this.state.status)) return this.getState();
    this.update({ status: 'checking', error: manual ? null : this.state.error });
    const task = this.runCheck(manual);
    this.busy = task;
    try {
      await task;
    } finally {
      this.busy = null;
    }
    return this.getState();
  }

  private async runCheck(manual: boolean): Promise<void> {
    const result = await fetchSignedManifest({
      fetch: this.options.fetch,
      source: this.options.source,
      channel: this.state.channel,
      publicKey: this.options.publicKey,
      headers: this.options.headers,
      timeoutMs: this.options.checkTimeoutMs,
    }).catch((error: Error) => ({ ok: false as const, error: 'network' as const, detail: error.message }));
    const checkedAt = this.now().toISOString();
    this.save({ lastCheckedAt: checkedAt });
    if (!result.ok) {
      const code = CHECK_ERRORS[result.error];
      // Una versión que aún no tiene manifiesto publicado equivale a «sin novedades».
      if (result.error === 'not-found' || !code) {
        this.update({ status: 'up-to-date', lastCheckedAt: checkedAt, available: null });
        return;
      }
      // Los fallos de red de las comprobaciones automáticas no se muestran como error.
      if (!manual && (code === 'network' || code === 'rate-limited')) {
        this.update({ status: this.state.available ? 'available' : 'idle', lastCheckedAt: checkedAt });
        return;
      }
      this.update({ status: 'error', lastCheckedAt: checkedAt, error: { code, detail: result.detail ?? null } });
      return;
    }
    const current = parseVersion(this.options.currentVersion);
    if (!current) {
      this.update({ status: 'error', lastCheckedAt: checkedAt, error: { code: 'invalid-manifest', detail: 'current-version' } });
      return;
    }
    const decision = evaluateManifest(result, current, this.state.channel, this.options.plan.target);
    if (decision.status === 'available') {
      this.manifest = result.manifest;
      this.asset = decision.asset;
      this.update({ status: 'available', lastCheckedAt: checkedAt, available: this.info(result.manifest, decision.asset), error: null });
      return;
    }
    this.manifest = null;
    this.asset = null;
    if (decision.status === 'rejected' && decision.reason === 'no-asset') {
      this.update({ status: 'error', lastCheckedAt: checkedAt, available: null, error: { code: 'no-asset', detail: result.manifest.version } });
      return;
    }
    // Igual, anterior o de otro canal: no hay nada que instalar.
    this.update({ status: 'up-to-date', lastCheckedAt: checkedAt, available: null, error: null });
  }

  private info(manifest: UpdateManifest, asset: UpdateAsset | null): UpdateInfo {
    return {
      version: manifest.version,
      releasedAt: manifest.releasedAt,
      notes: manifest.notes,
      file: asset?.file ?? null,
      size: asset?.size ?? null,
      releasePage: this.options.source.releasePage(manifest.tag),
    };
  }

  private get downloadsDir(): string {
    return join(this.options.dataDir, 'updates');
  }

  private removeDownloads(): void {
    try {
      rmSync(this.downloadsDir, { recursive: true, force: true });
    } catch {
      // Se reintentará en la próxima actualización.
    }
  }

  /** Descarga y verifica el paquete; con `install`, instala al terminar. */
  download(install: boolean): void {
    if (this.busy || !this.manifest || this.state.status === 'downloading' || this.state.status === 'verifying') return;
    const manifest = this.manifest;
    const asset = this.asset;
    if (this.state.mode === 'manual-release' || !asset) {
      // Sin paquete para esta plataforma: la interfaz abre la página de la versión.
      return;
    }
    const task = this.runDownload(manifest, asset, install);
    this.busy = task;
    void task.finally(() => {
      this.busy = null;
    });
  }

  private async runDownload(manifest: UpdateManifest, asset: UpdateAsset, install: boolean): Promise<void> {
    const destination = join(this.downloadsDir, manifest.version, asset.file);
    this.abort = new AbortController();
    this.update({ status: 'downloading', progress: { received: 0, total: asset.size }, error: null, installOnQuit: false, manualFile: null });
    let lastEmit = 0;
    try {
      await downloadVerified({
        fetch: this.options.fetch,
        source: this.options.source,
        url: this.options.source.assetUrl(manifest.tag, asset.file),
        destination,
        size: asset.size,
        sha256: asset.sha256,
        signal: this.abort.signal,
        headers: this.options.headers,
        stallTimeoutMs: this.options.stallTimeoutMs,
        onProgress: (received, total) => {
          const time = Date.now();
          if (received !== total && time - lastEmit < 200) return;
          lastEmit = time;
          this.update({ progress: { received, total } });
        },
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError' || this.abort?.signal.aborted) {
        // Cancelada por el usuario: el archivo parcial queda para reanudarla.
        this.update({ status: 'available', progress: null });
        return;
      }
      const code = error instanceof UpdateDownloadError ? this.downloadError(error) : 'network';
      this.update({ status: 'error', progress: null, error: { code, detail: (error as Error).message } });
      return;
    } finally {
      this.abort = null;
    }

    this.update({ status: 'verifying', progress: null });
    try {
      // Se vuelve a comprobar el archivo completo justo antes de usarlo.
      if ((await sha256OfFile(destination)) !== asset.sha256) throw new UpdateDownloadError('hash-mismatch', 'El archivo cambió tras descargarse');
      if (this.state.mode === 'automatic') {
        this.prepared = await this.options.installer.prepare(destination, asset, manifest);
      } else {
        this.prepared = destination;
      }
    } catch (error) {
      rmSync(destination, { force: true });
      const code = error instanceof UpdateDownloadError ? this.downloadError(error) : 'verification-failed';
      this.update({ status: 'error', error: { code, detail: (error as Error).message } });
      return;
    }

    if (this.state.mode !== 'automatic') {
      // Modos manuales: el paquete verificado se muestra al usuario para que lo coloque.
      this.save({ pending: { from: this.options.currentVersion, to: manifest.version, at: this.now().toISOString(), manual: true } }, true);
      this.update({ status: 'ready', manualFile: destination });
      this.options.installer.reveal(destination);
      return;
    }
    this.update({ status: 'ready' });
    if (install) await this.install('now');
  }

  private downloadError(error: UpdateDownloadError): UpdateErrorCode {
    switch (error.code) {
      case 'hash-mismatch':
      case 'size-mismatch':
      case 'interrupted':
      case 'disk-space':
      case 'write':
        return error.code;
      case 'not-found':
        return 'not-found';
      case 'forbidden-host':
        return 'invalid-manifest';
      default:
        return 'network';
    }
  }

  cancel(): void {
    this.abort?.abort();
  }

  /** Instala ahora (y reinicia) o al cerrar ICARUS. */
  async install(when: 'now' | 'on-quit'): Promise<void> {
    if (this.state.status !== 'ready' || this.state.mode !== 'automatic' || !this.prepared || !this.manifest) return;
    if (when === 'on-quit') {
      this.update({ installOnQuit: true });
      return;
    }
    this.update({ status: 'installing' });
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.restartWaiter = null;
        resolve();
      };
      const timer = setTimeout(finish, this.options.restartTimeoutMs ?? 2000);
      this.restartWaiter = finish;
      this.options.requestRestart();
    });
    if (this.launch(true)) this.options.quit();
  }

  /** La interfaz ya guardó la sesión para reabrirla tras actualizar. */
  readyToRestart(): void {
    this.restartWaiter?.();
  }

  /** Llamado al cerrar ICARUS: aplica la actualización si el usuario lo pidió. */
  onQuit(): void {
    if (this.state.installOnQuit && this.state.status === 'ready' && this.prepared) this.launch(false);
    this.stop();
    this.file.flush();
  }

  private launch(relaunch: boolean): boolean {
    if (!this.prepared || !this.manifest) return false;
    // El marcador se escribe en disco antes de lanzar el instalador.
    this.save({ pending: { from: this.options.currentVersion, to: this.manifest.version, at: this.now().toISOString(), manual: false } }, true);
    try {
      this.options.installer.launch(this.prepared, relaunch, this.manifest.version);
      return true;
    } catch (error) {
      this.save({ pending: null }, true);
      this.update({ status: 'error', error: { code: 'install-failed', detail: (error as Error).message } });
      return false;
    }
  }
}
