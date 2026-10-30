/**
 * Publicación automática (.github/workflows/draft.yml): decide si los paquetes ya
 * probados de un commit se publican como versión o se quedan en borrador.
 *
 * Se publica solo si se cumple todo:
 * - el commit es de la rama principal del repositorio y pasaron los cinco flujos
 *   (lo comprueba draft.yml antes de llamar a este script);
 * - la versión de package.json es nueva: no existe ya una versión o un borrador con
 *   su etiqueta y es posterior a todas las publicadas (así, un commit que no cambia la
 *   versión nunca publica nada, y nunca se publica un retroceso);
 * - existen la clave pública del repositorio y el secreto de firma del manifiesto.
 *
 * Si falta el almacén de claves de Android, se publica igualmente para el resto de
 * plataformas, pero el APK no entra en el manifiesto (Android solo instala una
 * actualización firmada con el mismo certificado que la app instalada).
 *
 * Escribe en GITHUB_OUTPUT: publish (stable | preview | none), version, tag, reason,
 * android (include | omit). Para probarlo en local:
 *   HEAD_BRANCH=main DEFAULT_BRANCH=main HAS_SIGNING_KEY=true GH_TOKEN=… GITHUB_REPOSITORY=saaqes/icarus-browser \
 *     node scripts/release/auto-plan.mjs
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { compareVersions, describeVersion, packageVersion, parseVersion, projectDir, repositoryPublicKey } from './core.mjs';

const env = process.env;
const version = packageVersion();
const info = describeVersion(version);

function output(publish, reason, android = 'omit') {
  const tag = info?.tag ?? '';
  const line = publish === 'none' ? `No se publica ninguna versión: ${reason}` : `Se publica ${tag} (${publish}): ${reason}`;
  console.log(env.GITHUB_ACTIONS ? `::notice::${line}` : line);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `publish=${publish}\nversion=${version}\ntag=${tag}\nandroid=${android}\nreason=${reason}\n`);
  process.exit(0);
}

if (!info) output('none', `la versión de package.json («${version}») no es válida.`);
try {
  // package.json y mobile/ios/App/project.yml deben coincidir.
  execFileSync(process.execPath, ['scripts/release/version.mjs', 'check'], { cwd: projectDir, stdio: ['ignore', 'ignore', 'inherit'] });
} catch {
  output('none', 'la versión de package.json y la de iPhone no coinciden.');
}
if (!env.HEAD_BRANCH || env.HEAD_BRANCH !== env.DEFAULT_BRANCH) {
  output('none', `el commit es de la rama «${env.HEAD_BRANCH}», no de la principal («${env.DEFAULT_BRANCH}»).`);
}

const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/releases?per_page=100`, {
  headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${env.GH_TOKEN}`, 'user-agent': 'ICARUS-release' },
});
if (!response.ok) output('none', `no se pudo consultar las versiones publicadas (HTTP ${response.status}).`);
const current = parseVersion(version);
for (const release of await response.json()) {
  if (release.tag_name === info.tag) output('none', `ya existe ${release.draft ? 'un borrador' : 'la versión'} ${info.tag}. Para publicar, sube la versión en package.json (npm version patch).`);
  if (release.draft) continue;
  const published = typeof release.tag_name === 'string' ? parseVersion(release.tag_name.replace(/^v/, '')) : null;
  if (published && compareVersions(current, published) <= 0) {
    output('none', `${version} no es posterior a ${release.tag_name}, ya publicada. Para publicar, sube la versión en package.json (npm version patch).`);
  }
}

const missing = [];
if (!repositoryPublicKey()) missing.push('build/update-public-key.pem');
if (env.HAS_SIGNING_KEY !== 'true') missing.push('el secreto ICARUS_UPDATE_SIGNING_KEY');
if (missing.length) output('none', `falta ${missing.join(' y ')} (ver docs/UPDATES.md → Primera versión actualizable).`);

const android = env.HAS_KEYSTORE === 'true' ? 'include' : 'omit';
output(info.channel, `versión nueva ${version} con los cinco flujos en verde${android === 'omit' ? '; sin almacén de claves de Android, el APK no entra en el manifiesto' : ''}.`, android);
