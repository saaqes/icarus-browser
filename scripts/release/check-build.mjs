/**
 * Comprueba que una aplicación empaquetada es la de este commit y esta versión:
 * lee dist-electron/build-info.json dentro de su app.asar y lo compara con
 * package.json, el commit (GITHUB_SHA o --commit) y la clave pública del
 * repositorio (build/update-public-key.pem), que es con la que verificará las
 * actualizaciones.
 *
 * Uso: node scripts/release/check-build.mjs "release/win-unpacked/resources/app.asar" [--commit SHA]
 */

import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { fail, packageVersion, repositoryPublicKey } from './core.mjs';

const require = createRequire(import.meta.url);
// Dependencia de electron-builder.
const asar = require('@electron/asar');

const { positionals, values } = parseArgs({ allowPositionals: true, options: { commit: { type: 'string', default: process.env.GITHUB_SHA } } });
const archive = positionals[0];
if (!archive) fail('Uso: node scripts/release/check-build.mjs RUTA/app.asar [--commit SHA]');

let info;
try {
  info = JSON.parse(asar.extractFile(archive, 'dist-electron/build-info.json').toString('utf8'));
} catch (error) {
  fail(`No se pudo leer dist-electron/build-info.json de ${archive}: ${error.message}`);
}

const version = packageVersion();
if (info.version !== version) fail(`${archive} es la versión ${info.version}, no la ${version} de package.json.`);
if (values.commit && info.commit !== values.commit) fail(`${archive} se compiló desde ${info.commit}, no desde ${values.commit}.`);
const publicKey = repositoryPublicKey();
if ((info.updatePublicKey ?? null) !== publicKey) {
  fail(publicKey ? `${archive} no lleva la clave pública de build/update-public-key.pem.` : `${archive} lleva una clave pública que no está en el repositorio.`);
}
console.log(`✓ ${archive}: versión ${info.version}, commit ${info.commit}, ${publicKey ? 'con' : 'sin'} clave de actualizaciones`);
