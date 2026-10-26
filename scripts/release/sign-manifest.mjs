/**
 * Firma el manifiesto de actualización con la clave privada (ECDSA P-256 y
 * SHA-256, firma DER en base64) y comprueba la firma con la clave pública del
 * repositorio: si no corresponden, falla (la app rechazaría la actualización).
 *
 * La clave privada se lee de la variable ICARUS_UPDATE_SIGNING_KEY (el secreto de
 * GitHub del mismo nombre). Nunca se escribe en disco ni se muestra. Solo para
 * pruebas: --key-file con una clave temporal y --public-key con la suya.
 *
 * Uso: node scripts/release/sign-manifest.mjs --dir release [--public-key RUTA] [--key-file RUTA]
 */

import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fail, isValidPublicKey, MANIFEST_FILE, PUBLIC_KEY_FILE, SIGNATURE_FILE, verifyManifestSignature } from './core.mjs';

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'release' },
    'public-key': { type: 'string', default: PUBLIC_KEY_FILE },
    'key-file': { type: 'string' },
  },
});

const pem = values['key-file'] ? readFileSync(values['key-file'], 'utf8') : process.env.ICARUS_UPDATE_SIGNING_KEY;
if (!pem?.trim()) fail('Falta la clave privada: define el secreto ICARUS_UPDATE_SIGNING_KEY (ver docs/UPDATES.md).');
let key;
try {
  key = createPrivateKey(pem);
} catch {
  fail('ICARUS_UPDATE_SIGNING_KEY no es una clave privada PEM válida.');
}
if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') fail('La clave privada debe ser ECDSA P-256 (prime256v1).');

let publicKey;
try {
  publicKey = readFileSync(values['public-key'], 'utf8');
} catch {
  fail(`Falta la clave pública ${values['public-key']} (node scripts/release/generate-update-key.mjs).`);
}
if (!isValidPublicKey(publicKey)) fail(`${values['public-key']} no es una clave pública ECDSA P-256.`);

const manifestPath = join(values.dir, MANIFEST_FILE);
const bytes = readFileSync(manifestPath);
const signature = sign('sha256', bytes, { key, dsaEncoding: 'der' }).toString('base64');
if (!verifyManifestSignature(bytes, signature, publicKey)) {
  fail(`La clave privada no corresponde a ${values['public-key']}: las instalaciones rechazarían esta actualización.`);
}
writeFileSync(join(values.dir, SIGNATURE_FILE), `${signature}\n`);
console.log(`${join(values.dir, SIGNATURE_FILE)}: firma verificada con ${values['public-key']}`);
