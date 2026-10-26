/**
 * Comprueba una versión antes y después de publicarla, igual que lo haría la app:
 *
 * - Local (antes de publicar): la firma del manifiesto con la clave pública del
 *   repositorio, que el manifiesto supera la validación de la app y que cada
 *   paquete de --dir tiene el tamaño y el SHA-256 anotados.
 * - Remota (--remote, después de publicar): descarga sin credenciales el
 *   manifiesto, la firma y cada paquete desde las direcciones públicas de la
 *   versión, y comprueba que son idénticos. Con --latest, además, que
 *   releases/latest sirve este manifiesto (versión estable).
 *
 * Uso:
 *   node scripts/release/verify-release.mjs --dir release [--version V] [--commit SHA]
 *   node scripts/release/verify-release.mjs --dir release --remote https://github.com/OWNER/REPO [--latest]
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  fail,
  isValidPublicKey,
  MANIFEST_FILE,
  parseManifest,
  PUBLIC_KEY_FILE,
  sha256File,
  SIGNATURE_FILE,
  verifyManifestSignature,
} from './core.mjs';

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'release' },
    'public-key': { type: 'string', default: PUBLIC_KEY_FILE },
    version: { type: 'string' },
    commit: { type: 'string' },
    remote: { type: 'string' },
    latest: { type: 'boolean', default: false },
  },
});

const publicKey = readFileSync(values['public-key'], 'utf8');
if (!isValidPublicKey(publicKey)) fail(`${values['public-key']} no es una clave pública ECDSA P-256.`);

const manifestBytes = readFileSync(join(values.dir, MANIFEST_FILE));
const signature = readFileSync(join(values.dir, SIGNATURE_FILE), 'utf8');
if (!verifyManifestSignature(manifestBytes, signature, publicKey)) fail('La firma del manifiesto no es válida con la clave pública del repositorio.');
const result = parseManifest(manifestBytes.toString('utf8'));
if (!result.ok) fail(`Manifiesto no válido: ${result.error}${result.detail ? ` (${result.detail})` : ''}`);
const { manifest } = result;
if (values.version && manifest.version !== values.version) fail(`El manifiesto es de la versión ${manifest.version}, no de ${values.version}.`);
if (values.commit && manifest.commit !== values.commit) fail(`El manifiesto es del commit ${manifest.commit}, no de ${values.commit}.`);
console.log(`✓ Manifiesto firmado y válido: ${manifest.version} (${manifest.channel}), commit ${manifest.commit}`);

if (!values.remote) {
  for (const asset of manifest.assets) {
    const path = join(values.dir, asset.file);
    const hash = await sha256File(path).catch(() => fail(`Falta ${path}`));
    if (hash !== asset.sha256) fail(`${asset.file}: el SHA-256 no coincide con el manifiesto.`);
    if (statSync(path).size !== asset.size) fail(`${asset.file}: el tamaño no coincide con el manifiesto.`);
    console.log(`✓ ${asset.file}`);
  }
  process.exit(0);
}

/* ------------------------------ Versión publicada ------------------------------ */

const base = values.remote.replace(/\/+$/, '');
if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(base)) fail('--remote debe ser https://github.com/OWNER/REPO');

async function download(url, attempts = 6) {
  for (let attempt = 1; ; attempt++) {
    try {
      // Sin credenciales, como la aplicación.
      const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'ICARUS-release-check' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= attempts) fail(`No se pudo descargar ${url}: ${error.message}`);
      // GitHub puede tardar unos segundos en servir una versión recién publicada.
      await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
    }
  }
}

const releaseBase = `${base}/releases/download/${manifest.tag}`;
const remoteManifest = await download(`${releaseBase}/${MANIFEST_FILE}`);
const remoteSignature = await download(`${releaseBase}/${SIGNATURE_FILE}`);
if (!remoteManifest.equals(manifestBytes) || remoteSignature.toString('utf8') !== signature) fail('El manifiesto publicado no es el que se firmó.');
console.log(`✓ ${releaseBase}/${MANIFEST_FILE} y su firma son los publicados`);

for (const asset of manifest.assets) {
  const bytes = await download(`${releaseBase}/${asset.file}`);
  if (bytes.length !== asset.size || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) fail(`${asset.file} publicado no coincide con el manifiesto.`);
  console.log(`✓ ${asset.file} accesible y con el SHA-256 correcto`);
}

if (values.latest) {
  for (let attempt = 1; ; attempt++) {
    const latest = await download(`${base}/releases/latest/download/${MANIFEST_FILE}`);
    if (latest.equals(manifestBytes)) break;
    if (attempt >= 12) fail('releases/latest no sirve el manifiesto de esta versión.');
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  console.log('✓ releases/latest sirve esta versión al canal estable');
}
