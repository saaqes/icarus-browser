/**
 * Genera la pareja de claves con la que se firman los manifiestos de actualización.
 *
 * - La clave PÚBLICA se escribe en build/update-public-key.pem: se sube al
 *   repositorio y se incluye en cada compilación para verificar las actualizaciones.
 * - La clave PRIVADA se escribe FUERA del repositorio (por defecto en tu carpeta
 *   personal, con permisos 600). Guárdala como secreto ICARUS_UPDATE_SIGNING_KEY de
 *   GitHub y haz una copia de seguridad fuera de línea: si se pierde, las
 *   instalaciones existentes no aceptarán actualizaciones firmadas con otra clave.
 *
 * Uso: node scripts/release/generate-update-key.mjs [--private-key RUTA] [--replace]
 */

import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fail, projectDir, PUBLIC_KEY_FILE, syncIosPublicKey, UPDATE_REPOSITORY } from './core.mjs';

const { values } = parseArgs({
  options: {
    'private-key': { type: 'string', default: join(homedir(), 'icarus-update-signing-key.pem') },
    replace: { type: 'boolean', default: false },
  },
});
const privatePath = resolve(values['private-key']);

// relative() devuelve una ruta sin «..» (ni absoluta) cuando el archivo está dentro del proyecto.
const inside = relative(projectDir, privatePath);
if (!inside.startsWith('..') && !isAbsolute(inside)) {
  fail('La clave privada no puede guardarse dentro del repositorio: elige una ruta fuera de él con --private-key.');
}
if (existsSync(privatePath)) fail(`${privatePath} ya existe: no se sobrescribe una clave privada.`);
if (existsSync(PUBLIC_KEY_FILE) && !values.replace) {
  fail(
    `${relative(projectDir, PUBLIC_KEY_FILE)} ya existe. Cambiar de clave hace que las instalaciones actuales rechacen las actualizaciones nuevas; usa --replace solo si sabes lo que haces.`,
  );
}

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
mkdirSync(dirname(privatePath), { recursive: true });
writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
writeFileSync(PUBLIC_KEY_FILE, publicKey.export({ type: 'spki', format: 'pem' }));
syncIosPublicKey();

console.log(`Clave pública: ${relative(projectDir, PUBLIC_KEY_FILE)} y su copia para iPhone en mobile/ios/App/Resources (súbelas al repositorio)
Clave privada: ${privatePath} (NO la subas; permisos 600)

Siguientes pasos:
  1. Guarda la clave privada como secreto del repositorio:
       gh secret set ICARUS_UPDATE_SIGNING_KEY --repo ${UPDATE_REPOSITORY} < "${privatePath}"
     (o en GitHub: Settings → Secrets and variables → Actions → New repository secret).
  2. Haz una copia de seguridad de la clave privada fuera de línea y bórrala de este equipo
     cuando ya no la necesites.
  3. Sube build/update-public-key.pem y mobile/ios/App/Resources/update-public-key.pem:
     las compilaciones siguientes ya podrán verificar las actualizaciones.`);
