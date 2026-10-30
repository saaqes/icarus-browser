/**
 * Utilidades comunes de los scripts de publicación.
 *
 * Las comprobaciones de versión, manifiesto y firma son las mismas que usa la
 * aplicación: se cargan de electron/update compilado en dist-electron (ejecuta
 * antes `npm run build:electron`, o `npm run build`).
 */

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const PUBLIC_KEY_FILE = join(projectDir, 'build', 'update-public-key.pem');
/** Copia que lleva la app de iPhone (XcodeGen no puede incluir un archivo opcional de fuera). */
export const IOS_PUBLIC_KEY_FILE = join(projectDir, 'mobile', 'ios', 'App', 'Resources', 'update-public-key.pem');

const compiled = (name) => join(projectDir, 'dist-electron', 'electron', 'update', `${name}.js`);
if (!existsSync(compiled('manifest')) || !existsSync(join(projectDir, 'dist-electron', 'package.json'))) {
  console.error('Falta dist-electron: ejecuta antes «npm run build:electron».');
  process.exit(1);
}
const require = createRequire(import.meta.url);
export const { parseVersion, formatVersion, compareVersions, androidVersionCode } = require(compiled('version'));
export const { parseManifest } = require(compiled('manifest'));
export const { isValidPublicKey, verifyManifestSignature } = require(compiled('signature'));
export const { MANIFEST_FILE, SIGNATURE_FILE, UPDATE_REPOSITORY, MAX_NOTES_LENGTH } = require(compiled('config'));

/** Datos derivados de una versión (null si no es válida). */
export function describeVersion(version) {
  const parsed = parseVersion(version);
  if (!parsed) return null;
  return {
    version,
    tag: `v${version}`,
    channel: parsed.preview === null ? 'stable' : 'preview',
    versionCode: androidVersionCode(parsed),
    // CFBundleShortVersionString solo admite números.
    marketingVersion: `${parsed.major}.${parsed.minor}.${parsed.patch}`,
  };
}

export function packageVersion() {
  return JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')).version;
}

/** Termina con un mensaje de error (formato de anotación de GitHub Actions si procede). */
export function fail(message) {
  console.error(process.env.GITHUB_ACTIONS ? `::error::${message}` : `Error: ${message}`);
  process.exit(1);
}

export function sha256File(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolvePromise(hash.digest('hex')));
  });
}

export const PLATFORMS = ['windows', 'macos', 'linux', 'android', 'ios'];

/**
 * Paquetes de cada versión, con los nombres que generan electron-builder y los
 * flujos de Android e iPhone. Todos son obligatorios en una publicación.
 */
export function expectedAssets(version) {
  const parsed = parseVersion(version);
  if (!parsed) throw new Error(`Versión no válida: ${version}`);
  return [
    { platform: 'windows', arch: 'x64', kind: 'nsis', file: `ICARUS-Browser-Setup-${version}.exe` },
    { platform: 'windows', arch: 'x64', kind: 'zip', file: `ICARUS-Browser-${version}-win-x64.zip` },
    { platform: 'macos', arch: 'arm64', kind: 'zip', file: `ICARUS-Browser-${version}-mac-arm64.zip` },
    { platform: 'macos', arch: 'x64', kind: 'zip', file: `ICARUS-Browser-${version}-mac-x64.zip` },
    { platform: 'macos', arch: 'arm64', kind: 'dmg', file: `ICARUS-Browser-${version}-mac-arm64.dmg` },
    { platform: 'macos', arch: 'x64', kind: 'dmg', file: `ICARUS-Browser-${version}-mac-x64.dmg` },
    // Linux: AppImage, que ICARUS sustituye él mismo al actualizarse.
    { platform: 'linux', arch: 'x64', kind: 'appimage', file: `ICARUS-Browser-${version}-linux-x64.AppImage` },
    { platform: 'android', arch: 'universal', kind: 'apk', file: `ICARUS-Browser-${version}-android.apk`, versionCode: androidVersionCode(parsed) },
    // Solo para que la app de iPhone sepa que hay versión nueva: nunca se instala desde aquí.
    { platform: 'ios', arch: 'universal', kind: 'ipa', file: `ICARUS-Browser-${version}-ios-sin-firmar.ipa` },
  ];
}

/** La copia de iPhone coincide con la clave del repositorio (o ninguna existe). */
export function iosPublicKeyInSync() {
  const main = existsSync(PUBLIC_KEY_FILE) ? readFileSync(PUBLIC_KEY_FILE, 'utf8') : null;
  const copy = existsSync(IOS_PUBLIC_KEY_FILE) ? readFileSync(IOS_PUBLIC_KEY_FILE, 'utf8') : null;
  return main === copy;
}

export function syncIosPublicKey() {
  if (existsSync(PUBLIC_KEY_FILE)) writeFileSync(IOS_PUBLIC_KEY_FILE, readFileSync(PUBLIC_KEY_FILE, 'utf8'));
  else rmSync(IOS_PUBLIC_KEY_FILE, { force: true });
}

/** Lee la clave pública del repositorio (null si aún no se generó). */
export function repositoryPublicKey() {
  if (!existsSync(PUBLIC_KEY_FILE)) return null;
  const pem = readFileSync(PUBLIC_KEY_FILE, 'utf8');
  if (!isValidPublicKey(pem)) fail(`${PUBLIC_KEY_FILE} no es una clave pública ECDSA P-256 válida.`);
  return pem;
}
