/**
 * Instalación de actualizaciones en el escritorio.
 *
 * Windows (instalado con el instalador NSIS): un pequeño proceso auxiliar copia la
 * instalación actual, ejecuta el nuevo instalador con `/S --updated` (igual que
 * electron-updater; espera a que ICARUS se cierre, instala en la misma carpeta y
 * conserva los datos de %APPDATA%\ICARUS Browser) y comprueba que quedó instalada la
 * versión nueva. Si el instalador termina sin instalarla (o deja la instalación a
 * medias), restaura la copia: el usuario nunca se queda sin navegador. Después abre
 * ICARUS (no se usa `--force-run`, que depende del Explorador).
 *
 * macOS: la app lleva firma ad hoc, así que Squirrel.Mac (el mecanismo de
 * electron-updater) no puede validar la versión nueva. ICARUS descarga el .zip
 * firmado en el manifiesto, lo extrae, comprueba identificador, versión y firma de
 * código, y un pequeño script sustituye la app cuando ICARUS se cierra (con vuelta
 * atrás si algo falla). Si la app no está en una carpeta escribible (o macOS la
 * ejecuta desde una ubicación aleatoria), se descarga el .dmg verificado y el
 * usuario la coloca él mismo.
 *
 * Linux, AppImage: el AppImage nuevo verificado se copia junto al actual y, al
 * cerrarse ICARUS, sustituye al anterior con un `rename` (atómico: nunca queda un
 * archivo a medias). Se guarda el anterior como `…AppImage.icarus-anterior`; si la
 * versión nueva no confirma que arrancó en 90 s, se restaura y se vuelve a abrir la
 * anterior. Otras instalaciones de Linux (carpeta suelta, paquetes del sistema) solo
 * reciben el aviso.
 */

import { execFile, spawn } from 'node:child_process';
import { accessSync, chmodSync, closeSync, constants, copyFileSync, existsSync, mkdirSync, openSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, posix, win32 } from 'node:path';
import { promisify } from 'node:util';
import type { UpdateInstallMode } from '../../src/types/native';
import type { AssetArch, UpdateTarget } from '../update/manifest';

const run = promisify(execFile);

export const BUNDLE_ID = 'io.github.saaqes.icarusbrowser';
export const UNINSTALLER = 'Uninstall ICARUS Browser.exe';

export interface InstallPlan {
  mode: UpdateInstallMode;
  target: UpdateTarget;
  /** macOS: carpeta .app que se sustituye. */
  bundlePath?: string;
  /** Linux: AppImage que se sustituye. */
  appImagePath?: string;
}

export interface PlanEnvironment {
  platform: NodeJS.Platform;
  arch: string;
  execPath: string;
  /** macOS: app x64 ejecutándose con Rosetta en un Mac con Apple Silicon. */
  runningUnderArm64Translation?: boolean;
  /** Linux: ruta del AppImage en ejecución (variable APPIMAGE que pone su entorno). */
  appImage?: string;
  isWritable?: (path: string) => boolean;
  exists?: (path: string) => boolean;
}

function writable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Arquitectura del paquete que corresponde a este equipo. */
function archOf(env: PlanEnvironment): AssetArch {
  if (env.runningUnderArm64Translation) return 'arm64';
  return env.arch === 'arm64' ? 'arm64' : 'x64';
}

