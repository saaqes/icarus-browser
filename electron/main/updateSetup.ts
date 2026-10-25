/**
 * Configuración del actualizador en la aplicación: clave pública incluida en la
 * compilación (dist-electron/build-info.json, generado desde
 * build/update-public-key.pem) y origen de las versiones.
 *
 * Solo para pruebas automáticas: ICARUS_UPDATE_FEED=http://127.0.0.1:PUERTO usa un
 * servidor local con la misma estructura que GitHub, e ICARUS_UPDATE_PUBLIC_KEY_FILE
 * una clave de prueba. Ambas se ignoran salvo que el servidor sea de la propia
 * máquina: quien puede cambiar las variables de entorno de ICARUS ya puede
 * ejecutar código como el usuario.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValidPublicKey } from '../update/signature';
import { githubSource, loopbackSource, type UpdateSource } from '../update/source';

export interface BuildInfo {
  version: string | null;
  commit: string | null;
  updatePublicKey: string | null;
}

export function readBuildInfo(distElectronDir: string): BuildInfo {
  const path = join(distElectronDir, 'build-info.json');
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<BuildInfo>;
    return {
      version: typeof raw.version === 'string' ? raw.version : null,
      commit: typeof raw.commit === 'string' && /^[0-9a-f]{40}$/.test(raw.commit) ? raw.commit : null,
      updatePublicKey: typeof raw.updatePublicKey === 'string' && isValidPublicKey(raw.updatePublicKey) ? raw.updatePublicKey : null,
    };
  } catch {
    return { version: null, commit: null, updatePublicKey: null };
  }
}

export interface UpdateConfig {
  source: UpdateSource;
  publicKey: string | null;
  /** Servidor local de pruebas en uso. */
  testFeed: boolean;
  firstCheckDelayMs?: number;
}

export function updateConfig(info: BuildInfo, env: NodeJS.ProcessEnv = process.env): UpdateConfig {
  const loopback = env.ICARUS_UPDATE_FEED ? loopbackSource(env.ICARUS_UPDATE_FEED) : null;
  if (!loopback) return { source: githubSource(), publicKey: info.updatePublicKey, testFeed: false };
  let publicKey = info.updatePublicKey;
  const keyFile = env.ICARUS_UPDATE_PUBLIC_KEY_FILE;
  if (keyFile && existsSync(keyFile)) {
    const pem = readFileSync(keyFile, 'utf8');
    publicKey = isValidPublicKey(pem) ? pem : null;
  }
  const delay = Number(env.ICARUS_UPDATE_CHECK_DELAY_MS);
  return { source: loopback, publicKey, testFeed: true, firstCheckDelayMs: Number.isFinite(delay) && delay >= 0 ? delay : undefined };
}
