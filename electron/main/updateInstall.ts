/**
 * Instalación de actualizaciones en el escritorio.
 *
 * Windows (instalado con el instalador NSIS): se ejecuta el nuevo instalador con
 * `/S --updated`, igual que hace electron-updater. El instalador de
 * electron-builder espera a que ICARUS se cierre, instala en la misma carpeta y
 * conserva los datos (%APPDATA%\ICARUS Browser). Para volver a abrir ICARUS no se
 * usa su `--force-run` (abre la app a través del Explorador, que puede no estar
 * disponible): un pequeño script espera a que termine el instalador y abre ICARUS,
 * también si la instalación falla, para no dejar al usuario sin navegador.
 *
 * macOS: la app lleva firma ad hoc, así que Squirrel.Mac (el mecanismo de
 * electron-updater) no puede validar la versión nueva. ICARUS descarga el .zip
 * firmado en el manifiesto, lo extrae, comprueba identificador, versión y firma de
 * código, y un pequeño script sustituye la app cuando ICARUS se cierra (con vuelta
 * atrás si algo falla). Si la app no está en una carpeta escribible (o macOS la
 * ejecuta desde una ubicación aleatoria), se descarga el .dmg verificado y el
 * usuario la coloca él mismo.
 *
 * Linux no tiene paquete publicado: solo se avisa.
 */

import { execFile, spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, posix, win32 } from 'node:path';
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
}

export interface PlanEnvironment {
  platform: NodeJS.Platform;
  arch: string;
  execPath: string;
  /** macOS: app x64 ejecutándose con Rosetta en un Mac con Apple Silicon. */
  runningUnderArm64Translation?: boolean;
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
 * Espera a que la versión nueva esté instalada y abre ICARUS. El instalador de
 * electron-builder se vuelve a lanzar a sí mismo, así que no basta con esperar a su
 * proceso: se espera a que el app.asar instalado sea el de la versión nueva (su
 * build-info.json) y exista el desinstalador que se escribe al final, sin procesos del
 * instalador, más un margen. Como mucho unos 10 minutos: después se abre igualmente
 * (si la instalación falló, ICARUS lo detecta y no la reintenta). Las rutas llegan
 * por variables de entorno (sin problemas de comillas) y cada paso queda en
 * reinicio.log, junto al script.
 */
const WINDOWS_RELAUNCH = `@echo off
rem Generado por ICARUS Browser para volver a abrirlo tras instalar una actualización.
set "log=%~dp0reinicio.log"
echo inicio %date% %time% version %ICARUS_UPDATE_VERSION% >> "%log%"
set /a n=0
:esperar
set /a n+=1
if %n% gtr 600 goto abrir
ping -n 2 127.0.0.1 >nul
findstr /M /L /C:"\\"version\\": \\"%ICARUS_UPDATE_VERSION%\\"" "%ICARUS_UPDATE_ASAR%" >nul 2>nul || goto esperar
if not exist "%ICARUS_UPDATE_UNINSTALLER%" goto esperar
tasklist /FI "IMAGENAME eq %ICARUS_UPDATE_INSTALLER_NAME%" /NH 2>nul | find /I "%ICARUS_UPDATE_INSTALLER_NAME%" >nul && goto esperar
echo version instalada %date% %time% >> "%log%"
rem Margen para que el instalador termine de cerrar sus archivos.
ping -n 4 127.0.0.1 >nul
:abrir
echo abriendo %date% %time% >> "%log%"
start "" "%ICARUS_UPDATE_APP%" --updated
echo abierto %date% %time% >> "%log%"
`;

export function launchWindowsInstaller(installer: string, relaunch: boolean, version: string, scriptDir: string, appPath: string = process.execPath): void {
  const child = spawn(installer, ['/S', '--updated'], { detached: true, stdio: 'ignore' });
  child.unref();
  if (!relaunch) return;
  mkdirSync(scriptDir, { recursive: true });
  const script = join(scriptDir, 'reiniciar.cmd');
  writeFileSync(script, WINDOWS_RELAUNCH.replace(/\n/g, '\r\n'));
  const appDir = win32.dirname(appPath);
  const watcher = spawn('cmd.exe', ['/d', '/c', script], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      ICARUS_UPDATE_VERSION: version,
      ICARUS_UPDATE_INSTALLER_NAME: basename(installer),
      ICARUS_UPDATE_ASAR: win32.join(appDir, 'resources', 'app.asar'),
      ICARUS_UPDATE_UNINSTALLER: win32.join(appDir, UNINSTALLER),
      ICARUS_UPDATE_APP: appPath,
    },
  });
  watcher.unref();
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