export function planInstall(env: PlanEnvironment): InstallPlan {
  const isWritable = env.isWritable ?? writable;
  const exists = env.exists ?? existsSync;
  const arch = archOf(env);
  if (env.platform === 'win32') {
    // Las rutas se tratan con las reglas de la plataforma evaluada (las pruebas la simulan en otra).
    const installed = exists(win32.join(win32.dirname(env.execPath), UNINSTALLER));
    return installed
      ? { mode: 'automatic', target: { platform: 'windows', arch, kinds: ['nsis'] } }
      : { mode: 'manual-portable', target: { platform: 'windows', arch, kinds: ['zip'] } };
  }
  if (env.platform === 'darwin') {
    const bundlePath = posix.resolve(env.execPath, '..', '..', '..');
    const replaceable =
      bundlePath.endsWith('.app') &&
      !bundlePath.includes('/AppTranslocation/') &&
      !bundlePath.startsWith('/Volumes/') &&
      isWritable(posix.dirname(bundlePath)) &&
      isWritable(bundlePath);
    return replaceable
      ? { mode: 'automatic', target: { platform: 'macos', arch, kinds: ['zip'] }, bundlePath }
      : { mode: 'manual-dmg', target: { platform: 'macos', arch, kinds: ['dmg'] } };
  }
  if (env.platform === 'linux' && env.appImage) {
    const path = posix.resolve(env.appImage);
    if (path.endsWith('.AppImage') && exists(path) && isWritable(path) && isWritable(posix.dirname(path))) {
      return { mode: 'automatic', target: { platform: 'linux', arch, kinds: ['appimage'] }, appImagePath: path };
    }
  }
  return { mode: 'manual-release', target: { platform: 'linux', arch, kinds: [] } };
}

/* --------------------------------- Windows --------------------------------- */

interface AuthenticodeInfo {
  status: string;
  subject: string | null;
}

async function authenticode(path: string): Promise<AuthenticodeInfo> {
  const script =
    "$s = Get-AuthenticodeSignature -LiteralPath $env:ICARUS_FILE; " +
    "[pscustomobject]@{ status = [string]$s.Status; subject = if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { $null } } | ConvertTo-Json -Compress";
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    env: { ...process.env, ICARUS_FILE: path },
    windowsHide: true,
    timeout: 30_000,
  });
  const parsed = JSON.parse(stdout) as { status?: unknown; subject?: unknown };
  return { status: String(parsed.status ?? ''), subject: typeof parsed.subject === 'string' ? parsed.subject : null };
}

/**
 * Si el ICARUS instalado está firmado con Authenticode, el instalador nuevo debe
 * estar firmado por el mismo titular. Sin firma (como hoy), basta la firma del
 * manifiesto y el SHA-256.
 */
export async function verifyWindowsInstaller(installer: string, execPath: string): Promise<void> {
  const current = await authenticode(execPath).catch(() => null);
  if (!current || current.status !== 'Valid') return;
  const next = await authenticode(installer);
  if (next.status !== 'Valid' || next.subject !== current.subject) {
    throw new Error(`Firma Authenticode del instalador: ${next.status} (${next.subject ?? 'sin firmante'})`);
  }
}

/**
 * Proceso auxiliar de Windows. Las rutas llegan por variables de entorno (sin
 * problemas de comillas) y cada paso queda en reinicio.log, junto al script.
 *
 * 1. Copia la carpeta de la instalación actual (robocopy) a la de actualizaciones.
 * 2. Ejecuta el instalador nuevo en silencio (espera él solo a que ICARUS se cierre).
 * 3. Espera a que el app.asar instalado sea el de la versión nueva (su
 *    build-info.json) y exista el desinstalador que se escribe al final, sin procesos
 *    del instalador (se vuelve a lanzar a sí mismo), más un margen.
 * 4. Si el instalador termina sin dejar la versión nueva (unos 15 s sin ningún
 *    proceso suyo) o pasan unos 10 minutos, restaura la copia con robocopy /MIR.
 * 5. Abre ICARUS si se pidió reiniciar (si la instalación falló, ICARUS lo detecta al
 *    arrancar, lo explica y no la reintenta sola).
 */
