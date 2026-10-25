/**
 * Tras compilar el proceso principal:
 *
 * - El proyecto usa módulos ES («type": "module"), pero el proceso principal y el
 *   preload de Electron se compilan como CommonJS: dist-electron/package.json lo
 *   indica a Node.
 * - dist-electron/build-info.json identifica la compilación (versión y commit) y
 *   lleva la clave pública con la que la app verifica las actualizaciones
 *   (build/update-public-key.pem). Va dentro de app.asar, cuya integridad comprueba
 *   Electron al arrancar.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

mkdirSync('dist-electron', { recursive: true });
writeFileSync('dist-electron/package.json', JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

function commit() {
  if (/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA ?? '')) return process.env.GITHUB_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const KEY_FILE = 'build/update-public-key.pem';
let updatePublicKey = null;
if (existsSync(KEY_FILE)) {
  updatePublicKey = readFileSync(KEY_FILE, 'utf8');
  if (!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/.test(updatePublicKey)) {
    console.error(`${KEY_FILE} no es una clave pública PEM.`);
    process.exit(1);
  }
}

writeFileSync('dist-electron/build-info.json', JSON.stringify({ version, commit: commit(), updatePublicKey }, null, 2) + '\n');
if (!updatePublicKey) {
  console.warn(`Aviso: falta ${KEY_FILE}. Esta compilación no podrá verificar ni instalar actualizaciones (ver docs/UPDATES.md).`);
}