const WINDOWS_UPDATE = `@echo off
rem Generado por ICARUS Browser para instalar una actualización y volver a abrirlo.
set "log=%~dp0reinicio.log"
echo inicio %date% %time% version %ICARUS_UPDATE_VERSION% >> "%log%"
set "copia=%ICARUS_UPDATE_BACKUP%"
if exist "%copia%" rmdir /s /q "%copia%"
robocopy "%ICARUS_UPDATE_APPDIR%" "%copia%" /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo sin copia de seguridad %date% %time% >> "%log%"
  set "copia="
) else (
  echo copia de seguridad %date% %time% >> "%log%"
)
start "" "%ICARUS_UPDATE_INSTALLER%" /S --updated
echo instalador lanzado %date% %time% >> "%log%"
set /a n=0
set /a parado=0
:esperar
set /a n+=1
if %n% gtr 600 goto fallo
ping -n 2 127.0.0.1 >nul
tasklist /FI "IMAGENAME eq %ICARUS_UPDATE_INSTALLER_NAME%" /NH 2>nul | find /I "%ICARUS_UPDATE_INSTALLER_NAME%" >nul && (set /a parado=0 & goto esperar)
findstr /M /L /C:"\\"version\\": \\"%ICARUS_UPDATE_VERSION%\\"" "%ICARUS_UPDATE_ASAR%" >nul 2>nul || goto sin_instalar
if not exist "%ICARUS_UPDATE_UNINSTALLER%" goto sin_instalar
echo version instalada %date% %time% >> "%log%"
rem Margen para que el instalador termine de cerrar sus archivos.
ping -n 4 127.0.0.1 >nul
goto abrir
:sin_instalar
set /a parado+=1
if %parado% lss 15 goto esperar
:fallo
echo la actualizacion no se instalo %date% %time% >> "%log%"
if not defined copia goto abrir
taskkill /F /IM "%ICARUS_UPDATE_INSTALLER_NAME%" >nul 2>nul
robocopy "%copia%" "%ICARUS_UPDATE_APPDIR%" /MIR /R:5 /W:1 /NFL /NDL /NJH /NJS /NP >nul
echo version anterior restaurada %date% %time% errorlevel %errorlevel% >> "%log%"
:abrir
if not "%ICARUS_UPDATE_RELAUNCH%"=="1" goto fin
echo abriendo %date% %time% >> "%log%"
start "" "%ICARUS_UPDATE_APP%" --updated
echo abierto %date% %time% >> "%log%"
:fin
`;

/** Carpeta de la copia de seguridad de la instalación (dentro de la de actualizaciones). */
export const WINDOWS_BACKUP_DIR = 'instalacion-anterior';

export function launchWindowsInstaller(installer: string, relaunch: boolean, version: string, scriptDir: string, appPath: string = process.execPath): void {
  mkdirSync(scriptDir, { recursive: true });
  const script = join(scriptDir, 'actualizar.cmd');
  writeFileSync(script, WINDOWS_UPDATE.replace(/\n/g, '\r\n'));
  const appDir = win32.dirname(appPath);
  const helper = spawn('cmd.exe', ['/d', '/c', script], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      ICARUS_UPDATE_VERSION: version,
      ICARUS_UPDATE_INSTALLER: installer,
      ICARUS_UPDATE_INSTALLER_NAME: basename(installer),
      ICARUS_UPDATE_APPDIR: appDir,
      ICARUS_UPDATE_BACKUP: join(scriptDir, WINDOWS_BACKUP_DIR),
      ICARUS_UPDATE_ASAR: win32.join(appDir, 'resources', 'app.asar'),
      ICARUS_UPDATE_UNINSTALLER: win32.join(appDir, UNINSTALLER),
      ICARUS_UPDATE_APP: appPath,
      ICARUS_UPDATE_RELAUNCH: relaunch ? '1' : '0',
    },
  });
  helper.unref();
}

/* ---------------------------------- macOS ---------------------------------- */

async function plistValue(plist: string, key: string): Promise<string> {
  const { stdout } = await run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist]);
  return stdout.trim();
}

async function teamIdentifier(app: string): Promise<string | null> {
  try {
    const { stderr } = await run('/usr/bin/codesign', ['-dv', '--verbose=2', app]);
    const match = /TeamIdentifier=(\S+)/.exec(stderr);
    return match && match[1] !== 'not' ? match[1]! : null;
  } catch {
    return null;
  }
}

/**
 * Sin Developer ID (firma ad hoc) cada versión tiene otra identidad de firma, así que
 * tras actualizar macOS pide permiso para que ICARUS lea su clave del llavero («ICARUS
 * Browser Safe Storage», con la que Chromium cifra las cookies). La interfaz lo avisa
 * antes de instalar; con Developer ID la identidad se mantiene y no hay aviso.
 */
export async function macNeedsKeychainApproval(bundlePath: string): Promise<boolean> {
  return (await teamIdentifier(bundlePath)) === null;
}

/**
 * Extrae el .zip verificado y comprueba la app resultante antes de usarla:
 * identificador, versión, firma de código íntegra y, si la app instalada tiene
 * Developer ID, el mismo equipo de Apple.
 */
export async function stageMacUpdate(zip: string, stagingDir: string, version: string, currentBundle: string): Promise<string> {
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });
  await run('/usr/bin/ditto', ['-x', '-k', zip, stagingDir]);
  const app = join(stagingDir, basename(currentBundle));
  const plist = join(app, 'Contents', 'Info.plist');
  if (!existsSync(plist)) throw new Error(`El paquete no contiene ${basename(currentBundle)}`);
  if ((await plistValue(plist, 'CFBundleIdentifier')) !== BUNDLE_ID) throw new Error('Identificador de la app distinto');
  const bundleVersion = await plistValue(plist, 'CFBundleShortVersionString');
  if (bundleVersion !== version) throw new Error(`La app descargada es la versión ${bundleVersion}, no ${version}`);
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  const [currentTeam, nextTeam] = await Promise.all([teamIdentifier(currentBundle), teamIdentifier(app)]);
  if (currentTeam && currentTeam !== nextTeam) throw new Error(`Equipo de firma distinto (${nextTeam ?? 'ninguno'})`);
  return app;
}

/** Script que espera a que ICARUS se cierre, sustituye la app y la vuelve a abrir. */
const SWAP_SCRIPT = `#!/bin/sh
# Generado por ICARUS Browser para aplicar una actualización.
pid="$1"; target="$2"; staged="$3"; relaunch="$4"
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i + 1))
  [ "$i" -gt 600 ] && exit 1
  sleep 0.1
done
backup="$target.icarus-anterior"
rm -rf "$backup"
if mv "$target" "$backup"; then
  if mv "$staged" "$target" || /usr/bin/ditto "$staged" "$target"; then
    rm -rf "$backup"
  else
    rm -rf "$target"
    mv "$backup" "$target"
  fi
fi
[ "$relaunch" = "1" ] && /usr/bin/open "$target"
exit 0
`;

export function launchMacSwap(scriptDir: string, bundlePath: string, stagedApp: string, relaunch: boolean): void {
  mkdirSync(scriptDir, { recursive: true });
  const script = join(scriptDir, 'aplicar-actualizacion.sh');
  writeFileSync(script, SWAP_SCRIPT, { mode: 0o700 });
  const child = spawn('/bin/sh', [script, String(process.pid), bundlePath, stagedApp, relaunch ? '1' : '0'], { detached: true, stdio: 'ignore' });
  child.unref();
}

/* ---------------------------------- Linux ---------------------------------- */

/** Sufijo de la copia del AppImage anterior, junto al actual. */
export const APPIMAGE_BACKUP_SUFFIX = '.icarus-anterior';

/** ¿Es un AppImage de tipo 2 (ELF con la marca «AI» 0x02 en el byte 8)? */
export function isAppImage(path: string): boolean {
  const header = Buffer.alloc(11);
  const fd = openSync(path, 'r');
  try {
    if (readSync(fd, header, 0, header.length, 0) < header.length) return false;
  } finally {
    closeSync(fd);
  }
  return header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && header[8] === 0x41 && header[9] === 0x49 && header[10] === 0x02;
}

/**
 * Coloca el AppImage verificado junto al actual (misma carpeta, así la sustitución
 * es un `rename` atómico) con permiso de ejecución. Devuelve su ruta.
 */
export function stageAppImage(file: string, target: string): string {
  if (!isAppImage(file)) throw new Error('El paquete no es un AppImage');
  const staged = join(dirname(target), `.${basename(target)}.icarus-nueva`);
  rmSync(staged, { force: true });
  copyFileSync(file, staged);
  chmodSync(staged, 0o755);
  return staged;
}

/**
 * Espera a que ICARUS se cierre, guarda el AppImage actual, pone el nuevo en su
 * lugar con `mv` (atómico en la misma carpeta) y, si se pide, lo abre y espera a que
 * confirme que arrancó; si no lo hace en 90 s, restaura el anterior y lo abre.
 */
const APPIMAGE_SWAP = `#!/bin/sh
# Generado por ICARUS Browser para aplicar una actualización (AppImage).
pid="$1"; target="$2"; staged="$3"; relaunch="$4"; confirm="$5"
log="$(dirname "$0")/actualizacion.log"
# Las variables del AppImage en ejecución no deben pasar al nuevo: su entorno pone las suyas.
unset APPIMAGE APPDIR ARGV0 OWD
open_app() { setsid "$1" --updated </dev/null >/dev/null 2>&1 & echo $!; }
echo "inicio $(date)" >> "$log"
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 600 ]; then echo "ICARUS no se cerró" >> "$log"; exit 1; fi
  sleep 0.1
done
backup="$target${APPIMAGE_BACKUP_SUFFIX}"
rm -f "$backup"
if ! ln "$target" "$backup" 2>/dev/null && ! cp -p "$target" "$backup"; then
  echo "sin copia de seguridad: no se actualiza" >> "$log"
  rm -f "$staged"
  [ "$relaunch" = "1" ] && open_app "$target" >/dev/null
  exit 1
fi
if ! mv -f "$staged" "$target"; then
  echo "no se pudo sustituir" >> "$log"
  rm -f "$backup"
  [ "$relaunch" = "1" ] && open_app "$target" >/dev/null
  exit 1
fi
echo "sustituido $(date)" >> "$log"
[ "$relaunch" = "1" ] || exit 0
rm -f "$confirm"
child=$(open_app "$target")
# Espera la confirmación de la versión nueva: como mucho 90 s, o hasta que se cierre sin darla.
i=0
while [ ! -f "$confirm" ]; do
  i=$((i + 1))
  fallo=""
  [ "$i" -gt 900 ] && fallo="no confirmó en 90 s"
  if ! kill -0 "$child" 2>/dev/null; then
    sleep 1
    [ -f "$confirm" ] && break
    fallo="se cerró sin confirmar"
  fi
  if [ -n "$fallo" ]; then
    echo "la versión nueva $fallo: se restaura la anterior $(date)" >> "$log"
    kill "$child" 2>/dev/null
    mv -f "$backup" "$target" && open_app "$target" >/dev/null
    exit 1
  fi
  sleep 0.1
done
echo "confirmada $(date)" >> "$log"
rm -f "$backup"
exit 0
`;

export function launchAppImageSwap(scriptDir: string, target: string, staged: string, relaunch: boolean, confirmFile: string): void {
  mkdirSync(scriptDir, { recursive: true });
  const script = join(scriptDir, 'aplicar-actualizacion.sh');
  writeFileSync(script, APPIMAGE_SWAP, { mode: 0o700 });
  const child = spawn('/bin/sh', [script, String(process.pid), target, staged, relaunch ? '1' : '0', confirmFile], { detached: true, stdio: 'ignore' });
  child.unref();
}

/** Borra la copia del AppImage anterior cuando la versión nueva ya arrancó. */
export function removeAppImageBackup(target: string): void {
  rmSync(`${target}${APPIMAGE_BACKUP_SUFFIX}`, { force: true });
}
